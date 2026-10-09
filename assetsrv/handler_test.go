package assetsrv

import (
	"archive/zip"
	"bytes"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const tContainer = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

const tOPF = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>测试书</dc:title></metadata>
<manifest>
<item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine><itemref idref="c1"/></spine>
</package>`

const tCh1 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title>
<script>alert('evil')</script></head>
<body onload="evil()"><h1>第一章</h1><pre><code class="language-go">fmt.Println("hi")</code></pre></body></html>`

func makeTestEpub(t *testing.T) string {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	files := map[string]string{
		"mimetype":               "application/epub+zip",
		"META-INF/container.xml": tContainer,
		"OEBPS/content.opf":      tOPF,
		"OEBPS/ch1.xhtml":        tCh1,
		"OEBPS/img/pic.png":      "\x89PNG fake",
	}
	for name, content := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(t.TempDir(), "test.epub")
	if err := os.WriteFile(p, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func get(t *testing.T, h *Library, url string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest("GET", url, nil)
	rec := httptest.NewRecorder()
	h.Handler().ServeHTTP(rec, req)
	return rec
}

func TestHandlerEndToEnd(t *testing.T) {
	lib := NewLibrary()
	b, err := lib.Open(makeTestEpub(t))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	base := "/epub/" + b.ID

	// 章节页：HTML 注入 + 脚本剥离
	r := get(t, lib, base+"/OEBPS/ch1.xhtml")
	if r.Code != 200 {
		t.Fatalf("chapter status = %d", r.Code)
	}
	if ct := r.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("content-type = %q", ct)
	}
	body := r.Body.String()
	if !strings.Contains(body, `<script src="/mr-inject.js" defer></script>`) {
		t.Error("inject script missing")
	}
	if !strings.Contains(body, "mr-reader-css") {
		t.Error("reader css missing")
	}
	if strings.Contains(body, "<script>alert") || strings.Contains(body, "onload=") {
		t.Error("book scripts/events not stripped")
	}
	if !strings.Contains(body, "fmt.Println") {
		t.Error("chapter content lost")
	}

	// 图片
	r = get(t, lib, base+"/OEBPS/img/pic.png")
	if r.Code != 200 || !strings.HasPrefix(r.Header().Get("Content-Type"), "image/png") {
		t.Errorf("image: code=%d ct=%q", r.Code, r.Header().Get("Content-Type"))
	}

	// 注入脚本
	r = get(t, lib, "/mr-inject.js")
	if r.Code != 200 || !strings.Contains(r.Body.String(), "mr-code") {
		t.Error("inject.js not served")
	}

	// 未注册书籍 / 不存在文件 / 路径穿越
	if r = get(t, lib, "/epub/deadbeef/OEBPS/ch1.xhtml"); r.Code != 404 {
		t.Errorf("unknown book: %d", r.Code)
	}
	if r = get(t, lib, base+"/OEBPS/nope.xhtml"); r.Code != 404 {
		t.Errorf("missing file: %d", r.Code)
	}
	if r = get(t, lib, base+"/../../secret.txt"); r.Code == 200 {
		t.Error("path traversal allowed")
	}

	// 普通前端路由兜底 404（由 embed 静态资源先接管）
	if r = get(t, lib, "/definitely-missing.css"); r.Code != 404 {
		t.Errorf("fallback: %d", r.Code)
	}

	// 关闭后不可访问
	lib.Close(b.ID)
	if r = get(t, lib, base+"/OEBPS/ch1.xhtml"); r.Code != 404 {
		t.Error("book still served after close")
	}
}

func TestPrepareHTMLOutput(t *testing.T) {
	// 无 head/html 的片段
	out := string(prepareHTML([]byte("<p>fragment</p>")))
	if !strings.Contains(out, "<!DOCTYPE html>") || !strings.Contains(out, "mr-inject.js") {
		t.Errorf("fragment wrap broken: %s", out)
	}
	// XML 声明剥离
	out = string(prepareHTML([]byte(`<?xml version="1.0"?><html><head></head><body>ok</body></html>`)))
	if strings.Contains(out, "<?xml") {
		t.Error("xml decl kept")
	}
}
