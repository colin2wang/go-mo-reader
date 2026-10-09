# MoRead (AGENTS.md)

Windows 桌面 EPUB 阅读器：Go + Wails v2 + Vue 3 + TypeScript。Go 模块名为 `MoRead`（非域名前缀），所有内部 import 以 `MoRead/` 开头。

## 构建与测试

```bash
wails dev                      # 开发模式（热重载，前端 dev server 自动接入）
wails build -platform windows/amd64 -webview2 embed   # 产出 build/bin/MoRead.exe
go test ./...                  # Go 测试
cd frontend && pnpm install --frozen-lockfile
cd frontend && pnpm run build  # 含 vue-tsc --noEmit 类型检查，可作前端检查手段
.\build.ps1 [-Clean] [-Package]   # Windows 一键构建/打包（校验 go/pnpm/wails/WebView2）
```

依赖：Go 1.23+、pnpm、Wails CLI（`wails` 命令）。前端包管理器是 **pnpm**（workspace），不要用 npm/yarn。

## 架构

- `main.go` — Wails 入口；支持命令行/关联文件打开 EPUB（`startupEpubPath`）。
- `app.go` — 绑定给前端的方法（`OpenPath`、`CloseBook` 等），前端经 `frontend/wailsjs` 自动生成的绑定调用。修改绑定方法签名后需重新运行 `wails`（dev/build）以再生成 `wailsjs`。
- `epub/` — 无 UI 依赖的 EPUB 2/3 解析包：container.xml → OPF → manifest/spine，整本载入内存。
- `assetsrv/` — 内存书籍库 + Wails AssetServer 兜底 HTTP 处理器：`/epub/{bookID}/{内部路径}` 回放 EPUB 内文件，`/mr-inject.js` 为章节注入脚本（高亮 + 行号，改它无需改 Go）。
- `frontend/` — Vue 3 + Vite 单页前端（`src/App.vue` + `src/components`）。

## 项目特有注意事项

- EPUB 内部资源不是从磁盘读的：章节 HTML/图片/CSS 全部经 `assetsrv` 按内存中的 bookID 回放，路径前缀 `/epub/{bookID}/`，前端引用资源时要带上该前缀。
- `Book` 整本载入内存，应用假定同一时刻约 1 本书；`CloseBook` 负责从库中移除，勿泄漏。
- go.mod 中有一行被注释的 wails replace 指令（本地调试用），不要误删。
- 运行期需要 WebView2 运行时（Windows 10/11 通常预装；`-webview2 embed` 仅嵌入加载器）。

## 维护规则

当项目结构、构建/测试命令、架构边界、开发约定或本文件记录的其他事实发生变化时，必须在同一次改动中同步更新本文件。
