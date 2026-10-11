package assetsrv

import (
	"embed"
	"errors"
	"mime"
	"net/http"
	"path"
	"regexp"
	"strings"
)

//go:embed mr-inject.js
var injectJS []byte

//go:embed mr-highlight.js
var highlightJS []byte

//go:embed vendor
var vendorFS embed.FS

// readerCSS 注入每个章节的基础阅读样式与代码块样式（Go 端静态注入，JS 只负责 DOM 逻辑）。
//
// 结构：① 变量层（白天默认 / html[data-mr-theme="dark"] 覆盖）
//
//	② 统一排版 reset 层（全部 !important，压过原书 CSS 与内联 style）
//	③ 语义排版层（标题/段落/列表/引用/表格/图片…）
//	④ 代码块层（行号、工具条、hljs token 配色）
//
// 说明：reset 用元素选择器，.mr-* 与 .hljs-* 用类选择器，
// 因此后两者即便写在后面也能稳定压过 reset（类 > 元素，与 !important 相同优先级时按特异性）。
const readerCSS = `
html{scroll-behavior:smooth;
  --mr-bg:#fbfaf7;--mr-ink:#2f3a4a;--mr-ink-dim:#5b6472;--mr-head:#232c3a;
  --mr-line:#e3e1da;--mr-soft:#f4f3ee;--mr-zebra:#faf9f5;--mr-accent:#2563eb;
  --mr-mark:#fdf1c7;
  --mr-code-bg:#f7f6f1;--mr-code-border:#e6e4db;--mr-code-ink:#2c3a4d;
  --mr-nums:#a8a396;--mr-nums-bg:#f1efe8;
  --mr-bar-bg:rgba(255,255,255,.92);--mr-bar-border:#dedcd2;--mr-bar-ink:#7a8698;
  --mr-pop-bg:#ffffff;--mr-pop-border:#e2e0d8;--mr-pop-ink:#2c3a4d;--mr-pop-hover:#eaf1fe;
  --mr-shadow:0 1px 2px rgba(30,40,60,.06),0 6px 18px rgba(30,40,60,.05);
  --mr-tok-kw:#d73a49;--mr-tok-str:#032f62;--mr-tok-com:#6a737d;--mr-tok-num:#005cc5;
  --mr-tok-fn:#6f42c1;--mr-tok-type:#e36209;--mr-tok-attr:#8a5cc7;--mr-tok-meta:#8a6d3b;
  --mr-tok-tag:#22863a;--mr-tok-punc:#5b6472;--mr-tok-add:#22863a;--mr-tok-del:#b31d28;
  --mr-body-fs:17px;--mr-code-fs:13.5px;--mr-lh:1.8;--mr-width:780px;
  --mr-font:Georgia,"Noto Serif CJK SC","Source Han Serif SC","Songti SC",serif;
  --mr-mono:ui-monospace,SFMono-Regular,"JetBrains Mono",Consolas,"Courier New",monospace}
html[data-mr-font="sans"]{--mr-font:-apple-system,"Segoe UI","Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif}
html[data-mr-theme="dark"]{
  --mr-bg:#171a21;--mr-ink:#c9d2e0;--mr-ink-dim:#8a94a6;--mr-head:#e6ecf5;
  --mr-line:#2a303c;--mr-soft:#1d222c;--mr-zebra:#1b202a;--mr-accent:#7fd0ff;
  --mr-mark:#4a3c12;
  --mr-code-bg:#0f1729;--mr-code-border:#1d2942;--mr-code-ink:#dbe2ef;
  --mr-nums:#52607a;--mr-nums-bg:rgba(255,255,255,.02);
  --mr-bar-bg:rgba(255,255,255,.08);--mr-bar-border:#2a3550;--mr-bar-ink:#8fa0b8;
  --mr-pop-bg:#182031;--mr-pop-border:#26314a;--mr-pop-ink:#dbe2ef;--mr-pop-hover:#22314d;
  --mr-shadow:0 2px 10px rgba(0,0,0,.28);
  --mr-tok-kw:#ff7b80;--mr-tok-str:#9ecbff;--mr-tok-com:#7b879d;--mr-tok-num:#7fd0ff;
  --mr-tok-fn:#d5a9ff;--mr-tok-type:#ffb880;--mr-tok-attr:#c3a6ff;--mr-tok-meta:#d3b17a;
  --mr-tok-tag:#7ee08a;--mr-tok-punc:#8fa0b8;--mr-tok-add:#7ee08a;--mr-tok-del:#ff9a9a}

/* ---------- ① 统一排版 reset：压掉原书的字体/字号/颜色/背景/浮动/间距 ---------- */
html,body,div,p,span,a,em,strong,b,i,u,s,small,del,ins,mark,sub,sup,code,pre,
h1,h2,h3,h4,h5,h6,ul,ol,li,dl,dt,dd,table,thead,tbody,tfoot,tr,th,td,caption,
figure,figcaption,blockquote,q,cite,hr,img,svg,video,audio,iframe,object,embed,
article,section,nav,header,footer,main,aside,details,summary,fieldset,legend,label,
font,center,big,tt,kbd,samp,var,abbr,acronym,address,programlisting,literallayout,screen{
  font-family:var(--mr-font)!important;font-size:var(--mr-body-fs)!important;
  line-height:var(--mr-lh)!important;font-weight:400!important;font-style:normal!important;
  font-variant:normal!important;letter-spacing:normal!important;word-spacing:normal!important;
  text-transform:none!important;text-shadow:none!important;text-decoration:none!important;
  color:var(--mr-ink)!important;background:transparent!important;
  border:0!important;border-color:var(--mr-line)!important;
  margin:0!important;padding:0!important;
  text-align:left!important;text-indent:0!important;white-space:normal!important;
  vertical-align:baseline!important;float:none!important;clear:none!important;
  position:static!important;left:auto!important;top:auto!important;right:auto!important;bottom:auto!important;
  width:auto!important;height:auto!important;min-width:0!important;max-width:none!important;
  min-height:0!important;max-height:none!important;
  list-style-position:outside!important;
  -webkit-text-size-adjust:100%!important}
html,body{background:var(--mr-bg)!important;color:var(--mr-ink)!important;text-align:left!important}
body{margin:0 auto!important;max-width:var(--mr-width)!important;padding:30px 28px 96px!important;
     word-wrap:break-word;overflow-wrap:break-word}

/* ---------- ② 语义排版 ---------- */
p{margin:0 0 .85em!important}
p:last-child{margin-bottom:0!important}
html[data-mr-indent="1"] p{text-indent:2em!important}
html[data-mr-justify="1"] p{text-align:justify!important;text-justify:inter-ideograph!important}
h1,h2,h3,h4,h5,h6{color:var(--mr-head)!important;font-weight:700!important;
  margin:1.5em 0 .7em!important;text-indent:0!important;text-align:left!important;line-height:1.4!important}
h1{font-size:1.55em!important;margin-top:.2em!important}
h2{font-size:1.35em!important}
h3{font-size:1.2em!important}
h4{font-size:1.08em!important}
h5{font-size:1em!important;color:var(--mr-ink-dim)!important}
h6{font-size:.95em!important;color:var(--mr-ink-dim)!important;font-weight:600!important}
strong,b{font-weight:700!important;color:var(--mr-head)!important}
em,i,cite{font-style:italic!important}
u,ins{text-decoration:underline!important}
del,s{text-decoration:line-through!important}
mark{background:var(--mr-mark)!important;color:var(--mr-ink)!important;padding:.1em .2em!important;border-radius:3px!important}
small{font-size:.85em!important}
sub{vertical-align:sub!important;font-size:.78em!important}
sup{vertical-align:super!important;font-size:.78em!important}
abbr,acronym{border-bottom:1px dotted var(--mr-ink-dim)!important;cursor:help}
a{color:var(--mr-accent)!important;text-decoration:underline!important;text-underline-offset:2px}
a:hover{text-decoration:none!important}
ul,ol{margin:0 0 .9em!important;padding-left:1.6em!important}
ul{list-style:disc!important}
ol{list-style:decimal!important}
ul ul{list-style:circle!important}
li{margin:.25em 0!important;display:list-item!important}
li>ul,li>ol{margin:.25em 0!important}
dl{margin:0 0 .9em!important}
dt{font-weight:700!important;margin:.5em 0 .2em!important}
dd{margin:0 0 .4em 1.6em!important}
blockquote,q{margin:1em 0!important;padding:.3em 0 .3em 1em!important;
  border-left:4px solid var(--mr-line)!important;border-width:0 0 0 4px!important;
  background:var(--mr-soft)!important;color:var(--mr-ink-dim)!important}
hr{border:0!important;border-top:1px solid var(--mr-line)!important;border-width:1px 0 0 0!important;
   height:0!important;margin:1.8em 0!important}
figure{margin:1.2em 0!important;text-align:center!important}
figcaption,caption{margin:.5em 0!important;font-size:.85em!important;color:var(--mr-ink-dim)!important;
  text-align:center!important;font-style:normal!important}
code,kbd,samp,tt{font-family:var(--mr-mono)!important;font-size:.88em!important;
  background:var(--mr-soft)!important;color:var(--mr-ink)!important;
  padding:.12em .38em!important;border-radius:4px!important;white-space:normal!important}
kbd{border:1px solid var(--mr-line)!important;border-width:1px!important}
/* 图片统一：居中、限宽、去浮动、圆角 */
img,svg,video,object,embed{display:block!important;float:none!important;clear:both!important;
  max-width:100%!important;width:auto!important;height:auto!important;
  margin:1.2em auto!important;border-radius:8px!important;background:transparent!important}
html[data-mr-theme="dark"][data-mr-dimimg="1"] img,
html[data-mr-theme="dark"][data-mr-dimimg="1"] svg{filter:brightness(.82) contrast(1.03)!important}
/* 表格：补齐边框/内边距，宽表交给 .mr-table-wrap 横向滚动 */
table{border-collapse:collapse!important;width:auto!important;min-width:100%!important;
  margin:0!important;font-size:.9em!important;line-height:1.55!important;text-indent:0!important}
.mr-table-wrap{overflow-x:auto!important;margin:1.2em 0!important;-webkit-overflow-scrolling:touch}
th,td{border:1px solid var(--mr-line)!important;border-width:1px!important;padding:7px 11px!important;
  text-align:left!important;vertical-align:top!important;background:transparent!important}
th{background:var(--mr-soft)!important;font-weight:600!important;color:var(--mr-head)!important}
tbody tr:nth-child(even) td{background:var(--mr-zebra)!important}
/* 加 html 前缀提升特异性，压过 html[data-mr-indent="1"] p 的段首缩进 */
html td p,html th p,html td li,html th li{margin:.15em 0!important;text-indent:0!important}
th blockquote,td blockquote{margin:.2em 0!important;padding:.1em .6em!important;background:none!important}
th pre,td pre{margin:.2em 0!important}
/* 预格式化文本：原书里的 <pre> 不再被改造成代码块时，至少保证等宽可滚动 */
pre{white-space:pre!important;overflow-x:auto!important;margin:1.1em 0!important;
    font-family:var(--mr-mono)!important;font-size:var(--mr-code-fs)!important;line-height:1.62!important;
    background:var(--mr-code-bg)!important;border:1px solid var(--mr-code-border)!important;
    border-width:1px!important;border-radius:10px!important;padding:13px 16px!important;
    text-indent:0!important;text-align:left!important}

/* ---------- ③ 代码块 ---------- */
.mr-code{display:flex!important;position:relative!important;background:var(--mr-code-bg)!important;
  border:1px solid var(--mr-code-border)!important;border-width:1px!important;border-radius:10px!important;
  margin:1.3em 0!important;box-shadow:var(--mr-shadow)!important;overflow:hidden!important;
  text-indent:0!important;text-align:left!important;font-variant-ligatures:none!important;
  white-space:normal!important;padding:0!important;width:auto!important;max-width:none!important}
.mr-nums{flex:0 0 auto!important;display:block!important;padding:14px 8px 14px 16px!important;
  text-align:right!important;user-select:none;-webkit-user-select:none;
  color:var(--mr-nums)!important;background:var(--mr-nums-bg)!important;
  border-right:1px solid var(--mr-code-border)!important;border-width:0 1px 0 0!important;
  font-family:var(--mr-mono)!important;font-size:var(--mr-code-fs)!important;
  line-height:1.62!important;white-space:pre!important}
.mr-code[data-nums="0"] .mr-nums{display:none!important}
.mr-body{flex:1 1 auto!important;overflow-x:auto!important;min-width:0!important}
.mr-body pre{margin:0!important;padding:14px 18px!important;background:transparent!important;
  border:0!important;border-width:0!important;border-radius:0!important;box-shadow:none!important;
  font-family:var(--mr-mono)!important;font-size:var(--mr-code-fs)!important;
  line-height:1.62!important;color:var(--mr-code-ink)!important}
.mr-body code{display:block!important;background:transparent!important;padding:0!important;
  font-size:inherit!important;font-family:var(--mr-mono)!important;white-space:pre!important}
/* 折叠 */
.mr-code[data-collapsed="1"] .mr-body{max-height:15.5em!important;overflow:hidden!important}
.mr-code[data-collapsed="1"]{padding-bottom:34px!important}
.mr-fold{position:absolute!important;left:0!important;right:0!important;bottom:0!important;
  display:none;align-items:center;justify-content:center;height:34px;
  font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;font-size:12px;
  color:var(--mr-accent);cursor:pointer;opacity:0;transition:opacity .16s ease;
  background:transparent;border:0!important}
.mr-code[data-foldable="1"] .mr-fold{display:flex}
.mr-code:hover .mr-fold{opacity:1}
.mr-code[data-collapsed="1"] .mr-fold{opacity:1;background:linear-gradient(to bottom,rgba(0,0,0,0),var(--mr-code-bg) 45%)!important}
/* 右上角工具条 */
.mr-bar{position:absolute!important;top:7px!important;right:8px!important;z-index:2;
  display:flex;align-items:center;gap:5px;opacity:0;transform:translateY(-2px);
  transition:opacity .16s ease,transform .16s ease}
.mr-code:hover .mr-bar,.mr-bar:focus-within{opacity:1;transform:none}
.mr-bar-btn,.mr-lang-btn{display:inline-flex!important;align-items:center;gap:4px;
  padding:4px 8px!important;border-radius:7px!important;
  border:1px solid var(--mr-bar-border)!important;border-width:1px!important;
  background:var(--mr-bar-bg)!important;color:var(--mr-bar-ink)!important;
  font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif!important;
  font-size:11.5px!important;line-height:1.4!important;cursor:pointer;
  transition:color .15s,border-color .15s,background .15s}
.mr-bar-btn:hover,.mr-lang-btn:hover{color:var(--mr-accent)!important;background:var(--mr-pop-bg)!important}
.mr-lang-name{font-weight:600}
.mr-lang-caret{font-size:9px;opacity:.7}
.mr-lang-pop{position:absolute!important;top:28px!important;right:0!important;z-index:3;
  display:none;min-width:136px;max-height:260px;overflow-y:auto;padding:5px!important;
  border-radius:9px!important;background:var(--mr-pop-bg)!important;
  border:1px solid var(--mr-pop-border)!important;border-width:1px!important;
  box-shadow:var(--mr-shadow)!important}
.mr-lang-pop.open{display:block;animation:mr-pop .14s ease-out}
.mr-lang-pop.up{top:auto!important;bottom:28px!important}
@keyframes mr-pop{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.mr-lang-item{display:block!important;width:100%!important;text-align:left!important;
  padding:6px 9px!important;border:0!important;border-radius:6px!important;
  background:transparent!important;color:var(--mr-pop-ink)!important;
  font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif!important;
  font-size:12px!important;cursor:pointer}
.mr-lang-item:hover{background:var(--mr-pop-hover)!important;color:var(--mr-accent)!important}
.mr-lang-item.active{background:var(--mr-accent)!important;color:var(--mr-bg)!important;font-weight:600}
/* 语法着色：highlight.js 类名 + 内置兜底引擎的 tok-* 类名 */
.hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-doctag,.tok-kw{color:var(--mr-tok-kw)!important;font-weight:600!important}
.hljs-string,.hljs-regexp,.hljs-addition,.hljs-char.escape_,.tok-str{color:var(--mr-tok-str)!important}
.hljs-comment,.hljs-quote,.tok-com{color:var(--mr-tok-com)!important;font-style:italic!important}
.hljs-number,.hljs-symbol,.hljs-bullet,.hljs-link,.hljs-selector-attr,.hljs-selector-pseudo,.tok-num{color:var(--mr-tok-num)!important}
.hljs-title,.hljs-title.function_,.hljs-section,.tok-fn{color:var(--mr-tok-fn)!important}
.hljs-type,.hljs-built_in,.hljs-class .hljs-title,.hljs-title.class_,.tok-type{color:var(--mr-tok-type)!important}
.hljs-attr,.hljs-attribute,.hljs-variable,.hljs-template-variable,.hljs-selector-class,.hljs-selector-id,.hljs-property{color:var(--mr-tok-attr)!important}
.hljs-meta,.hljs-meta .hljs-keyword{color:var(--mr-tok-meta)!important}
.hljs-tag,.hljs-name,.hljs-tag .hljs-name{color:var(--mr-tok-tag)!important}
.hljs-punctuation,.hljs-operator,.tok-punc{color:var(--mr-tok-punc)!important}
.hljs-deletion{color:var(--mr-tok-del)!important}
.hljs-emphasis{font-style:italic!important}
.hljs-strong{font-weight:700!important}

::-webkit-scrollbar{width:9px;height:9px}
::-webkit-scrollbar-thumb{background:rgba(140,150,170,.35);border-radius:8px}
::-webkit-scrollbar-thumb:hover{background:rgba(140,150,170,.55)}
::-webkit-scrollbar-track{background:transparent}
`

