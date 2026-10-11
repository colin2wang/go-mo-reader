# MoRead (AGENTS.md)

Windows 桌面 EPUB 阅读器：Go + Wails v2 + Vue 3 + TypeScript。Go 模块名为 `MoRead`（非域名前缀），所有内部 import 以 `MoRead/` 开头。

## 构建与测试

```bash
wails dev                      # 开发模式（热重载，前端 dev server 自动接入）
wails build -platform windows/amd64 -webview2 embed   # 产出 build/bin/MoRead.exe
go test ./...                  # Go 测试
cd frontend && pnpm install --no-frozen-lockfile
cd frontend && pnpm run build  # vue-tsc 类型检查 + 前端打包 + 注入脚本打包
cd frontend && pnpm run build:inject  # 只重建 assetsrv/vendor/highlight.js
.\build.ps1 [-Clean] [-Package]   # Windows 一键构建/打包（校验 go/pnpm/wails/WebView2）
```

依赖：Go 1.23+、pnpm、Wails CLI（`wails` 命令）。前端包管理器是 **pnpm**（workspace），不要用 npm/yarn。

> 新增前端依赖后 `pnpm-lock.yaml` 会过期，因此 `wails.json` / `build.ps1` 使用的是
> `pnpm install --no-frozen-lockfile`。依赖稳定后把 lockfile 提交并改回 `--frozen-lockfile` 即可。

## 架构

- `main.go` — Wails 入口；支持命令行/关联文件打开 EPUB（`startupEpubPath`）。
- `app.go` — 绑定给前端的方法（`OpenPath`、`CloseBook`、`SetTheme` 等），前端经 `frontend/wailsjs` 自动生成的绑定调用。修改绑定方法签名后需重新运行 `wails`（dev/build）以再生成 `wailsjs`。
- `epub/` — 无 UI 依赖的 EPUB 2/3 解析包：container.xml → OPF → manifest/spine，整本载入内存。
- `assetsrv/` — 内存书籍库 + Wails AssetServer 兜底 HTTP 处理器：
  - `/epub/{bookID}/{内部路径}` 回放 EPUB 内文件
  - `/mr-vendor/highlight.js` highlight.js 构建产物（缺失时 404，自动降级）
  - `/mr-highlight.js` 零依赖兜底引擎（语言判别 + 着色）
  - `/mr-inject.js` 章节注入脚本（DOM 处理与交互）
- `frontend/` — Vue 3 + Vite 单页前端（`src/App.vue` + `src/components`）。

### 章节渲染链路（改这里前务必看）

Go 端 `prepareHTML` 按序注入：
`<style id="mr-reader-css">`（`handler.go` 的 `readerCSS`）→ `/mr-vendor/highlight.js`（同步）
→ `/mr-highlight.js`（同步）→ `/mr-inject.js`（defer）。

`mr-inject.js` 的 `run()` 顺序不可颠倒：

1. `collect()` 采集候选 —— **依赖原书 CSS 生效后的 computed style**（等宽字体、`white-space:pre`），
2. 之后才 `applyUnify()` 剥离原书样式（`link`/`style`/`style` 属性/表现属性，可逆），
3. 再 `decorate()` 打分判定并重建代码块。

剥离早于采集会丢掉识别信号；`stripReady` 标志就是用来防止这个顺序被打破的。

### 前端 ↔ iframe 协议

所有跨文档通信都声明在 `frontend/src/bridge.ts`（主窗口侧）与 `assetsrv/mr-inject.js`（章节侧）：

- 下发：`mr-theme` / `mr-settings` / `mr-lang-overrides` / `mr-block-overrides` /
  `mr-scroll-top` / `mr-copy` / `mr-select-all` / `mr-copy-code` / `mr-code-action` / `mr-mark-code`
- 上报：`mr-lang-set` / `mr-block-set` / `mr-context` / `mr-clipboard` / `mr-code-changed`

新增字段要两端同步改，避免各处硬编码字符串。

## 项目特有注意事项

- EPUB 内部资源不是从磁盘读的：章节 HTML/图片/CSS 全部经 `assetsrv` 按内存中的 bookID 回放，路径前缀 `/epub/{bookID}/`，前端引用资源时要带上该前缀。
- `Book` 整本载入内存，应用假定同一时刻约 1 本书；`CloseBook` 负责从库中移除，勿泄漏。`Library` 的 LRU 按 `order` 淘汰最久未使用的书，**不要改成随机淘汰**（会把正在读的书挤掉，导致资源 404）。
- 章节字号用 CSS 变量（`--mr-body-fs` / `--mr-code-fs`）缩放，**不要用 `zoom`**：zoom 会让 iframe 内 `clientX/clientY` 与主窗口像素不一致，右键菜单定位会偏移。
- 代码块判定是打分制（`scoreCode`），`<pre>` 系容器阈值 40，通用容器阈值 62。用户可右键「标记为代码块 / 取消代码块」，纠正结果按 `章节路径@元素序号` 持久化。
- go.mod 中有一行被注释的 wails replace 指令（本地调试用），不要误删。
- 运行期需要 WebView2 运行时（Windows 10/11 通常预装；`-webview2 embed` 仅嵌入加载器）。
- `assetsrv/vendor/highlight.js` 是构建产物，由 `frontend/inject/hljs-entry.js` + `frontend/vite.inject.config.ts` 生成；未生成时应用仍能工作（回退到 `mr-highlight.js`），只是语言覆盖与着色精度下降。

## 维护规则

当项目结构、构建/测试命令、架构边界、开发约定或本文件记录的其他事实发生变化时，必须在同一次改动中同步更新本文件。
