package main

import (
	"embed"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"MoRead/assetsrv"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

var (
	errEmptyPath = errors.New("未指定文件路径")
	errNotEpub   = errors.New("仅支持 .epub 文件")
)

// startupEpubPath 从命令行参数中取第一个 .epub 文件（支持右键"发送到"与双击关联打开）
func startupEpubPath() string {
	for _, arg := range os.Args[1:] {
		p := strings.TrimSpace(strings.Trim(arg, `"`))
		if p == "" || strings.HasPrefix(p, "-") {
			continue
		}
		if strings.EqualFold(filepath.Ext(p), ".epub") {
			return p
		}
	}
	return ""
}

func main() {
	lib := assetsrv.NewLibrary()
	app := NewApp(startupEpubPath(), lib)

	err := wails.Run(&options.App{
		Title:     "墨阅 MoRead",
		Width:     1180,
		Height:    800,
		MinWidth:  720,
		MinHeight: 520,
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: lib.Handler(), // /epub/* 与 /mr-inject.js 兜底
		},
		BackgroundColour: &options.RGBA{R: 246, G: 245, B: 241, A: 1},
		OnStartup:        app.startup,
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: false,
			CSSDropProperty:    "--wails-drop-target",
			CSSDropValue:       "drop",
		},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			Theme:                windows.Light,
		},
		Bind: []interface{}{app},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}
