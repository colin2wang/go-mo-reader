/*
 * mr-inject.js — 墨阅 EPUB 阅读器章节注入脚本
 * 由 Go AssetServer 在返回章节 HTML 时以 <script src="/mr-inject.js" defer> 注入。
 * 职责：
 *   1) 扫描章节内代码块（<pre>/块级 <code>/DocBook 容器 + 语义类名 +
 *      等宽字体或 white-space:pre 计算样式启发式），相邻代码段落自动合并
 *   2) 自研无依赖语法高亮（19 种语言 + 类名检测 + 关键字/XML 启发式检测）
 *   3) 响应主窗口 postMessage({type:'mr-font',delta}) 进行字号调节（zoom 缩放）
 */
(function () {
  'use strict';

  /* ================= 语言定义 ================= */

  function L(kw, opt) {
    opt = opt || {};
    return {
      kw: kw,
      lc: opt.lc || null,      // 行注释前缀
      bc: opt.bc || null,      // 块注释 [start,end]
      str: opt.str || null,    // 单行字符串引号
      mstr: opt.mstr || null,  // 可跨行字符串引号（非贪婪）
      num: opt.num !== false,  // 数字
      preproc: !!opt.preproc,  // 行首 # 预处理
      css: !!opt.css,          // CSS 特化（hex 颜色 / 单位）
      builtins: opt.bi || null
    };
  }

  var JS_KW = 'var let const function class if else for while do return new this typeof instanceof in of import export from default async await try catch finally throw switch case break continue null undefined true false extends super static get set yield delete void interface type enum implements namespace declare readonly public private protected as satisfies keyof infer is abstract override';
  var PY_KW = 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield True False None match case';
  var GO_KW = 'package import func var const type struct interface map chan go defer select switch case if else for range return break continue fallthrough nil true false iota goto';
  var JAVA_KW = 'public private protected class interface extends implements static final void int long double float boolean char byte short new return if else for while do switch case break continue default try catch finally throw throws import package this super null true false abstract synchronized volatile transient enum record var sealed permits instanceof';
  var C_KW = 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while class new delete this template typename namespace using public private protected virtual override final try catch throw operator explicit constexpr nullptr NULL true false mutable noexcept concept requires co_await co_return';
  var CS_KW = 'public private protected internal class struct interface record enum static readonly const void int long double float bool char byte short decimal object string new return if else for foreach while do switch case break continue default try catch finally throw using namespace this base null true false abstract virtual override sealed async await var dynamic is as in out ref params get set yield lock event delegate volatile checked unchecked nameof typeof';
  var SQL_KW = 'select from where insert into values update set delete create table drop alter add column primary key foreign references index view distinct union all group by order having limit offset join left right inner outer full cross on as and or not null is like in between exists case when then else end asc desc count sum avg min max begin commit rollback transaction with recursive default check unique constraint';
  var RUST_KW = 'fn let mut const static struct enum impl trait pub use mod match if else for while loop return break continue self Self crate super where async await move ref dyn box unsafe as in true false type extern macro dyn';
  var PHP_KW = 'function class interface trait extends implements public private protected static final abstract echo print return if else elseif foreach for while do switch case break continue default new clone try catch finally throw namespace use as null true false global list match enum readonly instanceof';
  var KT_KW = 'fun val var class object interface data sealed enum companion init constructor if else for while do when return break continue import package as is in null true false this super private public internal protected open override final abstract lateinit suspend inline reified operator infix const by lazy where typealias';
  var SWIFT_KW = 'func let var class struct enum protocol extension if else for while repeat switch case return break continue import struct deinit init self super nil true false guard defer do try catch throw throws async await where in as is some any actor static public private internal open final override lazy weak unowned mutating subscript typealias associatedtype';
  var DART_KW = 'var final const void int double num bool String List Map Set dynamic if else for while do switch case return break continue import library part of class extends implements with mixin abstract interface enum new this super null true false async await yield late required is as in get set static final covariant factory operator typedef Future Stream';
  var LUA_KW = 'and break do else elseif end false for function goto if in local nil not or repeat return then true until while self';
  var RUBY_KW = 'def end class module if elsif else unless case when while until for in do then begin rescue ensure raise return yield self nil true false and or not require require_relative attr_accessor attr_reader attr_writer puts lambda proc new super private public protected';
  var BASH_KW = 'if then else elif fi for while until do done case esac function in select time coproc return exit break continue local export readonly declare unset shift trap eval exec source alias set echo read cd pushd printf test';

  var LANGS = {
    python: L(PY_KW, { lc: ['#'], bc: [], str: ['"', "'"], mstr: ['"""', "'''"], bi: 'print len range enumerate zip map filter open input int float str list dict set tuple sum min max abs sorted any all isinstance type super self'.split(' ') }),
    javascript: L(JS_KW, { lc: ['//'], bc: [['/*', '*/']], str: ['"', "'"], mstr: ['`'], bi: 'console log error warn document window fetch Promise Array Object JSON Math Number String Map Set parseInt parseFloat setTimeout setInterval require module exports process alert' }),
    go: L(GO_KW, { lc: ['//'], bc: [['/*', '*/']], str: ['"', "'"], mstr: ['`'], bi: 'make new len cap append delete copy panic recover print println fmt Printf Println Sprintf Errorf Error nil err string int int64 float64 bool byte rune error' }),
    java: L(JAVA_KW, { lc: ['//'], bc: [['/*', '*/']], str: ['"', "'"], bi: 'System out println String Integer Long Double Boolean List Map ArrayList HashMap Optional Stream' }),
    cpp: L(C_KW, { lc: ['//'], bc: [['/*', '*/']], str: ['"', "'"], preproc: true, bi: 'std cout cin endl vector string map set printf malloc free include define' }),
    csharp: L(CS_KW, { lc: ['//'], bc: [['/*', '*/']], str: ['"', "'"], bi: 'Console WriteLine Console.WriteLine String Int32 List Dictionary Task' }),
    sql: L(SQL_KW, { lc: ['--'], bc: [['/*', '*/']], str: ["'"], num: true }),
    rust: L(RUST_KW, { lc: ['//'], bc: [['/*', '*/']], str: ['"'], mstr: ['r#"'], bi: 'println vec Some None Ok Err Option Result Box Rc Arc Vec String HashMap' }),
    php: L(PHP_KW, { lc: ['//', '#'], bc: [['/*', '*/']], str: ['"', "'"], bi: 'echo var_dump print_r array count strlen preg_match' }),
    kotlin: L(KT_KW, { lc: ['//'], bc: [['/*', '*/']], str: ['"'], mstr: ['"""'], bi: 'println print listOf mapOf setOf mutableListOf' }),
    swift: L(SWIFT_KW, { lc: ['//'], bc: [['/*', '*/']], str: ['"'], mstr: ['"""'], bi: 'print String Int Double Array Dictionary Set' }),
    dart: L(DART_KW, { lc: ['//'], bc: [['/*', '*/']], str: ['"', "'"], mstr: ["'''", '"""'], bi: 'print List Map Set String int double' }),
    lua: L(LUA_KW, { lc: ['--'], bc: [['--[[', ']]']], str: ['"', "'"], bi: 'print pairs ipairs require table string math type tostring tonumber' }),
    ruby: L(RUBY_KW, { lc: ['#'], bc: [], str: ['"', "'"], mstr: [], bi: 'puts print p require each map select reject times' }),
    bash: L(BASH_KW, { lc: ['#'], bc: [], str: ['"', "'"], bi: 'ls cp mv rm mkdir grep sed awk cat sudo apt git npm node curl wget chmod chown tar zip find' }),
    css: L('@media @import @keyframes @supports @font-face @charset @page important from to and not only'.split(' '), { lc: [], bc: [['/*', '*/']], str: ['"', "'"], num: true, css: true }),
    json: L('true false null'.split(' '), { lc: [], bc: [], str: ['"'], num: true }),
    yaml: L('true false null yes no on off'.split(' '), { lc: ['#'], bc: [], str: ['"', "'"], num: true })
  };

  var ALIAS = {
    py: 'python', python3: 'python',
    js: 'javascript', node: 'javascript', jsx: 'javascript', ts: 'javascript', tsx: 'javascript', typescript: 'javascript', mjs: 'javascript', javascript: 'javascript',
    go: 'go', golang: 'go',
    java: 'java',
    c: 'cpp', 'c++': 'cpp', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', h: 'cpp', cxx: 'cpp',
    cs: 'csharp', csharp: 'csharp', 'c#': 'csharp',
    sql: 'sql', mysql: 'sql', postgresql: 'sql', psql: 'sql', sqlite: 'sql', plsql: 'sql',
    rs: 'rust', rust: 'rust',
    php: 'php', php3: 'php', php5: 'php', php7: 'php',
    kt: 'kotlin', kotlin: 'kotlin',
    swift: 'swift',
    dart: 'dart',
    lua: 'lua',
    rb: 'ruby', ruby: 'ruby',
    sh: 'bash', bash: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', terminal: 'bash',
    css: 'css', scss: 'css', less: 'css',
    json: 'json', json5: 'json',
    yml: 'yaml', yaml: 'yaml',
    html: 'html', xhtml: 'html', xml: 'html', svg: 'html', vue: 'html'
  };

  var HEUR_ORDER = ['python', 'javascript', 'go', 'java', 'cpp', 'csharp', 'sql', 'rust', 'php', 'kotlin', 'swift', 'dart', 'bash', 'ruby', 'lua'];

  /* ================= 基础工具 ================= */

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* ================= 高亮引擎 ================= */

  var reCache = {};
  // 返回 { re: RegExp, types: string[] }，types[i] 对应第 i+1 个捕获组
  function buildRegex(name) {
    if (reCache[name]) return reCache[name];
    var lang = LANGS[name];
    var types = [], src = [];
    function push(type, s) { types.push(type); src.push(s); }

    // 注意：JS 正则不支持 (?m) 内联标志，^ 的多行语义改用正则的 m 标志实现
    if (lang.preproc) push('kw', '^[ \\t]*#[a-z_]+');
    if (lang.bc) for (var b = 0; b < lang.bc.length; b++) {
      var pair = lang.bc[b];
      push('com', escRe(pair[0]) + '[\\s\\S]*?(?:' + escRe(pair[1]) + '|$)');
    }
    if (lang.lc) for (var l = 0; l < lang.lc.length; l++) push('com', escRe(lang.lc[l]) + '[^\\n]*');
    if (lang.mstr) for (var m = 0; m < lang.mstr.length; m++) {
      push('str', escRe(lang.mstr[m]) + '[\\s\\S]*?' + escRe(lang.mstr[m]));
    }
    if (lang.str) for (var s = 0; s < lang.str.length; s++) {
      var q = escRe(lang.str[s]);
      push('str', q + '(?:\\\\.|[^\\\\\\n' + q + '])*' + q + '?');
    }
    if (lang.css) push('num', '#[0-9a-fA-F]{3,8}\\b|\\b\\d[\\d.]*(?:px|em|rem|%|vh|vw|vmin|vmax|s|ms|deg|fr|ch|pt|dpi)?\\b');
    else if (lang.num) push('num', '\\b0[xX][0-9a-fA-F_]+\\b|\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?[a-zA-Z]{0,3}\\b');
    push('id', '[@$]?[A-Za-z_\\u00C0-\\uFFFF][\\w$\\u00C0-\\uFFFF-]*');

    var re = new RegExp('(' + src.join(')|(') + ')', lang.preproc ? 'gm' : 'g');
    reCache[name] = { re: re, types: types };
    return reCache[name];
  }

  function classifyIdent(word, lang, code, endPos) {
    if (lang.kw.indexOf(word) >= 0) return 'kw';
    if (lang.builtins && lang.builtins.indexOf(word) >= 0) return 'fn';
    var nxt = code.slice(endPos).match(/^\s*([\s\S])/);
    if (nxt && nxt[1] === '(') return 'fn';
    if (lang.css) {
      var after = code.slice(endPos).match(/^\s*:/);
      if (after) return 'type';
      return 'punc';
    }
    if (/^[A-Z]/.test(word)) return 'type';
    return '';
  }

  function highlight(code, langName) {
    if (langName === 'html') return highlightHTML(code);
    var lang = LANGS[langName];
    if (!lang) return esc(code);
    var built = buildRegex(langName);
    var re = built.re, types = built.types;
    re.lastIndex = 0;
    var out = '', last = 0, m;
    while ((m = re.exec(code))) {
      if (m.index > last) out += esc(code.slice(last, m.index));
      var txt = m[0], cls = '';
      // 找到本次命中的捕获组：多分支交替下只有命中的那一个组有值
      for (var g = 1; g < m.length; g++) {
        if (m[g] !== undefined && m[g] !== '') {
          var t = types[g - 1];
          if (t === 'id') {
            var word = txt.replace(/^[@$]/, '');
            cls = classifyIdent(word, lang, code, re.lastIndex);
          } else cls = t;
          break;
        }
      }
      out += cls ? '<span class="tok-' + cls + '">' + esc(txt) + '</span>' : esc(txt);
      last = re.lastIndex;
      if (m[0].length === 0) re.lastIndex++;
    }
    out += esc(code.slice(last));
    return out;
  }

  // HTML/XML 特化：注释 / 标签内部（标签名、属性名、属性值）
  function highlightHTML(code) {
    var out = '', i = 0, n = code.length;
    while (i < n) {
      if (code.startsWith('<!--', i)) {
        var end = code.indexOf('-->', i);
        var seg = end < 0 ? code.slice(i) : code.slice(i, end + 3);
        out += '<span class="tok-com">' + esc(seg) + '</span>';
        i += seg.length;
      } else if (code[i] === '<') {
        var gt = code.indexOf('>', i);
        var tag = gt < 0 ? code.slice(i) : code.slice(i, gt + 1);
        out += tagInner(tag);
        i += tag.length;
      } else {
        var lt = code.indexOf('<', i);
        var dm = lt < 0 ? code.slice(i) : code.slice(i, lt);
        out += esc(dm).replace(/&[a-zA-Z#\d]+;/g, '<span class="tok-num">$&</span>');
        i += dm.length;
      }
    }
    return out;
  }
  function tagInner(tag) {
    return tag.replace(/([\w:-]+)=(("[^"]*")|('[^']*'))/g,
      '<span class="tok-type">$1</span>=<span class="tok-str">$2</span>')
      .replace(/^(&lt;\/?)([\w:-]+)/, function (_, a, name) {
        return a + '<span class="tok-fn">' + name + '</span>';
      })
      .replace(/^</, '&lt;').replace(/^&lt;/, '&lt;')
      .replace(/>$/, '&gt;');
  }

  /* ================= 语言检测 ================= */

  function detectLang(code, el) {
    var scope = el, depth = 0;
    while (scope && depth < 4) {
      var cn = (scope.getAttribute && scope.getAttribute('class')) || '';
      var mm = cn.match(/(?:language|lang|highlight|syntax|brush)[\s:-]*([\w+#]+)/i);
      if (mm) {
        var key = mm[1].toLowerCase();
        if (ALIAS[key]) return ALIAS[key];
        if (LANGS[key]) return key;
      }
      scope = scope.parentElement; depth++;
    }
    // XML/HTML 启发式：<?xml 声明或成对标签 → 复用 html 高亮器（Maven/ant/布局 XML 等）
    if (/^\s*<\?xml/i.test(code) ||
        (/<[a-zA-Z][\w:.-]*(\s[^<>]*)?>/.test(code) && /<\/[a-zA-Z][\w:.-]*\s*>/.test(code))) {
      return 'html';
    }

    // 启发式：关键字计数
    var best = null, bestScore = 0;
    for (var i = 0; i < HEUR_ORDER.length; i++) {
      var name = HEUR_ORDER[i];
      var list = LANGS[name].kw;
      var score = 0;
      for (var k = 0; k < list.length; k++) {
        var w = list[k];
        if (w.indexOf(' ') >= 0) continue;
        var hits = code.match(new RegExp('\\b' + w + '\\b', 'g'));
        if (hits) score += Math.min(hits.length, 3);
      }
      if (score > bestScore) { bestScore = score; best = name; }
    }
    return bestScore >= 3 ? best : null;
  }

  /* ================= 代码块候选识别 ================= */

  // 等宽字体（各 EPUB 使用的字体名并不统一）
  var MONO_RE = /(mono|consolas|courier|menlo|monaco|andale|source\s?code\s?pro|jetbrains|dejavu sans mono)/i;
  // 语义类名：code / code-block / programlisting / literallayout / screen / snippet ...
  var CLASS_RE = /(^|[\s_-])(code|codeblock|codeline|programlisting|literallayout|screen|listing|snippet|sourcecode|highlight|monospace|computeroutput|literal|pre)([\s_-]|$)/i;
  // 语义标签：HTML 原生 + DocBook 常用容器
  var TAG_SELECTOR = 'pre,code,xmp,plaintext,programlisting,literallayout,screen,listing,computeroutput';
  // 容器内已有更具体的代码块时，交给内层处理
  var INNER_SELECTOR = 'pre,code,xmp,img,table,video,canvas,.mr-code';
  // 容器内还有块级子元素（如 <div class="code"><p>…</p></div>）时同理交给内层
  var BLOCK_KIDS = 'p,div,ul,ol,h1,h2,h3,h4,h5,h6,table';
  var MAX_SCAN = 4000; // 单次扫描元素上限，防止超长章节拖慢渲染

  function markDone(el) {
    el.__mrdone = true;
    var kids = el.querySelectorAll ? el.querySelectorAll('*') : [];
    for (var i = 0; i < kids.length; i++) kids[i].__mrdone = true;
  }

  function markAllDone(run) {
    for (var i = 0; i < run.length; i++) markDone(run[i]);
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

  // 收集候选并按"相邻兄弟"分组：逐行 <p class="code"> 会被合并成一个代码块
  function collect() {
    var groups = [], hits = [], used = [], i, el;

    var byTag = document.querySelectorAll(TAG_SELECTOR);
    for (i = 0; i < byTag.length; i++) {
      el = byTag[i];
      // 行内 <code>foo</code> 属于正文的一部分，只有块级或多行时才装饰
      if (el.tagName === 'CODE') {
        var cs = window.getComputedStyle(el);
        if ((!cs || cs.display === 'inline') && el.textContent.indexOf('\n') < 0) continue;
      }
      groups.push([el]);
    }

    var all = document.body ? document.body.querySelectorAll('div,p,li,dd,td,blockquote,section,article') : [];
    var limit = Math.min(all.length, MAX_SCAN);
    for (i = 0; i < limit; i++) {
      el = all[i];
      if (el.__mrdone) continue;
      if (!hasClassHint(el) && !isMonoBlock(el)) continue;
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
    return groups;
  }

  /* ================= 语言工具条（逐块独立） ================= */

  // 候选语言沿用 LANGS 的键 + html（走 highlightHTML），避免维护两份清单
  var LANG_ORDER = ['python', 'javascript', 'go', 'java', 'cpp', 'csharp', 'sql', 'rust', 'php',
    'kotlin', 'swift', 'dart', 'lua', 'ruby', 'bash', 'css', 'json', 'yaml', 'html'];
  var LANG_LABEL = {
    python: 'Python', javascript: 'JavaScript', go: 'Go', java: 'Java', cpp: 'C/C++', csharp: 'C#',
    sql: 'SQL', rust: 'Rust', php: 'PHP', kotlin: 'Kotlin', swift: 'Swift', dart: 'Dart', lua: 'Lua',
    ruby: 'Ruby', bash: 'Shell', css: 'CSS', json: 'JSON', yaml: 'YAML', html: 'HTML/XML'
  };
  var blockSeq = 0;            // 本章内代码块序号，用于逐块记忆的 key
  var pendingOverrides = null; // 父窗口下发的逐块语言选择
  var openPop = null;

  function langLabel(lang) {
    return lang ? (LANG_LABEL[lang] || lang) : '纯文本';
  }

  function blockKey(index) {
    try { return location.pathname + '#' + index; } catch (err) { return '#' + index; }
  }

  function applyTheme(theme) {
    var de = document.documentElement;
    if (theme === 'dark') de.setAttribute('data-mr-code-theme', 'dark');
    else de.removeAttribute('data-mr-code-theme');
  }

  function closeAnyPop() {
    if (openPop) { openPop.className = 'mr-lang-pop'; openPop = null; }
  }

  function markLangItems(wrap, value) {
    var items = wrap.querySelectorAll('.mr-lang-item');
    for (var i = 0; i < items.length; i++) {
      items[i].className = items[i].getAttribute('data-v') === value ? 'mr-lang-item active' : 'mr-lang-item';
    }
  }

  // 重新高亮：只替换 code 内容，行号列不变（行数相同）
  function applyLang(wrap, lang, manual) {
    var codeEl = wrap.querySelector('code');
    if (codeEl) codeEl.innerHTML = lang ? highlight(wrap.__mrSrc, lang) : esc(wrap.__mrSrc);
    wrap.className = 'mr-code' + (lang ? ' mr-lang-' + lang : '');
    if (wrap.__mrLabel) wrap.__mrLabel.textContent = (manual ? '' : '自动 · ') + langLabel(lang);
    markLangItems(wrap, manual ? (lang || 'plain') : 'auto');
  }

  function buildBar(wrap, index, auto) {
    var bar = document.createElement('div');
    bar.className = 'mr-bar';

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

    function addItem(label, value) {
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
        try {
          // 逐块选择回传主窗口持久化（key = 章节路径#块序号）
          window.parent.postMessage({type: 'mr-lang-set', key: blockKey(index), lang: value}, '*');
        } catch (err) { /* 忽略 */ }
      });
      pop.appendChild(it);
    }

    addItem('自动 · ' + langLabel(auto), 'auto');
    addItem('纯文本', 'plain');
    for (var i = 0; i < LANG_ORDER.length; i++) {
      var n = LANG_ORDER[i];
      if (n !== 'html' && !LANGS[n]) continue;
      addItem(LANG_LABEL[n] || n, n);
    }

    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (openPop === pop) { closeAnyPop(); return; }
      closeAnyPop();
      pop.className = 'mr-lang-pop open';
      openPop = pop;
    });

    bar.appendChild(btn);
    bar.appendChild(pop);
    wrap.appendChild(bar);
    name.textContent = '自动 · ' + langLabel(auto);
    markLangItems(wrap, 'auto');
  }

  function applyOverrides(map) {
    var wraps = document.querySelectorAll('.mr-code');
    for (var i = 0; i < wraps.length; i++) {
      var w = wraps[i];
      var v = map[blockKey(w.__mrIndex)];
      if (v === undefined || v === null || v === 'auto') { applyLang(w, w.__mrAuto, false); continue; }
      var lang = v === 'plain' ? '' : v;
      if (lang && !LANGS[lang] && lang !== 'html') continue;
      applyLang(w, lang, true);
    }
  }

  document.addEventListener('click', closeAnyPop);

  /* ================= 行号装饰 ================= */

  // run 为待装饰的元素数组：单个 <pre>，或合并后的连续代码段落
  function decorate(run) {
    var first = run[0];
    if (!first || first.__mrdone) return false;

    for (var i = 0; i < run.length; i++) {
      // ASCII 图 / 复杂内容跳过
      if (run[i].querySelector && run[i].querySelector('img,video,canvas,table')) { markAllDone(run); return false; }
    }

    var parts = [];
    for (i = 0; i < run.length; i++) parts.push(run[i].textContent.replace(/\r\n?/g, '\n'));
    var code = parts.join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
    if (!code.trim()) { markAllDone(run); return false; }
    if (code.indexOf('\n') < 0 && code.length < 24) { markAllDone(run); return false; } // 极短行内代码不包装
    var lang = detectLang(code, first);
    var html = highlight(code, lang || '');
    var lines = html.split('\n');
    var nums = [];
    for (i = 1; i <= lines.length; i++) nums.push(i);

    var wrap = document.createElement('div');
    wrap.className = 'mr-code' + (lang ? ' mr-lang-' + lang : '');
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

    // 保存源码、自动检测结果与块序号，供逐块切换语言时重算
    wrap.__mrSrc = code;
    wrap.__mrAuto = lang;
    wrap.__mrIndex = blockSeq++;
    buildBar(wrap, wrap.__mrIndex, lang);

    // 用代码块整体替换原元素（可能是连续的多段）
    first.parentNode.insertBefore(wrap, first);
    for (i = 0; i < run.length; i++) {
      markDone(run[i]);
      if (run[i].parentNode) run[i].parentNode.removeChild(run[i]);
    }
    return true;
  }

  /* ================= 字号控制 ================= */

  var zoom = 1;
  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === 'mr-font') {
      if (typeof d.set === 'number') {
        zoom = Math.min(2, Math.max(0.6, d.set));
      } else {
        zoom = Math.min(2, Math.max(0.6, zoom + (d.delta || 0)));
      }
      document.documentElement.style.setProperty('zoom', String(zoom));
    } else if (d.type === 'mr-scroll-top') {
      window.scrollTo({ top: 0 });
    } else if (d.type === 'mr-code-theme') {
      applyTheme(d.theme); // 'dark' 或 'light'
    } else if (d.type === 'mr-lang-overrides') {
      pendingOverrides = d.map || {};
      applyOverrides(pendingOverrides);
    }
  });

  /* ================= 启动 ================= */

  function run() {
    var info = {groups: 0, blocks: 0};
    try {
      var groups = collect();
      info.groups = groups.length;
      for (var i = 0; i < groups.length; i++) {
        try {
          if (decorate(groups[i])) info.blocks++;
        } catch (err) { /* 单个块失败不影响其余 */ }
      }
      // 主题/语言覆盖可能早于装饰完成到达，这里补应用一次
      if (pendingOverrides) applyOverrides(pendingOverrides);
    } catch (err) { /* 保证不破坏章节渲染 */ }
    try {
      window.__mrInfo = info; // 便于在 devtools 里排查：iframe.contentWindow.__mrInfo
      if (window.parent && window.parent.__MR_DEBUG) console.log('[mr-inject]', info);
    } catch (err) { /* 忽略 */ }
  }
  // 调试钩子：可在 devtools 控制台直接验证着色输出，例如
  // window.__mrHighlight('public class A {}', 'java')
  try {
    window.__mrHighlight = highlight;
    window.__mrDetectLang = detectLang;
  } catch (err) { /* 忽略 */ }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