var (
	reScriptTag   = regexp.MustCompile(`(?is)<script\b[^>]*>[\s\S]*?</script>`)
	reScriptOpen  = regexp.MustCompile(`(?is)<script\b[^>]*/?>`)
	reInlineEvent = regexp.MustCompile(`(?is)\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)`)
	reJSUrl       = regexp.MustCompile(`(?i)\s(href|src|action|formaction)\s*=\s*["']?\s*javascript:[^\s"'>]*["']?`)
)

// sanitizeScript 移除 EPUB 自带的脚本与内联事件，章节内只保留阅读器注入脚本，
// 避免外部电子书脚本触及同源的 Wails 运行时绑定。
func sanitizeScript(s string) string {
	s = reScriptTag.ReplaceAllString(s, "")
	s = reScriptOpen.ReplaceAllString(s, "")
	s = reInlineEvent.ReplaceAllString(s, "")
	s = reJSUrl.ReplaceAllString(s, ` ${1}="#"`)
	return s
}

// prepareHTML 规范化章节 HTML 并注入样式与脚本。
// 注入顺序：阅读器样式 → highlight.js（同步执行）→ 兜底引擎 → 章节脚本（defer，DOM 解析后执行）。
func prepareHTML(data []byte) []byte {
	s := sanitizeScript(string(data))
	// 去 XML 声明（避免 text/html 进入怪癖模式）
	if i := strings.Index(s, "<?xml"); i >= 0 {
		if j := strings.Index(s[i:], "?>"); j >= 0 {
			s = s[:i] + s[i+j+2:]
		} else {
			s = s[:i]
		}
	}
	s = strings.TrimSpace(s)
	inject := `<style id="mr-reader-css">` + readerCSS + "</style>\n" +
		`<script src="/mr-vendor/highlight.js"></script>` + "\n" +
		`<script src="/mr-highlight.js"></script>` + "\n" +
		`<script src="/mr-inject.js" defer></script>` + "\n"
	low := strings.ToLower(s)
	switch {
	case strings.Contains(low, "<head"):
		idx := strings.Index(low, "<head")
		gt := strings.Index(s[idx:], ">")
		if gt >= 0 {
			pos := idx + gt + 1
			s = s[:pos] + "\n" + inject + s[pos:]
			break
		}
		fallthrough
	case strings.Contains(low, "<html"):
		idx := strings.Index(low, "<html")
		gt := strings.Index(s[idx:], ">")
		if gt >= 0 {
			pos := idx + gt + 1
			s = s[:pos] + "\n<head>" + inject + "</head>" + s[pos:]
		}
	default: // 纯片段：包壳
		s = "<!DOCTYPE html><html><head><meta charset=\"utf-8\">" + inject +
			"</head><body>" + s + "</body></html>"
		return []byte(s)
	}
	if !strings.Contains(low, "<!doctype") {
		s = "<!DOCTYPE html>\n" + s
	}
	return []byte(s)
}

