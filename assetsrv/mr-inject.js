/*
 * mr-inject.js — 墨阅 EPUB 阅读器章节注入脚本
 * 由 Go AssetServer 以 <script src="/mr-inject.js" defer> 注入章节。
 * 依赖：window.__mrHL（mr-highlight.js，语言判别与兜底着色）、
 *       window.hljs（可选，highlight.js 构建产物，缺失时自动降级）。
 *
 * 职责：
 *   1) 剥离原书样式（link/style/style 属性/表现属性），统一排版；可整体开关与还原
 *   2) 代码块候选识别：多维置信度打分（消除「正文被误判成代码」），相邻代码段落合并
 *   3) 代码块装饰：行号、语言工具条、复制、折叠，逐块语言可切换并回传主窗口持久化
 *   4) 应用主窗口下发的主题与设置（字号/行高/页宽/缩进/对齐/代码字号…）
 *   5) 右键上下文上报与指令执行（复制、全选、复制代码、改语言、折叠、取消代码块…）
 */
(function () {
  'use strict';

  var HL = window.__mrHL || {};

  /* ================= 常量 ================= */

  // 等宽字体（各 EPUB 使用的字体名并不统一）
  var MONO_RE = /(mono|consolas|courier|menlo|monaco|andale|source\s?code\s?pro|jetbrains|dejavu sans mono)/i;
  // 语义类名：code / code-block / programlisting / literallayout / screen / snippet …
  var CLASS_RE = /(^|[\s_-])(code|codeblock|codeline|programlisting|literallayout|screen|listing|snippet|sourcecode|highlight|monospace|computeroutput|literal|pre)([\s_-]|$)/i;
  // 显式语言类名：language-go / lang-python / brush: java
  var LANG_CLASS_RE = /(?:^|[\s_-])(?:language|lang|highlight|syntax|brush)[\s:_-]*([\w+#-]+)/i;
  // 语义标签：HTML 原生 + DocBook 常用容器
  var TAG_SELECTOR = 'pre,code,xmp,plaintext,programlisting,literallayout,screen,listing,computeroutput';
  // 容器内已有更具体的代码块时，交给内层处理
  var INNER_SELECTOR = 'pre,code,xmp,img,table,video,canvas,svg,.mr-code';
  // 容器内还有块级子元素（如 <div class="code"><p>…</p></div>）时同理交给内层
  var BLOCK_KIDS = 'p,div,ul,ol,h1,h2,h3,h4,h5,h6,table,pre';
  var SCAN_SELECTOR = 'div,p,li,dd,td,blockquote,section,article';
  var MAX_SCAN = 4000;          // 单次扫描元素上限，防止超长章节拖慢渲染
  var PRE_TAGS = {PRE: 1, XMP: 1, PLAINTEXT: 1, LISTING: 1, PROGRAMLISTING: 1, LITERALLAYOUT: 1, SCREEN: 1, COMPUTEROUTPUT: 1};
  var PRES_ATTRS = ['bgcolor', 'background', 'color', 'face', 'align', 'valign', 'width', 'height',
    'border', 'cellpadding', 'cellspacing', 'nowrap', 'size', 'cols', 'rows'];

  /* ================= 运行时状态 ================= */

  var blockSeq = 0;                 // 本章内代码块序号
  var settings = null;              // 主窗口下发的设置
  var langOverrides = {};           // blockKey(index) -> lang 值
  var blockOverrides = {};          // elemKey(el)    -> 'force' | 'reject'
  var theme = 'light';
  var lastCtxEl = null;             // 最近一次右键命中的元素
  var openPop = null;
  var booted = false;

  /* ================= 基础工具 ================= */

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function post(msg) {
    try {
      window.parent.postMessage(msg, '*');
    } catch (err) { /* 忽略 */ }
  }
  function blockKey(index) {
    try { return location.pathname + '#' + index; } catch (err) { return '#' + index; }
  }
  function elemKey(el) {
    try {
      var all = document.body.getElementsByTagName('*');
      for (var i = 0; i < all.length; i++) if (all[i] === el) return location.pathname + '@' + i;
    } catch (err) { /* 忽略 */ }
    return location.pathname + '@-1';
  }
  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }
  function closest(el, sel) {
    return el && el.closest ? el.closest(sel) : null;
  }

  /* ================= 原书样式剥离（可逆） ================= */

  var backup = null;       // {links:[{el,disabled,media}], styles:[{el,media}], attrs:[{el,style,pres}]}
  var stripReady = false;  // 采集（依赖原书 CSS 的 computed style）完成前不得剥离样式
  var unifiedState = null; // 当前剥离状态：true=已剥离 / false=保留原书样式 / null=未处理
  var interactive = false; // 初始化完成后才向主窗口回传块状态，避免开章时消息风暴

  function isOurs(el) {
    return !!(el.className && typeof el.className === 'string' && el.className.indexOf('mr-') === 0) ||
      !!closest(el, '.mr-code');
  }

  function disableBookStyles() {
    if (backup) return;
    backup = {links: [], styles: [], attrs: []};
    var i, j, el;

    var links = document.getElementsByTagName('link');
    for (i = 0; i < links.length; i++) {
      el = links[i];
      if (!/(^|\s)stylesheet(\s|$)/i.test(el.getAttribute('rel') || '')) continue;
      backup.links.push({el: el, disabled: el.disabled, media: el.media});
      try { el.disabled = true; } catch (err) { /* 忽略 */ }
      el.setAttribute('media', 'not all');
    }

    var styles = document.getElementsByTagName('style');
    for (i = 0; i < styles.length; i++) {
      el = styles[i];
      if (el.id === 'mr-reader-css') continue;
      backup.styles.push({el: el, media: el.getAttribute('media')});
      el.setAttribute('media', 'not all');
    }

    var all = document.body ? document.body.getElementsByTagName('*') : [];
    for (i = 0; i < all.length; i++) {
      el = all[i];
      if (isOurs(el)) continue;
      var st = el.getAttribute('style');
      var pres = null;
      for (j = 0; j < PRES_ATTRS.length; j++) {
        if (el.hasAttribute(PRES_ATTRS[j])) {
          pres = pres || {};
          pres[PRES_ATTRS[j]] = el.getAttribute(PRES_ATTRS[j]);
        }
      }
      if (!st && !pres) continue;
      backup.attrs.push({el: el, style: st, pres: pres});
      if (st) el.removeAttribute('style');
      if (pres) for (j = 0; j < PRES_ATTRS.length; j++) el.removeAttribute(PRES_ATTRS[j]);
    }
  }

  function restoreBookStyles() {
    if (!backup) return;
    var i, j, k, item;
    for (i = 0; i < backup.links.length; i++) {
      item = backup.links[i];
      try { item.el.disabled = item.disabled; } catch (err) { /* 忽略 */ }
      if (item.media) item.el.setAttribute('media', item.media); else item.el.removeAttribute('media');
    }
    for (i = 0; i < backup.styles.length; i++) {
      item = backup.styles[i];
      if (item.media) item.el.setAttribute('media', item.media); else item.el.removeAttribute('media');
    }
    for (i = 0; i < backup.attrs.length; i++) {
      item = backup.attrs[i];
      if (item.style) item.el.setAttribute('style', item.style);
      if (item.pres) {
        var keys = [];
        for (k in item.pres) if (Object.prototype.hasOwnProperty.call(item.pres, k)) keys.push(k);
        for (j = 0; j < keys.length; j++) item.el.setAttribute(keys[j], item.pres[keys[j]]);
      }
    }
    backup = null;
  }

  function applyUnify(on) {
    document.documentElement.setAttribute('data-mr-unify', on ? '1' : '0');
    // 采集阶段必须保留原书 CSS：等宽字体 / white-space 等信号来自 computed style
    if (!stripReady) return;
    if (on === unifiedState) return;
    unifiedState = on;
    if (on) disableBookStyles(); else restoreBookStyles();
  }

  /* ================= 候选识别 ================= */

  function markDone(el) {
    el.__mrdone = true;
    var kids = el.querySelectorAll ? el.querySelectorAll('*') : [];
    for (var i = 0; i < kids.length; i++) kids[i].__mrdone = true;
  }
  function isMonoBlock(el) {
    var st = window.getComputedStyle(el);
    if (!st) return false;
    if (st.display === 'inline' || st.display === 'none') return false;
    if (/^pre/.test(st.whiteSpace || '')) return true; // white-space:pre / pre-wrap
    return MONO_RE.test(st.fontFamily || '');
  }
  function hasClassHint(el) {
    var cn = (el.getAttribute && el.getAttribute('class')) || '';
    return cn ? CLASS_RE.test(cn) : false;
  }
  function hasLangClass(el) {
    var cn = (el.getAttribute && el.getAttribute('class')) || '';
    return cn ? LANG_CLASS_RE.test(cn) : false;
  }

  // 多维置信度打分：返回一个 0–100 的分数。
  // 正信号来自容器语义与代码结构，负信号来自自然语言与版面噪声特征。
  function scoreCode(el, code) {
    var s = HL.stats ? HL.stats(code) : {lines: 1, nonEmpty: 1, avgLen: 0, cjk: 0, indent: 0, codePunct: 0, sentence: 0, art: 0};
    var tag = el.tagName.toUpperCase();
    var score = 0;

    if (tag === 'PRE' || tag === 'XMP' || tag === 'PLAINTEXT') score += 45;
    else if (tag === 'CODE') score += 35;
    else if (PRE_TAGS[tag]) score += 35;

    if (hasLangClass(el)) score += 32;
    else if (hasClassHint(el)) score += 14;

    if (isMonoBlock(el)) score += 18;

    if (s.lines >= 2) score += 4;
    if (s.lines >= 5) score += 4;
    if (s.indent >= 0.3) score += 10;
    else if (s.indent >= 0.15) score += 5;
    if (s.codePunct >= 1.5) score += 14;
    else if (s.codePunct >= 0.7) score += 8;
    else if (s.codePunct >= 0.3) score += 3;

    // 负信号
    if (s.cjk > 0.28) score -= 32;
    else if (s.cjk > 0.12) score -= 12;
    if (s.sentence > 1.2 && s.avgLen > 45) score -= 20;
    if (s.avgLen > 130) score -= 18;
    if (s.art > 0.4) score -= 28;
    if (s.lines <= 1 && code.length < 40) score -= 25;
    if (/ISBN|版权所有|All rights reserved|^\s*(序|前言|目录)\s*$/i.test(code)) score -= 20;

    return clamp(Math.round(score), 0, 100);
  }

  function thresholdFor(run) {
    var tag = run[0].tagName.toUpperCase();
    return (tag === 'PRE' || tag === 'XMP' || tag === 'PLAINTEXT' || PRE_TAGS[tag]) ? 40 : 62;
  }

  function groupText(run) {
    var parts = [];
    for (var i = 0; i < run.length; i++) parts.push(run[i].textContent.replace(/\r\n?/g, '\n'));
    return parts.join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
  }

  function collect() {
    var groups = [], hits = [], used = [], i, el, j;

    // ① 语义标签：整段 <pre> 之类，逐个独立成组
    var byTag = document.querySelectorAll(TAG_SELECTOR);
    for (i = 0; i < byTag.length; i++) {
      el = byTag[i];
      if (el.__mrdone) continue;
      // 行内 <code>foo</code> 属于正文的一部分，只有块级或多行时才装饰
      if (el.tagName === 'CODE') {
        var cs = window.getComputedStyle(el);
        if ((!cs || cs.display === 'inline') && el.textContent.indexOf('\n') < 0) { markDone(el); continue; }
      }
      groups.push([el]);
      markDone(el); // 先占位，后续按分数决定要不要装饰
    }

    // ② 通用容器：靠类名 / 等宽字体识别，需过更高阈值
    var all = document.body ? document.body.querySelectorAll(SCAN_SELECTOR) : [];
    var limit = Math.min(all.length, MAX_SCAN);
    for (i = 0; i < limit; i++) {
      el = all[i];
      if (el.__mrdone) continue;
      if (!hasClassHint(el) && !isMonoBlock(el) && !hasLangClass(el)) continue;
      if (el.querySelector(INNER_SELECTOR)) continue;
      if (el.querySelector(BLOCK_KIDS)) continue;
      hits.push(el);
    }

    for (i = 0; i < hits.length; i++) {
      if (used[i]) continue;
      var run = [hits[i]];
      used[i] = true;
      var sib = hits[i].nextElementSibling;
      while (sib) { // 连续的代码段落合并，行号保持连续
        var idx = hits.indexOf(sib);
        if (idx < 0 || used[idx]) break;
        run.push(sib);
        used[idx] = true;
        sib = sib.nextElementSibling;
      }
      groups.push(run);
    }

    // ③ 用户手动标记为代码块的元素（主窗口下发 blockOverrides）
    var hasForce = false;
    for (j in blockOverrides) {
      if (Object.prototype.hasOwnProperty.call(blockOverrides, j) && blockOverrides[j] === 'force') hasForce = true;
    }
    if (hasForce && document.body) {
      var nodes = document.body.getElementsByTagName('*');
      for (i = 0; i < nodes.length; i++) {
        el = nodes[i];
        if (el.__mrdone || blockOverrides[location.pathname + '@' + i] !== 'force') continue;
        groups.push([el]);
        markDone(el);
      }
    }

    return groups;
  }

  /* ================= 代码块装饰 ================= */

  var LANG_EXTRA = ['ini', 'markdown', 'diff', 'makefile', 'dockerfile', 'nginx', 'perl', 'scala', 'objectivec'];

  function langList() {
    var base = (HL.LANG_ORDER || []).slice();
    for (var i = 0; i < LANG_EXTRA.length; i++) {
      if (HL.hasLang && HL.hasLang(LANG_EXTRA[i])) base.push(LANG_EXTRA[i]);
    }
    return base;
  }

  function langLabel(lang) {
    return HL.langLabel ? HL.langLabel(lang) : (lang || '纯文本');
  }

  function setNums(wrap, on) {
    wrap.__mrNums = !!on;
    wrap.setAttribute('data-nums', on ? '1' : '0');
  }

  function setCollapsed(wrap, on) {
    wrap.setAttribute('data-collapsed', on ? '1' : '0');
    if (wrap.__mrFold) wrap.__mrFold.textContent = on ? '展开全部（' + wrap.__mrLines + ' 行）' : '折叠';
  }

  function refreshFoldable(wrap) {
    var th = settings && typeof settings.foldThreshold === 'number' ? settings.foldThreshold : 30;
    var foldable = th > 0 && wrap.__mrLines > th;
    wrap.setAttribute('data-foldable', foldable ? '1' : '0');
    if (!foldable) setCollapsed(wrap, false);
  }

  function highlight(code, lang) {
    if (HL.highlight) return HL.highlight(code, lang);
    return esc(code);
  }

  function applyLang(wrap, lang, manual) {
    if (lang && HL.hasLang && !HL.hasLang(lang)) lang = '';
    wrap.__mrLang = lang || '';
    wrap.__mrManual = !!manual;
    var codeEl = wrap.querySelector('code');
    if (codeEl) codeEl.innerHTML = highlight(wrap.__mrSrc, wrap.__mrLang);
    wrap.className = 'mr-code' + (wrap.__mrLang ? ' mr-lang-' + wrap.__mrLang : '');
    if (wrap.__mrLabel) wrap.__mrLabel.textContent = (manual ? '' : '自动 · ') + langLabel(wrap.__mrLang);
    markLangItems(wrap, manual ? (wrap.__mrLang || 'plain') : 'auto');
    reportState(wrap);
  }

  function reportState(wrap) {
    if (!interactive) return; // 开章初始化阶段不回传，避免逐块消息风暴
    post({
      type: 'mr-code-changed',
      index: wrap.__mrIndex,
      lang: wrap.__mrLang || null,
      lines: wrap.__mrLines,
      collapsed: wrap.getAttribute('data-collapsed') === '1',
      showNums: wrap.__mrNums !== false
    });
  }

  function markLangItems(wrap, value) {
    var items = wrap.querySelectorAll('.mr-lang-item');
    for (var i = 0; i < items.length; i++) {
      items[i].className = items[i].getAttribute('data-v') === value ? 'mr-lang-item active' : 'mr-lang-item';
    }
  }

  function closeAnyPop() {
    if (openPop) { openPop.className = 'mr-lang-pop'; openPop = null; }
  }

  function addLangItem(pop, wrap, index, label, value) {
    var it = document.createElement('button');
    it.type = 'button';
    it.className = 'mr-lang-item';
    it.textContent = label;
    it.setAttribute('data-v', value);
    it.addEventListener('click', function (ev) {
      ev.stopPropagation();
      closeAnyPop();
      var lang = value === 'auto' ? wrap.__mrAuto : (value === 'plain' ? '' : value);
      applyLang(wrap, lang, value !== 'auto');
      post({type: 'mr-lang-set', key: blockKey(index), lang: value});
    });
    pop.appendChild(it);
  }

  function buildBar(wrap, index, auto) {
    var bar = document.createElement('div');
    bar.className = 'mr-bar';

    var copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'mr-bar-btn';
    copy.textContent = '复制';
    copy.addEventListener('click', function (ev) {
      ev.stopPropagation();
      copyCode(wrap);
    });

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mr-lang-btn';
    var name = document.createElement('span');
    name.className = 'mr-lang-name';
    var caret = document.createElement('span');
    caret.className = 'mr-lang-caret';
    caret.textContent = '▾';
    btn.appendChild(name);
    btn.appendChild(caret);
    wrap.__mrLabel = name;

    var pop = document.createElement('div');
    pop.className = 'mr-lang-pop';
    addLangItem(pop, wrap, index, '自动 · ' + langLabel(auto), 'auto');
    addLangItem(pop, wrap, index, '纯文本', 'plain');
    var list = langList();
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      addLangItem(pop, wrap, index, langLabel(n), n);
    }

    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (openPop === pop) { closeAnyPop(); return; }
      closeAnyPop();
      pop.className = 'mr-lang-pop open';
      openPop = pop;
      // 贴近视口底部时向上翻转，避免弹层被截断
      try {
        var r = pop.getBoundingClientRect();
        if (r.bottom > window.innerHeight - 8 && r.top > 120) pop.className = 'mr-lang-pop open up';
      } catch (err) { /* 忽略 */ }
    });

    bar.appendChild(copy);
    bar.appendChild(btn);
    bar.appendChild(pop);
    wrap.appendChild(bar);
    markLangItems(wrap, 'auto');
  }

  function decorate(run, forced) {
    var first = run[0];
    if (!first) return false;

    for (var i = 0; i < run.length; i++) {
      // ASCII 图 / 复杂内容跳过
      if (run[i].querySelector && run[i].querySelector('img,video,canvas,table,svg')) return false;
    }

    // 元素索引必须在替换前算好（替换后就脱离文档，elemKey 会退化成 @-1）
    var key = elemKey(first);
    var code = groupText(run);
    if (!code.trim()) return false;
    if (code.indexOf('\n') < 0 && code.length < 24) return false; // 极短行内代码不包装

    if (!forced) {
      // 用户之前手动取消过这一块，本次渲染直接跳过
      if (blockOverrides[key] === 'reject') return false;
      if (scoreCode(first, code) < thresholdFor(run)) return false;
    }

    var auto = (settings && settings.autoDetectLang === false) ? null : (HL.detectLang ? HL.detectLang(code, first) : null);
    var html = highlight(code, auto || '');
    var lines = html.split('\n');
    var nums = [];
    for (i = 1; i <= lines.length; i++) nums.push(i);

    var wrap = document.createElement('div');
    wrap.className = 'mr-code' + (auto ? ' mr-lang-' + auto : '');
    var ncol = document.createElement('div');
    ncol.className = 'mr-nums';
    ncol.textContent = nums.join('\n');
    var body = document.createElement('div');
    body.className = 'mr-body';
    var np = document.createElement('pre');
    var nc = document.createElement('code');
    nc.innerHTML = html;
    np.appendChild(nc);
    body.appendChild(np);
    wrap.appendChild(ncol);
    wrap.appendChild(body);

    var fold = document.createElement('div');
    fold.className = 'mr-fold';
    fold.setAttribute('role', 'button');
    wrap.appendChild(fold);
    wrap.__mrFold = fold;

    wrap.__mrSrc = code;
    wrap.__mrAuto = auto;
    wrap.__mrLang = auto || '';
    wrap.__mrManual = false;
    wrap.__mrLines = lines.length;
    wrap.__mrOrig = run;
    wrap.__mrIndex = blockSeq++;
    wrap.__mrKey = key;

    fold.addEventListener('click', function () {
      setCollapsed(wrap, wrap.getAttribute('data-collapsed') !== '1');
      reportState(wrap);
    });

    buildBar(wrap, wrap.__mrIndex, auto);
    setNums(wrap, !settings || settings.codeLineNumbers !== false);
    refreshFoldable(wrap);

    wrap.__mrLabel.textContent = '自动 · ' + langLabel(auto);

    // 用代码块整体替换原元素（可能是连续的多段）
    first.parentNode.insertBefore(wrap, first);
    for (i = 0; i < run.length; i++) {
      markDone(run[i]);
      if (run[i].parentNode) run[i].parentNode.removeChild(run[i]);
    }
    return true;
  }

  function revertBlock(wrap) {
    var orig = wrap.__mrOrig || [];
    var parent = wrap.parentNode;
    if (!parent) return false;
    for (var i = 0; i < orig.length; i++) parent.insertBefore(orig[i], wrap);
    parent.removeChild(wrap);
    post({type: 'mr-block-set', key: wrap.__mrKey || elemKey(orig[0]), value: 'reject'});
    return true;
  }

  function findBlock(index) {
    var wraps = document.querySelectorAll('.mr-code');
    for (var i = 0; i < wraps.length; i++) if (wraps[i].__mrIndex === index) return wraps[i];
    return null;
  }

  /* ================= 复制 ================= */

  function copyText(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    document.body.removeChild(ta);
    post({type: 'mr-clipboard', text: text, ok: ok});
    return ok;
  }

  function copyCode(wrap) {
    return copyText(wrap.__mrSrc || '');
  }

  function copySelection() {
    var sel = window.getSelection();
    var text = sel ? String(sel.toString()) : '';
    if (!text) { post({type: 'mr-clipboard', text: '', ok: false}); return false; }
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    post({type: 'mr-clipboard', text: text, ok: ok});
    return ok;
  }

  /* ================= 右键上下文 ================= */

  function onContextMenu(e) {
    var t = e.target;
    var el = (t && t.nodeType === 1) ? t : (t && t.parentElement) || null;
    lastCtxEl = el;

    var wrap = closest(el, '.mr-code');
    var img = null;
    if (el && el.tagName === 'IMG') {
      try {
        img = {src: new URL(el.getAttribute('src') || '', location.href).href, alt: el.getAttribute('alt') || ''};
      } catch (err) { img = null; }
    }
    var code = null;
    if (wrap) {
      code = {
        index: wrap.__mrIndex,
        lang: wrap.__mrLang || null,
        lines: wrap.__mrLines,
        collapsed: wrap.getAttribute('data-collapsed') === '1',
        showNums: wrap.__mrNums !== false
      };
    }
    var sel = window.getSelection();
    e.preventDefault();
    post({
      type: 'mr-context',
      x: e.clientX,
      y: e.clientY,
      selection: sel ? String(sel.toString()) : '',
      code: code,
      image: img,
      inCode: !!wrap
    });
  }

  /* ================= 指令执行 ================= */

  function scrollTop() {
    var de = document.documentElement;
    var old = de.style.scrollBehavior;
    de.style.scrollBehavior = 'auto'; // 切章时不要平滑滚动动画
    window.scrollTo(0, 0);
    de.style.scrollBehavior = old;
  }

  function runCodeAction(msg) {
    var wrap = findBlock(msg.index);
    if (!wrap) return;
    switch (msg.action) {
      case 'lang':
        applyLang(wrap, msg.value === 'plain' ? '' : msg.value, true);
        post({type: 'mr-lang-set', key: blockKey(wrap.__mrIndex), lang: msg.value || 'auto'});
        break;
      case 'numbers':
        setNums(wrap, wrap.__mrNums === false);
        reportState(wrap);
        break;
      case 'collapse':
        setCollapsed(wrap, true);
        reportState(wrap);
        break;
      case 'expand':
        setCollapsed(wrap, false);
        reportState(wrap);
        break;
      case 'reject':
        revertBlock(wrap);
        break;
      default:
        break;
    }
  }

  function markCode() {
    var el = lastCtxEl;
    if (!el || !el.parentNode) return;
    if (closest(el, '.mr-code')) return;      // 已经是代码块
    if (el === document.body || el === document.documentElement) return;
    var key = elemKey(el);                    // 同样要在替换前取索引
    if (decorate([el], true)) {
      post({type: 'mr-block-set', key: key, value: 'force'});
    }
  }

  /* ================= 主题与设置 ================= */

  function applyTheme(t) {
    theme = t === 'dark' ? 'dark' : 'light';
    if (theme === 'dark') document.documentElement.setAttribute('data-mr-theme', 'dark');
    else document.documentElement.removeAttribute('data-mr-theme');
  }

  function applySettings(s) {
    if (!s) return;
    settings = s;
    var de = document.documentElement;
    de.setAttribute('data-mr-font', s.fontFamily === 'sans' ? 'sans' : 'serif');
    de.setAttribute('data-mr-indent', s.indent ? '1' : '0');
    de.setAttribute('data-mr-justify', s.justify ? '1' : '0');
    de.setAttribute('data-mr-dimimg', s.dimImagesInDark ? '1' : '0');
    if (typeof s.fontSize === 'number') de.style.setProperty('--mr-body-fs', s.fontSize + 'px');
    if (typeof s.codeFontSize === 'number') de.style.setProperty('--mr-code-fs', s.codeFontSize + 'px');
    if (typeof s.lineHeight === 'number') de.style.setProperty('--mr-lh', String(s.lineHeight));
    if (typeof s.pageWidth === 'number') de.style.setProperty('--mr-width', s.pageWidth + 'px');

    var wraps = document.querySelectorAll('.mr-code');
    for (var i = 0; i < wraps.length; i++) {
      if (!wraps[i].__mrManual) {
        var auto = settings.autoDetectLang === false ? null : wraps[i].__mrAuto;
        applyLang(wraps[i], auto, false);
      }
      setNums(wraps[i], s.codeLineNumbers !== false);
      refreshFoldable(wraps[i]);
    }
    applyUnify(s.unifyStyle !== false);
  }

  function applyLangOverrides(map) {
    langOverrides = map || {};
    var wraps = document.querySelectorAll('.mr-code');
    for (var i = 0; i < wraps.length; i++) {
      var w = wraps[i];
      var v = langOverrides[blockKey(w.__mrIndex)];
      if (v === undefined || v === null || v === 'auto') {
        applyLang(w, settings && settings.autoDetectLang === false ? null : w.__mrAuto, false);
        continue;
      }
      applyLang(w, v === 'plain' ? '' : v, true);
    }
  }

  function applyBlockOverrides(map) {
    blockOverrides = map || {};
    var wraps = document.querySelectorAll('.mr-code');
    for (var i = 0; i < wraps.length; i++) {
      if (blockOverrides[wraps[i].__mrKey] === 'reject') revertBlock(wraps[i]);
    }
  }

  window.addEventListener('message', function (e) {
    var d = e.data || {};
    switch (d.type) {
      case 'mr-theme':
        applyTheme(d.theme);
        break;
      case 'mr-settings':
        applySettings(d.settings);
        break;
      case 'mr-lang-overrides':
        applyLangOverrides(d.map);
        break;
      case 'mr-block-overrides':
        applyBlockOverrides(d.map);
        break;
      case 'mr-scroll-top':
        scrollTop();
        break;
      case 'mr-copy':
        copySelection();
        break;
      case 'mr-select-all':
        try {
          var r = document.createRange();
          r.selectNodeContents(document.body);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
        } catch (err) { /* 忽略 */ }
        break;
      case 'mr-copy-code':
        var w = findBlock(d.index);
        if (w) copyCode(w);
        break;
      case 'mr-code-action':
        runCodeAction(d);
        break;
      case 'mr-mark-code':
        markCode();
        break;
      default:
        break;
    }
  });

  document.addEventListener('click', closeAnyPop);
  document.addEventListener('contextmenu', onContextMenu);

  /* ================= 表格横向滚动容器 ================= */

  // 给顶层表格套一层 .mr-table-wrap，超宽时可横向滚动而不被 max-width 截断；
  // 单元格内嵌套的内层表格交给外层容器负责，避免重复包裹。
  function wrapTables() {
    var tables = document.querySelectorAll('table');
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      if (closest(t, '.mr-table-wrap')) continue;
      if (closest(t, 'td,th')) continue;
      var wrap = document.createElement('div');
      wrap.className = 'mr-table-wrap';
      t.parentNode.insertBefore(wrap, t);
      wrap.appendChild(t);
    }
  }

  /* ================= 启动 ================= */

  function run() {
    var info = {groups: 0, blocks: 0, rejected: 0};
    try {
      // 顺序不可颠倒：候选识别依赖原书 CSS 生效后的 computed style，
      // 因此必须先采集，再剥离原书样式。
      var groups = collect();
      info.groups = groups.length;
      stripReady = true;
      applyUnify(!settings || settings.unifyStyle !== false);
      for (var i = 0; i < groups.length; i++) {
        try {
          if (decorate(groups[i], false)) info.blocks++;
          else info.rejected++;
        } catch (err) { /* 单个块失败不影响其余 */ }
      }
      wrapTables();
      // 主题/语言/纠正可能早于装饰完成到达，这里补应用一次
      applyBlockOverrides(blockOverrides);
      applyLangOverrides(langOverrides);
      if (settings) applySettings(settings);
    } catch (err) { /* 保证不破坏章节渲染 */ }
    interactive = true;
    try {
      window.__mrInfo = info; // 便于在 devtools 里排查：iframe.contentWindow.__mrInfo
      if (window.parent && window.parent.__MR_DEBUG) console.log('[mr-inject]', info);
    } catch (err) { /* 忽略 */ }
  }

  function boot() {
    if (booted) return;
    booted = true;
    run();
  }

  // 是否存在外链样式表：内联 <style> 在 DOMContentLoaded 时已生效，不必再等
  function hasExternalCSS() {
    try {
      var links = document.getElementsByTagName('link');
      for (var i = 0; i < links.length; i++) {
        if (/(^|\s)stylesheet(\s|$)/i.test(links[i].getAttribute('rel') || '')) return true;
      }
    } catch (err) { /* 忽略 */ }
    return false;
  }

  function schedule() {
    if (document.readyState === 'complete' || !hasExternalCSS()) { boot(); return; }
    var done = false;
    window.addEventListener('load', function () { if (!done) { done = true; boot(); } });
    // 兜底：外链 CSS 迟迟不 load 时也不让页面一直等
    setTimeout(function () { if (!done) { done = true; boot(); } }, 400);
  }

  // 调试钩子：可在 devtools 控制台直接验证，例如
  // window.__mrHighlight('public class A {}', 'java')
  try {
    window.__mrHighlight = function (c, l) { return HL.highlight ? HL.highlight(c, l) : esc(c); };
    window.__mrDetectLang = function (c) { return HL.detectLang ? HL.detectLang(c, null) : null; };
    window.__mrScore = function (c, el) { return scoreCode(el || document.body, c); };
  } catch (err) { /* 忽略 */ }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule);
  } else {
    schedule();
  }
})();
