// Package epub 提供对 EPUB 2/3 电子书的最小解析能力：
// 解析 container.xml → OPF → manifest/spine，提取书名、作者、封面与章节顺序，
// 并将全部内部文件载入内存，供 AssetServer 按路径回放。
package epub

// Chapter 章节信息（spine 顺序）
type Chapter struct {
	Index int    `json:"index"`
	Title string `json:"title"`
	Path  string `json:"path"` // 相对 ZIP 根的规范化路径
}

// Book 一本已载入内存的 EPUB
type Book struct {
	ID       string    `json:"id"`
	Path     string    `json:"path"`     // 磁盘上的 EPUB 文件路径
	FileName string    `json:"fileName"` // 文件名（含扩展名）
	Title    string    `json:"title"`
	Author   string    `json:"author"`
	Cover    string    `json:"cover,omitempty"` // 封面在 ZIP 内的路径
	Chapters []Chapter `json:"chapters"`

	files map[string][]byte // ZIP 内所有文件（规范化路径 -> 内容），不序列化
}

// File 按规范化路径取 ZIP 内文件内容
func (b *Book) File(p string) ([]byte, bool) {
	if b.files == nil {
		return nil, false
	}
	data, ok := b.files[normalizePath(p)]
	return data, ok
}

// ChapterPath 返回 spine 中第 index 章的路径，越界返回 false
func (b *Book) ChapterPath(index int) (string, bool) {
	if index < 0 || index >= len(b.Chapters) {
		return "", false
	}
	return b.Chapters[index].Path, true
}
