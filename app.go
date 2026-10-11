package main

import (
	"context"
	"path/filepath"
	"strings"

	"MoRead/assetsrv"
	"MoRead/epub"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App 前端绑定的应用层
type App struct {
	ctx         context.Context
	lib         *assetsrv.Library
	startupPath string // 通过命令行参数（右键"发送到"）传入的 EPUB 路径
}

// NewApp 创建应用实例；startupPath 为可选的启动文件
func NewApp(startupPath string, lib *assetsrv.Library) *App {
	return &App{lib: lib, startupPath: startupPath}
}

// startup 保存 Wails 运行时上下文
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// OpenFileDialog 弹出系统文件对话框选择 EPUB，返回所选路径（取消返回 ""）
func (a *App) OpenFileDialog() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择 EPUB 电子书",
		Filters: []runtime.FileFilter{
			{DisplayName: "EPUB 电子书 (*.epub)", Pattern: "*.epub"},
		},
	})
}

// OpenPath 打开磁盘上的 EPUB 文件（对话框 / 拖拽 / 发送到 共用入口）。
// 成功返回书籍信息，前端通过 /epub/{id}/{path} 资源路由渲染章节。
func (a *App) OpenPath(diskPath string) (*epub.Book, error) {
	diskPath = strings.TrimSpace(diskPath)
	diskPath = strings.Trim(diskPath, `"`) // 发送到场景下可能带引号
	if diskPath == "" {
		return nil, errEmptyPath
	}
	if !epub.Sniff(diskPath) {
		return nil, errNotEpub
	}
	abs, err := filepath.Abs(diskPath)
	if err != nil {
		abs = diskPath
	}
	b, err := a.lib.Open(abs)
	if err != nil {
		return nil, err
	}
	runtime.WindowSetTitle(a.ctx, b.Title+" · 墨阅")
	return b, nil
}

// GetStartupFile 返回启动参数中的 EPUB 路径（无则空串）。前端挂载后主动拉取，
// 避免 startup 阶段事件早于前端加载而丢失。
func (a *App) GetStartupFile() string {
	return a.startupPath
}

// SetTheme 同步原生窗口（标题栏）主题，让夜间模式下窗口边框也跟着变暗。
// 非 Windows 平台由 Wails 内部降级为空操作。
func (a *App) SetTheme(dark bool) {
	if a.ctx == nil {
		return
	}
	if dark {
		runtime.WindowSetDarkTheme(a.ctx)
	} else {
		runtime.WindowSetLightTheme(a.ctx)
	}
}

// CloseBook 关闭并释放书籍内存
func (a *App) CloseBook(id string) {
	a.lib.Close(id)
	runtime.WindowSetTitle(a.ctx, "墨阅 MoRead")
}
