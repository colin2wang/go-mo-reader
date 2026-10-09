package assetsrv

import (
	_ "embed"
	"errors"
	"mime"
	"net/http"
	"path"
	"regexp"
	"strings"
)

//go:embed mr-inject.js
var injectJS []byte

// readerCSS 注入每个章节的基础阅读样式与代码块样式（Go 端静态注入，JS 只负责 DOM 逻辑）
const readerCSS = `
html{scroll-behavior:smooth}
body{margin:0 auto;max-width:780px;padding:28px 26px 72px;font-size:17px;line-height:1.8;
     font-family:Georgia,"Noto Serif CJK SC","Source Han Serif SC","Source Han Sans SC",serif;
     color:#2f3a4a;background:#fbfaf7;word-wrap:break-word}
img,svg,video{max-width:100%!important;height:auto}
a{color:#2563eb}
hr{border:0;border-top:1px solid #e2e2dd;margin:2em 0}
blockquote{margin:1em 0;padding:.2em 1em;border-left:4px solid #d8d8d0;color:#5b6472;background:#f4f3ee}
pre{white-space:pre;overflow-x:auto;margin:1.2em 0}
.mr-code{display:flex;background:#0f1729;border-radius:10px;margin:1.3em 0;
         box-shadow:0 2px 10px rgba(15,23,41,.16);overflow:hidden}
.mr-nums{flex:0 0 auto;padding:14px 6px 14px 16px;text-align:right;user-select:none;
         color:#52607a;font-family:ui-monospace,SFMono-Regular,"JetBrains Mono",Consolas,monospace;
         font-size:13px;line-height:1.62;white-space:pre;border-right:1px solid #1d2942}
.mr-body{flex:1 1 auto;overflow-x:auto}
.mr-body pre{margin:0;padding:14px 18px;background:transparent;
         font-family:ui-monospace,SFMono-Regular,"JetBrains Mono",Consolas,monospace;
         font-size:var(--mr-code-fs,13.5px);line-height:1.62;color:#dbe2ef}
.tok-kw{color:#ff7b80;font-weight:600}
.tok-str{color:#9ecbff}
.tok-com{color:#7b879d;font-style:italic}
.tok-num{color:#7fd0ff}
.tok-fn{color:#d5a9ff}
.tok-type{color:#ffb880}
.tok-punc{color:#8fa0b8}
@media (prefers-color-scheme:dark){
  body{background:#171a21;color:#c9d2e0}
  blockquote{background:#1d222c;border-left-color:#3a4356;color:#9aa4b5}
  hr{border-top-color:#2a2f3a}
}`

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

// prepareHTML 规范化章节 HTML 并注入样式与脚本
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