func contentType(p string, data []byte) string {
	switch strings.ToLower(path.Ext(p)) {
	case ".xhtml", ".html", ".htm":
		return "text/html; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".js":
		return "text/javascript; charset=utf-8"
	case ".svg":
		return "image/svg+xml"
	case ".xml", ".opf", ".ncx":
		return "application/xml; charset=utf-8"
	case ".woff":
		return "font/woff"
	case ".woff2":
		return "font/woff2"
	case ".ttf":
		return "font/ttf"
	case ".otf":
		return "font/otf"
	}
	if ct := mime.TypeByExtension(strings.ToLower(path.Ext(p))); ct != "" {
		return ct
	}
	if len(data) >= 4 {
		if data[0] == 0xFF && data[1] == 0xD8 {
			return "image/jpeg"
		}
		if data[0] == 0x89 && data[1] == 'P' {
			return "image/png"
		}
		if data[0] == 'G' && data[1] == 'I' {
			return "image/gif"
		}
	}
	return "application/octet-stream"
}

// ServeBookFile 将书内文件写入 HTTP 响应；章节 HTML 做注入处理
func ServeBookFile(w http.ResponseWriter, r *http.Request, data []byte, p string) {
	ct := contentType(p, data)
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "no-store")
	if strings.HasPrefix(ct, "text/html") {
		data = prepareHTML(data)
	}
	w.Header().Set("Content-Length", itoa(len(data)))
	_, _ = w.Write(data)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

