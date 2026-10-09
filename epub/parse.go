package epub

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"html"
	"io"
	"net/url"
	"os"
	"path"
	"regexp"
	"strings"

	"github.com/google/uuid"
)

const maxFileSize = 128 << 20 // 单个内部文件上限 128MB，防 ZIP 炸弹

var (
	errNotZip   = errors.New("不是有效的 EPUB 文件（ZIP 容器解析失败）")
	errNoOPF    = errors.New("EPUB 结构异常：未找到 OPF 包描述文件")
	errEmptyOPF = errors.New("EPUB 结构异常：OPF 解析失败")
)

// ---------- ZIP 内路径规范化 ----------

// normalizePath 统一处理反斜杠、URL 转义、相对路径，得到可直接查表的键。
func normalizePath(p string) string {
	if p == "" {
		return ""
	}
	p = strings.ReplaceAll(p, "\\", "/")
	if dec, err := url.PathUnescape(p); err == nil {
		p = dec
	}
	p = path.Clean("/" + p)
	return strings.TrimPrefix(p, "/")
}

// resolveHref 以 OPF 所在目录为基准解析 manifest href，去除 #fragment
func resolveHref(baseDir, href string) string {
	if i := strings.IndexByte(href, '#'); i >= 0 {
		href = href[:i]
	}
	return normalizePath(path.Join("/"+baseDir, href))
}

// ---------- container.xml / OPF 解析 ----------

type containerRootfile struct {
	FullPath string `xml:"full-path,attr"`
}

type container struct {
	Rootfiles []containerRootfile `xml:"rootfiles>rootfile"`
}

type opfItem struct {
	ID         string `xml:"id,attr"`
	Href       string `xml:"href,attr"`
	MediaType  string `xml:"media-type,attr"`
	Properties string `xml:"properties,attr"`
}

type opfPackage struct {
	Metadata struct {
		Titles   []string `xml:"title"`
		Creators []string `xml:"creator"`
		Metas    []struct {
			Name    string `xml:"name,attr"`
			Content string `xml:"content,attr"`
		} `xml:"meta"`
	} `xml:"metadata"`
	Manifest struct {
		Items []opfItem `xml:"item"`
	} `xml:"manifest"`
	Spine struct {
		ItemRefs []struct {
			IDRef string `xml:"idref,attr"`
		} `xml:"itemref"`
	} `xml:"spine"`
}

func isDocMediaType(mt string) bool {
	mt = strings.ToLower(strings.TrimSpace(mt))
	return mt == "application/xhtml+xml" || mt == "text/html"
}

// ---------- 章节标题提取 ----------

var (
	reHeading = regexp.MustCompile(`(?is)<h[1-3][^>]*>(.*?)</h[1-3]>`)
	reTitle   = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	reTag     = regexp.MustCompile(`<[^>]*>`)
)

func firstText(s string) string {
	s = reTag.ReplaceAllString(s, " ")
	s = html.UnescapeString(s)
	s = strings.Join(strings.Fields(s), " ")
	r := []rune(s)
	if len(r) > 80 {
		s = string(r[:80]) + "…"
	}
	return strings.TrimSpace(s)
}

// extractTitle 依次尝试 h1-h3、<title>，均失败返回 fallback
func extractTitle(data []byte, fallback string) string {
	head := data
	if len(head) > 64<<10 {
		head = head[:64<<10]
	}
	s := string(head)
	for _, re := range []*regexp.Regexp{reHeading, reTitle} {
		if m := re.FindStringSubmatch(s); len(m) > 1 {
			if t := firstText(m[1]); t != "" {
				return t
			}
		}
	}
	return fallback
}

// ---------- 主入口 ----------

