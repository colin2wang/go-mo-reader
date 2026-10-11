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

// maxBooks 同时保留的书籍上限
const maxBooks = 3

// Library 全局书籍库（本应用为单文件阅读器，通常同一时刻 1 本）
type Library struct {
	mu    sync.RWMutex
	books map[string]*epub.Book
	order []string // 打开顺序，末尾为最近使用
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
	// 简单 LRU：超出上限时淘汰最久未打开的一本。
	// 注意必须按 order 淘汰而不是随机挑一个，否则可能把当前正在阅读的书挤掉，
	// 导致章节里的图片/CSS 全部 404。
	if _, exists := l.books[b.ID]; !exists && len(l.books) >= maxBooks {
		for len(l.books) >= maxBooks && len(l.order) > 0 {
			victim := l.order[0]
			l.order = l.order[1:]
			if victim == b.ID {
				continue
			}
			if _, ok := l.books[victim]; ok {
				delete(l.books, victim)
				break
			}
		}
	}
	l.touchLocked(b.ID)
	l.books[b.ID] = b
	l.mu.Unlock()
	return b, nil
}

// touchLocked 把 id 移到使用顺序末尾（调用方需持有写锁）
func (l *Library) touchLocked(id string) {
	for i := 0; i < len(l.order); i++ {
		if l.order[i] == id {
			l.order = append(l.order[:i], l.order[i+1:]...)
			break
		}
	}
	l.order = append(l.order, id)
}

// Get 按 ID 取书，并把它记为最近使用（避免被后续打开的书挤掉）
func (l *Library) Get(id string) (*epub.Book, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	b, ok := l.books[id]
	if ok {
		l.touchLocked(id)
	}
	return b, ok
}

// Close 移除书籍释放内存
func (l *Library) Close(id string) {
	l.mu.Lock()
	delete(l.books, id)
	for i := 0; i < len(l.order); i++ {
		if l.order[i] == id {
			l.order = append(l.order[:i], l.order[i+1:]...)
			break
		}
	}
	l.mu.Unlock()
}

// BookColor 由书名派生的主题色，用于前端占位/装饰
func BookColor(title string) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(title))
	palette := []int{0x3B82F6, 0x8B5CF6, 0xEC4899, 0xF59E0B, 0x10B981, 0x06B6D4, 0xEF4444, 0x6366F1}
	return fmt.Sprintf("#%06X", palette[h.Sum32()%uint32(len(palette))])
}