// Handler 返回 AssetServer 兜底处理器（embed 静态资源未命中时进入）
func (l *Library) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := path.Clean(r.URL.Path)
		switch {
		case p == "/mr-inject.js":
			w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			_, _ = w.Write(injectJS)
		case p == "/mr-highlight.js":
			w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			_, _ = w.Write(highlightJS)
		case p == "/mr-vendor/highlight.js":
			// 构建产物（frontend/inject/hljs-entry.js 经 pnpm run build:inject 生成）。
			// 未生成时返回 404，章节脚本自动回退到 mr-highlight.js 内置引擎。
			data, err := vendorFS.ReadFile("vendor/highlight.js")
			if err != nil {
				http.Error(w, "highlight.js not built", http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("Content-Length", itoa(len(data)))
			_, _ = w.Write(data)
		case strings.HasPrefix(p, "/epub/"):
			rest := strings.TrimPrefix(p, "/epub/")
			slash := strings.IndexByte(rest, '/')
			if slash <= 0 || slash == len(rest)-1 {
				http.Error(w, "bad epub path", http.StatusBadRequest)
				return
			}
			bookID, inner := rest[:slash], rest[slash+1:]
			b, ok := l.Get(bookID)
			if !ok {
				http.Error(w, "book not loaded", http.StatusNotFound)
				return
			}
			data, ok := b.File(inner)
			if !ok {
				http.Error(w, errors.New("file not found in epub").Error(), http.StatusNotFound)
				return
			}
			ServeBookFile(w, r, data, inner)
		default:
			http.NotFound(w, r)
		}
	})
}
