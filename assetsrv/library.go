// Package assetsrv 提供书籍内存库与 Wails AssetServer 兜底 HTTP 处理器：
// - /epub/{bookID}/{内部路径} → 回放 EPUB 内文件（图片/CSS/字体/章节 HTML）
// - /mr-inject.js             → 章节注入脚本（高亮 + 行号）
package assetsrv

import (
	"fmt"
	"hash/fnv"
	"sync"

	"MoRead/epub"
)

// Library 全局书籍库（本应用为单文件阅读器，通常同一时刻 1 本）
type Library struct {
	mu    sync.RWMutex
	books map[string]*epub.Book
}

func NewLibrary() *Library {
	return &Library{books: make(map[string]*epub.Book)}
}

// Open 解析磁盘 EPUB 并注册进内存库
func (l *Library) Open(diskPath string) (*epub.Book, error) {
	b, err := epub.Parse(diskPath)
	if err != nil {
		return nil, err
	}
	l.mu.Lock()
	// 简单 LRU：最多同时保留 3 本，超出时淘汰最早的一本
	if len(l.books) >= 3 {
		for k := range l.books {
			delete(l.books, k)
			break
		}
	}
	l.books[b.ID] = b
	l.mu.Unlock()
	return b, nil
}

// Get 按 ID 取书
func (l *Library) Get(id string) (*epub.Book, bool) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	b, ok := l.books[id]
	return b, ok
}

// Close 移除书籍释放内存
func (l *Library) Close(id string) {
	l.mu.Lock()
	delete(l.books, id)
	l.mu.Unlock()
}

// BookColor 由书名派生的主题色，用于前端占位/装饰
func BookColor(title string) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(title))
	palette := []int{0x3B82F6, 0x8B5CF6, 0xEC4899, 0xF59E0B, 0x10B981, 0x06B6D4, 0xEF4444, 0x6366F1}
	return fmt.Sprintf("#%06X", palette[h.Sum32()%uint32(len(palette))])
}
