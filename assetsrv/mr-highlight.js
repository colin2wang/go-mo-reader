/*
 * mr-highlight.js — 墨阅语法高亮与语言判别（零依赖兜底引擎）
 *
 * 由 Go AssetServer 以 <script src="/mr-highlight.js"> 注入章节（在 mr-inject.js 之前同步执行）。
 * 定位：highlight.js（/mr-vendor/highlight.js）未构建或加载失败时的降级方案，
 * 同时提供语言判别与文本统计能力，供 mr-inject.js 判断「这段到底是不是代码」。
 *
 * 对外接口（window.__mrHL）：
 *   highlight(code, lang) -> html      着色；优先走 hljs，缺失时用内置引擎
 *   detectLang(code, el)  -> string|null  三级判别：类名 → 特征签名 → hljs/关键字评分
 *   stats(code)           -> {lines,cjk,avgLen,punct,indent,codePunct,art}  文本特征统计
 *   isProse(code)         -> boolean   是否更像自然语言段落
 *   langLabel(lang) / LANG_ORDER / hasLang(name)
 */
(function () {
  'use strict';

  /* ================= 语言定义 ================= */

  function words(s) {
    var out = {}, list = s.split(/\s+/);
    for (var i = 0; i < list.length; i++) if (list[i]) out[list[i]] = true;
    return out;
  }

  // 注意：关键字一律转成 {word:true} 映射。早期版本直接对空格串做 indexOf 子串匹配，
  // 导致 "in" 命中 "interface"、"if" 命中 "notify" 之类的误判，这里必须全词匹配。
  function L(kw, opt) {
    opt = opt || {};
    return {
      kw: words(kw),
      lc: opt.lc || null,      // 行注释前缀
      bc: opt.bc || null,      // 块注释 [start,end]
      str: opt.str || null,    // 单行字符串引号
      mstr: opt.mstr || null,  // 可跨行字符串引号
      num: opt.num !== false,  // 数字
      preproc: !!opt.preproc,  // 行首 # 预处理
      css: !!opt.css,          // CSS 特化（hex 颜色 / 单位）
      bi: opt.bi ? words(opt.bi) : null
    };
  }

  var JS_KW = 'var let const function class if else for while do return new this typeof instanceof in of import export from default async await try catch finally throw switch case break continue null undefined true false extends super static get set yield delete void interface type enum implements namespace declare readonly public private protected as satisfies keyof infer is abstract override';
  var PY_KW = 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield True False None match case';
  var GO_KW = 'package import func var const type struct interface map chan go defer select switch case if else for range return break continue fallthrough nil true false iota goto';
  var JAVA_KW = 'public private protected class interface extends implements static final void int long double float boolean char byte short new return if else for while do switch case break continue default try catch finally throw throws import package this super null true false abstract synchronized volatile transient enum record var sealed permits instanceof';
  var C_KW = 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while class new delete this template typename namespace using public private protected virtual override final try catch throw operator explicit constexpr nullptr NULL true false mutable noexcept concept requires';
  var CS_KW = 'public private protected internal class struct interface record enum static readonly const void int long double float bool char byte short decimal object string new return if else for foreach while do switch case break continue default try catch finally throw using namespace this base null true false abstract virtual override sealed async await var dynamic is as in out ref params get set yield lock event delegate volatile checked unchecked nameof typeof';
  var SQL_KW = 'select from where insert into values update set delete create table drop alter add column primary key foreign references index view distinct union all group by order having limit offset join left right inner outer full cross on as and or not null is like in between exists case when then else end asc desc count sum avg min max begin commit rollback transaction with recursive default check unique constraint';
  var RUST_KW = 'fn let mut const static struct enum impl trait pub use mod match if else for while loop return break continue self Self crate super where async await move ref dyn box unsafe as in true false type extern macro';
  var PHP_KW = 'function class interface trait extends implements public private protected static final abstract echo print return if else elseif foreach for while do switch case break continue default new clone try catch finally throw namespace use as null true false global list match enum readonly instanceof';
  var KT_KW = 'fun val var class object interface data sealed enum companion init constructor if else for while do when return break continue import package as is in null true false this super private public internal protected open override final abstract lateinit suspend inline reified operator infix const by lazy where typealias';
  var SWIFT_KW = 'func let var class struct enum protocol extension if else for while repeat switch case return break continue import deinit init self super nil true false guard defer do try catch throw throws async await where in as some any actor static public private internal open final override lazy weak unowned mutating subscript typealias associatedtype';
  var DART_KW = 'var final const void int double num bool String List Map Set dynamic if else for while do switch case return break continue import library part of class extends implements with mixin abstract interface enum new this super null true false async await yield late required is as in get set static covariant factory operator Future Stream';
  var LUA_KW = 'and break do else elseif end false for function goto if in local nil not or repeat return then true until while self';
  var RUBY_KW = 'def end class module if elsif else unless case when while until for in do then begin rescue ensure raise return yield self nil true false and or not require require_relative attr_accessor attr_reader attr_writer puts lambda proc new super private public protected';
  var BASH_KW = 'if then else elif fi for while until do done case esac function in select time coproc return exit break continue local export readonly declare unset shift trap eval exec source alias set echo read cd pushd printf test';

  var LANGS = {
    python: L(PY_KW, {lc: ['#'], str: ['"', "'"], mstr: ['"""', "'''"], bi: 'print len range enumerate zip map filter open input int float str list dict set tuple sum min max abs sorted any all isinstance type super self'}),
    javascript: L(JS_KW, {lc: ['//'], bc: [['/*', '*/']], str: ['"', "'"], mstr: ['`'], bi: 'console log document window fetch Promise Array Object JSON Math Number String Map Set parseInt parseFloat setTimeout setInterval require module exports process alert'}),
    go: L(GO_KW, {lc: ['//'], bc: [['/*', '*/']], str: ['"', "'"], mstr: ['`'], bi: 'make new len cap append delete copy panic recover print println fmt Printf Println Sprintf Errorf Error nil err string int int64 float64 bool byte rune error'}),
    java: L(JAVA_KW, {lc: ['//'], bc: [['/*', '*/']], str: ['"', "'"], bi: 'System out println String Integer Long Double Boolean List Map ArrayList HashMap Optional Stream'}),
    cpp: L(C_KW, {lc: ['//'], bc: [['/*', '*/']], str: ['"', "'"], preproc: true, bi: 'std cout cin endl vector string map set printf malloc free include define'}),
    csharp: L(CS_KW, {lc: ['//'], bc: [['/*', '*/']], str: ['"', "'"], bi: 'Console WriteLine String Int32 List Dictionary Task'}),
    sql: L(SQL_KW, {lc: ['--'], bc: [['/*', '*/']], str: ["'"]}),
    rust: L(RUST_KW, {lc: ['//'], bc: [['/*', '*/']], str: ['"'], mstr: ['r#"'], bi: 'println vec Some None Ok Err Option Result Box Rc Arc Vec String HashMap'}),
    php: L(PHP_KW, {lc: ['//', '#'], bc: [['/*', '*/']], str: ['"', "'"], bi: 'echo var_dump print_r array count strlen preg_match'}),
    kotlin: L(KT_KW, {lc: ['//'], bc: [['/*', '*/']], str: ['"'], mstr: ['"""'], bi: 'println print listOf mapOf setOf mutableListOf'}),
    swift: L(SWIFT_KW, {lc: ['//'], bc: [['/*', '*/']], str: ['"'], mstr: ['"""'], bi: 'print String Int Double Array Dictionary Set'}),
    dart: L(DART_KW, {lc: ['//'], bc: [['/*', '*/']], str: ['"', "'"], mstr: ["'''", '"""'], bi: 'print List Map Set String int double'}),
    lua: L(LUA_KW, {lc: ['--'], bc: [['--[[', ']]']], str: ['"', "'"], bi: 'print pairs ipairs require table string math type tostring tonumber'}),
    ruby: L(RUBY_KW, {lc: ['#'], str: ['"', "'"], bi: 'puts print require each map select reject times'}),
    bash: L(BASH_KW, {lc: ['#'], str: ['"', "'"], bi: 'ls cp mv rm mkdir grep sed awk cat sudo apt git npm node curl wget chmod chown tar zip find'}),
    css: L('@media @import @keyframes @supports @font-face @charset @page important from to and not only', {bc: [['/*', '*/']], str: ['"', "'"], css: true}),
    json: L('true false null', {str: ['"']}),
    yaml: L('true false null yes no on off', {lc: ['#'], str: ['"', "'"]})
  };

  var ALIAS = {
    py: 'python', python3: 'python',
    js: 'javascript', node: 'javascript', jsx: 'javascript', ts: 'javascript', tsx: 'javascript',
    typescript: 'javascript', mjs: 'javascript', cjs: 'javascript',
    go: 'go', golang: 'go',
    java: 'java',
    c: 'cpp', 'c++': 'cpp', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', h: 'cpp', cxx: 'cpp',
    cs: 'csharp', csharp: 'csharp', 'c#': 'csharp',
    sql: 'sql', mysql: 'sql', postgresql: 'sql', psql: 'sql', sqlite: 'sql', plsql: 'sql',
    rs: 'rust',
    php: 'php', php3: 'php', php5: 'php', php7: 'php', php8: 'php',
    kt: 'kotlin', kts: 'kotlin',
    swift: 'swift',
    dart: 'dart',
    lua: 'lua',
    rb: 'ruby',
    sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', terminal: 'bash',
    css: 'css', scss: 'css', less: 'css',
    json: 'json', json5: 'json',
    yml: 'yaml',
    html: 'html', xhtml: 'html', xml: 'html', svg: 'html', vue: 'html'
  };

  // 内置引擎名 → highlight.js 注册名（仅少数不一致）
  var HLJS_NAME = {html: 'xml'};

  var LANG_ORDER = ['python', 'javascript', 'go', 'java', 'cpp', 'csharp', 'sql', 'rust', 'php',
    'kotlin', 'swift', 'dart', 'lua', 'ruby', 'bash', 'css', 'json', 'yaml', 'html'];
  var LANG_LABEL = {
    python: 'Python', javascript: 'JavaScript', go: 'Go', java: 'Java', cpp: 'C/C++', csharp: 'C#',
    sql: 'SQL', rust: 'Rust', php: 'PHP', kotlin: 'Kotlin', swift: 'Swift', dart: 'Dart', lua: 'Lua',
    ruby: 'Ruby', bash: 'Shell', css: 'CSS', json: 'JSON', yaml: 'YAML', html: 'HTML/XML',
    ini: 'INI', markdown: 'Markdown', diff: 'Diff', makefile: 'Makefile',
    dockerfile: 'Dockerfile', nginx: 'Nginx', perl: 'Perl', scala: 'Scala',
    objectivec: 'Objective-C', properties: 'Properties'
  };
  // 关键字启发式的候选顺序（去掉 json/yaml/css/html 这类靠结构识别的语言）
  var HEUR_ORDER = ['python', 'javascript', 'go', 'java', 'cpp', 'csharp', 'sql', 'rust', 'php',
    'kotlin', 'swift', 'dart', 'bash', 'ruby', 'lua'];

  /* ================= 基础工具 ================= */

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  function langLabel(lang) {
    return lang ? (LANG_LABEL[lang] || lang) : '纯文本';
  }
  // 内置引擎支持的语言，或 highlight.js 已注册的语言，都算可用
  function hasLang(name) {
    if (!name) return false;
    if (name === 'html' || Object.prototype.hasOwnProperty.call(LANGS, name)) return true;
    try {
      var hljs = window.hljs;
      return !!(hljs && hljs.getLanguage && hljs.getLanguage(hljsName(name)));
    } catch (err) {
      return false;
    }
  }
  function hljsName(name) {
    return HLJS_NAME[name] || name;
  }

  /* ================= 内置高亮引擎 ================= */

  var reCache = {};
  function buildRegex(name) {
    if (reCache[name]) return reCache[name];
    var lang = LANGS[name], types = [], src = [];
    function push(type, s) { types.push(type); src.push(s); }
    if (lang.preproc) push('kw', '^[ \\t]*#[a-z_]+');
    if (lang.bc) for (var b = 0; b < lang.bc.length; b++) {
      push('com', escRe(lang.bc[b][0]) + '[\\s\\S]*?(?:' + escRe(lang.bc[b][1]) + '|$)');
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
    reCache[name] = {re: re, types: types};
    return reCache[name];
  }

  function classifyIdent(word, lang, code, endPos) {
    if (lang.kw[word]) return 'kw';
    if (lang.bi && lang.bi[word]) return 'fn';
    var nxt = code.slice(endPos).match(/^\s*([\s\S])/);
    if (nxt && nxt[1] === '(') return 'fn';
    if (lang.css) return code.slice(endPos).match(/^\s*:/) ? 'type' : 'punc';
    if (/^[A-Z]/.test(word)) return 'type';
    return '';
  }

  function builtinHighlight(code, langName) {
    if (langName === 'html') return highlightMarkup(code);
    var lang = LANGS[langName];
    if (!lang) return esc(code);
    var built = buildRegex(langName), re = built.re, types = built.types;
    re.lastIndex = 0;
    var out = '', last = 0, m;
    while ((m = re.exec(code))) {
      if (m.index > last) out += esc(code.slice(last, m.index));
      var txt = m[0], cls = '';
      for (var g = 1; g < m.length; g++) {
        if (m[g] !== undefined && m[g] !== '') {
          var t = types[g - 1];
          cls = t === 'id' ? classifyIdent(txt.replace(/^[@$]/, ''), lang, code, re.lastIndex) : t;
          break;
        }
      }
      out += cls ? '<span class="tok-' + cls + '">' + esc(txt) + '</span>' : esc(txt);
      last = re.lastIndex;
      if (m[0].length === 0) re.lastIndex++;
    }
    return out + esc(code.slice(last));
  }

  function highlightMarkup(code) {
    var out = '', i = 0, n = code.length;
    while (i < n) {
      if (code.indexOf('<!--', i) === i) {
        var end = code.indexOf('-->', i);
        var seg = end < 0 ? code.slice(i) : code.slice(i, end + 3);
        out += '<span class="tok-com">' + esc(seg) + '</span>';
        i += seg.length;
      } else if (code.charAt(i) === '<') {
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
      .replace(/^(&lt;\/?)([\w:-]+)/, function (_a, a, name) {
        return a + '<span class="tok-fn">' + name + '</span>';
      })
      .replace(/^</, '&lt;').replace(/>$/, '&gt;');
  }

  /* ================= 对外：着色 ================= */

  var hlCache = {}, hlCacheKeys = [];
  function highlight(code, langName) {
    if (!langName) return esc(code);
    var key = langName + '' + code.length + '' + code.slice(0, 64);
    if (hlCache[key] !== undefined) return hlCache[key];
    var out;
    try {
      var hljs = window.hljs;
      var name = hljsName(langName);
      if (hljs && hljs.getLanguage && hljs.getLanguage(name)) {
        out = hljs.highlight(code, {language: name, ignoreIllegals: true}).value;
      } else {
        out = builtinHighlight(code, langName);
      }
    } catch (err) {
      out = builtinHighlight(code, langName);
    }
    hlCache[key] = out;
    hlCacheKeys.push(key);
    if (hlCacheKeys.length > 120) delete hlCache[hlCacheKeys.shift()];
    return out;
  }

  /* ================= 文本特征统计（供代码块判定使用） ================= */

  function stats(code) {
    var lines = code.split('\n');
    var total = 0, cjk = 0, indent = 0, codePunct = 0, sentence = 0, art = 0;
    var nonEmpty = 0, lenSum = 0;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (ln.trim()) { nonEmpty++; lenSum += ln.length; }
      total += ln.length;
      cjk += (ln.match(/[\u4e00-\u9fff\u3040-\u30ff]/g) || []).length;
      if (/^[ \t]+\S/.test(ln)) indent++;
      codePunct += (ln.match(/[{}()[\];=<>&|+\/*]/g) || []).length;
      sentence += (ln.match(/[。，、；：？！,.?!]/g) || []).length;
      if (/^[\s|+=_*\\/-]{6,}$/.test(ln.trim())) art++;
    }
    return {
      lines: lines.length,
      nonEmpty: nonEmpty,
      chars: total,
      avgLen: nonEmpty ? lenSum / nonEmpty : 0,
      cjk: total ? cjk / total : 0,
      indent: lines.length ? indent / lines.length : 0,
      codePunct: nonEmpty ? codePunct / nonEmpty : 0,
      sentence: nonEmpty ? sentence / nonEmpty : 0,
      art: lines.length ? art / lines.length : 0
    };
  }

  // 自然语言段落判定：CJK 占比高 / 句中句读多 / 行长很长，三者满足其一即倾向于散文
  function isProse(code) {
    var s = stats(code);
    if (s.cjk > 0.28) return true;
    if (s.sentence > 1.2 && s.avgLen > 45) return true;
    if (s.avgLen > 130) return true;
    return false;
  }

  /* ================= 语言判别 ================= */

  function classLang(el) {
    var scope = el, depth = 0;
    while (scope && depth < 5) {
      var cn = (scope.getAttribute && scope.getAttribute('class')) || '';
      var mm = cn && cn.match(/(?:language|lang|highlight|syntax|brush)[\s:_-]*([\w+#-]+)/i);
      if (mm) {
        var key = mm[1].toLowerCase();
        if (ALIAS[key]) return ALIAS[key];
        if (LANGS[key] || key === 'html') return key;
      }
      var dl = scope.getAttribute && scope.getAttribute('data-lang');
      if (dl) {
        var dk = dl.toLowerCase();
        if (ALIAS[dk]) return ALIAS[dk];
        if (LANGS[dk] || dk === 'html') return dk;
      }
      scope = scope.parentElement; depth++;
    }
    return null;
  }

  // 特征签名：命中强特征才判定，避免中文正文里出现几个英文单词就被误判
  var SIGNATURES = [
    ['php', [/<\?php/]],
    ['html', [/^\s*<\?xml/i]],
    ['html', [/^\s*<!doctype\s+html/i]],
    ['html', [/^\s*<(html|head|body|div|span|table|ul|ol|p|script|style|project|beans|manifest|LinearLayout|resources|configuration|dependency|plugin)\b/i,
             /<[\w:.-]+(\s+[\w:.-]+\s*=\s*"[^"]*")*\s*\/?>/, /<\/[\w:.-]+\s*>/]],
    ['cpp', [/^\s*#include\s*[<"]/m]],
    ['objectivec_or_cpp', [/^\s*#import\s*[<"]/m]],
    ['go', [/^\s*package\s+[A-Za-z_]\w*/m, /\bfunc\b/]],
    ['java', [/^\s*(package\s+[\w.]+;|import\s+[\w.]+;)/m]],
    ['java', [/\b(public|protected|private)\s+(static\s+)?(final\s+)?(class|void|int|long|String|boolean)\b/]],
    ['csharp', [/^\s*using\s+[\w.]+;/m]],
    ['csharp', [/\bnamespace\s+[\w.]+/]],
    ['rust', [/\bfn\s+\w+\s*\(/, /\b(let\s+mut\b|use\s+[\w:]+;|::)/]],
    ['kotlin', [/\bfun\s+\w+\s*\(/, /\b(val|var)\s+\w+\s*[:=]/]],
    ['swift', [/\b(import\s+(Foundation|UIKit|Swift|SwiftUI)|guard\s+let|@objc|@State|@IBOutlet)/]],
    ['swift', [/\bfunc\s+\w+\s*\(/, /\b(let|var)\s+\w+\s*[:=]/]],
    ['python', [/^\s*(def|class)\s+\w+[^\n]*:\s*$/m]],
    ['python', [/^\s*(import\s+\w+|from\s+[\w.]+\s+import)\b/m, /\b(self|elif|None|True|False)\b/]],
    ['python', [/\bdef\s+\w+\s*\(/, /\b(self|None|True|False|elif)\b/]],
    ['dart', [/^\s*(void\s+main|class\s+\w+\s+extends|Widget\s+build)\b/m]],
    ['dart', [/\b(Widget|StatelessWidget|StatefulWidget)\b/]],
    ['ruby', [/^\s*(def\s+\w+|class\s+\w+\s*<|module\s+\w+|require\s+['"]|puts\s)/m]],
    ['ruby', [/\b(attr_accessor|attr_reader|yield\s+self)\b/]],
    // 注意：不要只用 \bend\b 之类的常见英文词做签名，会把英文正文判成 Lua
    ['lua', [/\blocal\s+\w+\s*=/, /\bfunction\s+\w+\s*\(/]],
    ['perl', [/^\s*(my|our)\s+[$@%]\w+/m]],
    ['perl', [/^\s*use\s+(strict|warnings)/m]],
    ['scala', [/^\s*(object|class|trait)\s+\w+ /m, /\bdef\s+\w+/]],
    ['sql', [/\bselect\s+[\s\S]{0,400}?\bfrom\b/i]],
    ['sql', [/\b(create|alter|drop)\s+table\b/i]],
    ['sql', [/\binsert\s+into\s+\w+/i]],
    ['bash', [/^\s*(#!\/|sudo\s|npm\s|pnpm\s|yarn\s|git\s|docker\s|kubectl\s|curl\s|wget\s|apt-get\s|yum\s|pip\s|make\s|cd\s|ls\s|chmod\s|export\s+\w+=)/m]],
    ['bash', [/^\s*\$\s+\S/m]],
    ['nginx', [/^\s*(server|location|upstream)\s+[^\n{]*\{/m]],
    ['diff', [/^\s*(---|\+\+\+|@@)/m, /^\s*[+-]/m]],
    ['makefile', [/^[\w.-]+\s*:[^\n=]*$/m, /^\t/m]],
    ['dockerfile', [/^\s*(FROM|RUN|COPY|ENTRYPOINT|CMD|WORKDIR|ENV)\s/m]],
    ['markdown', [/^#{1,6}\s+\S/m]],
    ['json', [/^\s*[[{]/, /"\w+"\s*:/]],
    ['yaml', [/^[\w.-]+:\s+[^\n]+$/m, /^[\w.-]+:\s*$/m]],
    ['css', [/^\s*[.#@]?[\w-]+\s*\{[^\n]*$/m, /[a-z-]+\s*:\s*[^;]+;/]],
    // 单独的 [xxx] 也会命中正文里的注释编号，必须再要求 key=value 行
    ['ini', [/^\[[\w.-]+\]\s*$/m, /^\s*[\w.-]+\s*=[^\n]+$/m]]
  ];

  function signatureLang(code) {
    for (var i = 0; i < SIGNATURES.length; i++) {
      var name = SIGNATURES[i][0], res = SIGNATURES[i][1], ok = true;
      for (var j = 0; j < res.length; j++) {
        if (!res[j].test(code)) { ok = false; break; }
      }
      if (ok) return name === 'objectivec_or_cpp' ? 'cpp' : name;
    }
    return null;
  }

  // 关键字启发式：必须命中足够多的「不同」关键字，否则视为散文
  function keywordLang(code) {
    var best = null, bestScore = 0, distinct = 0;
    for (var i = 0; i < HEUR_ORDER.length; i++) {
      var name = HEUR_ORDER[i], kw = LANGS[name].kw, score = 0, hit = 0;
      var ids = code.match(/[A-Za-z_$][\w$]*/g) || [];
      for (var k = 0; k < ids.length && k < 4000; k++) {
        if (kw[ids[k]]) { score += 1; hit++; }
      }
      if (score > bestScore) { bestScore = score; best = name; distinct = hit; }
    }
    if (!best) return null;
    var idCount = (code.match(/[A-Za-z_$][\w$]*/g) || []).length || 1;
    var ratio = distinct / idCount;
    // 至少 4 次命中、占标识符比例 >= 8%，且不能是中文为主的段落
    if (distinct < 4 || ratio < 0.08) return null;
    return best;
  }

  function hljsAutoLang(code) {
    var hljs = window.hljs;
    if (!hljs || !hljs.highlightAuto || code.length > 40000) return null;
    try {
      var res = hljs.highlightAuto(code);
      if (!res || !res.language) return null;
      var rel = res.relevance || 0;
      if (rel < 8) return null;
      var second = res.secondBest ? (res.secondBest.relevance || 0) : 0;
      if (rel - second < 2) return null;
      var name = res.language;
      if (ALIAS[name]) return ALIAS[name];
      if (name === 'xml') return 'html';
      if (Object.prototype.hasOwnProperty.call(LANGS, name)) return name;
      return hasLang(name) ? name : null;
    } catch (err) {
      return null;
    }
  }

  function detectLang(code, el) {
    var byClass = el ? classLang(el) : null;
    if (byClass) return hasLang(byClass) ? byClass : null;
    var bySig = signatureLang(code);
    if (bySig && hasLang(bySig)) return bySig;
    if (isProse(code)) return null;
    var byAuto = hljsAutoLang(code);
    if (byAuto) return byAuto;
    return keywordLang(code);
  }

  /* ================= 导出 ================= */

  window.__mrHL = {
    highlight: highlight,
    detectLang: detectLang,
    stats: stats,
    isProse: isProse,
    langLabel: langLabel,
    hasLang: hasLang,
    esc: esc,
    LANGS: LANGS,
    ALIAS: ALIAS,
    LANG_ORDER: LANG_ORDER,
    LANG_LABEL: LANG_LABEL
  };
})();
