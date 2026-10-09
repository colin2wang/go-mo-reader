package epub

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

const containerXML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`

const opfTmpl = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:test</dc:identifier>
    <dc:title>测试之书</dc:title>
    <dc:creator>张三</dc:creator>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/with%20space.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover-img" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="style" href="css/main.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`

const ch1 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>ignored</title></head>
<body><h1>第一章&nbsp;起源</h1>
<pre><code class="language-python">def hello():
    print("hi")  # comment</code></pre>
<p>正文内容</p></body></html>`

const ch2 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>第二章标题</title></head>
<body><p>无 h1 的章节</p></body></html>`

func buildTestEpub(t *testing.T, extra func(zw *zip.Writer)) string {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, "sample.epub")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	add := func(name, content string) {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	add("mimetype", "application/epub+zip")
	add("META-INF/container.xml", containerXML)
	add("OEBPS/content.opf", opfTmpl)
	add("OEBPS/nav.xhtml", "<html><body><nav epub:type=\"toc\"></nav></body></html>")
	add("OEBPS/text/ch1.xhtml", ch1)
	add("OEBPS/text/with space.xhtml", ch2)
	add("OEBPS/images/cover.jpg", "\xff\xd8\xff\xe0fakejpeg")
	if extra != nil {
		extra(zw)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestParseBasic(t *testing.T) {
	p := buildTestEpub(t, nil)
	b, err := Parse(p)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if b.Title != "测试之书" {
		t.Errorf("Title = %q", b.Title)
	}
	if b.Author != "张三" {
		t.Errorf("Author = %q", b.Author)
	}
	if len(b.Chapters) != 2 {
		t.Fatalf("chapters = %d, want 2", len(b.Chapters))
	}
	if b.Chapters[0].Title != "第一章 起源" {
		t.Errorf("ch0 title = %q", b.Chapters[0].Title)
	}
	if b.Chapters[0].Path != "OEBPS/text/ch1.xhtml" {
		t.Errorf("ch0 path = %q", b.Chapters[0].Path)
	}
	// ch2 无 h1，回退 <title>
	if b.Chapters[1].Title != "第二章标题" {
		t.Errorf("ch1 title = %q", b.Chapters[1].Title)
	}
	// 封面（properties=cover-image 优先于 EPUB2 meta）
	if b.Cover != "OEBPS/images/cover.jpg" {
		t.Errorf("cover = %q", b.Cover)
	}
	// 文件读取 + 规范化路径命中
	if _, ok := b.File("OEBPS/text/with space.xhtml"); !ok {
		t.Error("File(with space) miss")
	}
	if _, ok := b.File("OEBPS/images/../images/cover.jpg"); !ok {
		t.Error("File(../ clean) miss")
	}
	if _, ok := b.File("OEBPS/images/not-exist.png"); ok {
		t.Error("File(unknown) should miss")
	}
	if cp, ok := b.ChapterPath(1); !ok || cp != "OEBPS/text/with space.xhtml" {
		t.Errorf("ChapterPath(1) = %q,%v", cp, ok)
	}
	if _, ok := b.ChapterPath(2); ok {
		t.Error("ChapterPath(2) out of range should fail")
	}
}

func TestParseFallbackNoContainer(t *testing.T) {
	// 无 container.xml：回退为全局搜索 *.opf
	dir := t.TempDir()
	p := filepath.Join(dir, "nocontainer.epub")
	f, _ := os.Create(p)
	zw := zip.NewWriter(f)
	add := func(name, content string) {
		w, _ := zw.Create(name)
		w.Write([]byte(content))
	}
	add("book.opf", opfTmpl)
	add("text/ch1.xhtml", ch1)
	add("text/with space.xhtml", ch2)
	add("images/cover.jpg", "fake")
	zw.Close()
	f.Close()

	b, err := Parse(p)
	if err != nil {
		t.Fatalf("Parse fallback: %v", err)
	}
	if len(b.Chapters) != 2 {
		t.Fatalf("chapters = %d, want 2", len(b.Chapters))
	}
}

func TestParseBroken(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "broken.epub")
	os.WriteFile(p, []byte("this is not a zip"), 0o644)
	if _, err := Parse(p); err == nil {
		t.Fatal("expected error for non-zip file")
	}
}

func TestSniff(t *testing.T) {
	p := buildTestEpub(t, nil)
	if !Sniff(p) {
		t.Error("Sniff should accept .epub with PK magic")
	}
	txt := filepath.Join(t.TempDir(), "a.epub")
	os.WriteFile(txt, []byte("plain"), 0o644)
	if Sniff(txt) {
		t.Error("Sniff should reject non-zip")
	}
	if Sniff(filepath.Join(t.TempDir(), "a.txt")) {
		t.Error("Sniff should reject .txt extension")
	}
}

func TestNormalizePath(t *testing.T) {
	cases := map[string]string{
		"OEBPS/a.xhtml":              "OEBPS/a.xhtml",
		"OEBPS\\win.xhtml":           "OEBPS/win.xhtml",
		"OEBPS/my%20file.xhtml":      "OEBPS/my file.xhtml",
		"OEBPS/text/../css/main.css": "OEBPS/css/main.css",
		"./x.html":                   "x.html",
		"/abs/path.html":             "abs/path.html",
		"":                           "",
	}
	for in, want := range cases {
		if got := normalizePath(in); got != want {
			t.Errorf("normalizePath(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestResolveHref(t *testing.T) {
	if got := resolveHref("OEBPS", "text/ch1.xhtml#sec2"); got != "OEBPS/text/ch1.xhtml" {
		t.Errorf("got %q", got)
	}
	if got := resolveHref("OEBPS", "../cover.jpg"); got != "cover.jpg" {
		t.Errorf("got %q", got)
	}
	if got := resolveHref("", "a%20b.xhtml"); got != "a b.xhtml" {
		t.Errorf("got %q", got)
	}
}

func TestExtractTitleTruncate(t *testing.T) {
	long := bytes.Repeat([]byte("很长的标题文字"), 40)
	data := []byte("<html><body><h1>" + string(long) + "</h1></body></html>")
	got := extractTitle(data, "fallback")
	if len([]rune(got)) > 82 {
		t.Errorf("title not truncated: %d runes", len([]rune(got)))
	}
	if extractTitle([]byte("<p>no title</p>"), "fallback") != "fallback" {
		t.Error("fallback expected")
	}
}