// Parse 打开磁盘上的 EPUB 文件，载入内存并解析结构。
func Parse(diskPath string) (*Book, error) {
	zr, err := zip.OpenReader(diskPath)
	if err != nil {
		return nil, errNotZip
	}
	defer zr.Close()

	files := make(map[string][]byte, len(zr.File))
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		data, err := io.ReadAll(io.LimitReader(rc, maxFileSize+1))
		_ = rc.Close()
		if err != nil || len(data) > maxFileSize {
			continue
		}
		files[normalizePath(f.Name)] = data
	}

	// 1) container.xml → OPF 路径；缺失时回退为全局搜索 *.opf
	opfPath := ""
	if cf, ok := files["META-INF/container.xml"]; ok {
		var c container
		if err := xml.Unmarshal(cf, &c); err == nil {
			for _, rf := range c.Rootfiles {
				if rf.FullPath != "" {
					opfPath = normalizePath(rf.FullPath)
					break
				}
			}
		}
	}
	if opfPath == "" {
		for name := range files {
			if strings.EqualFold(path.Ext(name), ".opf") {
				opfPath = name
				break
			}
		}
	}
	if opfPath == "" {
		return nil, errNoOPF
	}
	opfData, ok := files[opfPath]
	if !ok {
		return nil, errNoOPF
	}

	// 2) OPF 解析
	var pkg opfPackage
	if err := xml.Unmarshal(opfData, &pkg); err != nil {
		return nil, errEmptyOPF
	}
	baseDir := path.Dir("/" + opfPath)
	baseDir = strings.TrimPrefix(baseDir, "/")

	// 3) manifest 索引 + 封面
	manifest := make(map[string]opfItem, len(pkg.Manifest.Items))
	cover := ""
	for _, it := range pkg.Manifest.Items {
		manifest[it.ID] = it
	}
	for _, it := range pkg.Manifest.Items {
		if cover != "" {
			break
		}
		for _, prop := range strings.Fields(it.Properties) {
			if strings.EqualFold(prop, "cover-image") && strings.HasPrefix(it.MediaType, "image/") {
				cover = resolveHref(baseDir, it.Href)
				break
			}
		}
	}
	if cover == "" { // EPUB2: <meta name="cover" content="{id}"/>
		for _, m := range pkg.Metadata.Metas {
			if strings.EqualFold(m.Name, "cover") {
				if it, ok := manifest[m.Content]; ok && strings.HasPrefix(it.MediaType, "image/") {
					cover = resolveHref(baseDir, it.Href)
				}
				break
			}
		}
	}

	// 4) spine → 章节列表
	chapters := make([]Chapter, 0, len(pkg.Spine.ItemRefs))
	for _, ref := range pkg.Spine.ItemRefs {
		it, ok := manifest[ref.IDRef]
		if !ok || !isDocMediaType(it.MediaType) {
			continue
		}
		p := resolveHref(baseDir, it.Href)
		if _, ok := files[p]; !ok {
			continue
		}
		idx := len(chapters)
		chapters = append(chapters, Chapter{
			Index: idx,
			Title: extractTitle(files[p], fmt.Sprintf("章节 %d", idx+1)),
			Path:  p,
		})
	}
	if len(chapters) == 0 {
		return nil, errors.New("EPUB 中未找到可渲染的章节（spine 为空）")
	}

	// 5) 书名/作者兜底
	title := firstText(strings.Join(pkg.Metadata.Titles, " "))
	if title == "" {
		title = strings.TrimSuffix(path.Base(diskPath), path.Ext(diskPath))
	}
	author := firstText(strings.Join(pkg.Metadata.Creators, " / "))

	return &Book{
		ID:       strings.ReplaceAll(uuid.NewString(), "-", "")[:12],
		Path:     diskPath,
		FileName: path.Base(diskPath),
		Title:    title,
		Author:   author,
		Cover:    cover,
		Chapters: chapters,
		files:    files,
	}, nil
}

// Sniff 检查磁盘文件是否大概率是 EPUB（扩展名或 ZIP 魔数）
func Sniff(diskPath string) bool {
	if !strings.EqualFold(path.Ext(diskPath), ".epub") {
		return false
	}
	f, err := os.Open(diskPath)
	if err != nil {
		return false
	}
	defer f.Close()
	magic := make([]byte, 2)
	if _, err := io.ReadFull(f, magic); err != nil {
		return false
	}
	return bytes.Equal(magic, []byte("PK"))
}
