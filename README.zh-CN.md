# 墨阅 MoRead（Go 版）

[English](README.md)

单文件 EPUB 阅读器 · **Go + Wails v2 + Vue3 + TypeScript**

> 专为「打开一本书就读」设计：无书架、无登录，拖进来 / 发送到，立刻读。
> 代码书友友好：`<pre>` 代码块自动语法高亮 + 行号显示（19 种语言）。

---

## 功能

| 功能 | 说明 |
|---|---|
| 单文件打开 | 系统文件对话框选择 EPUB（工具栏 📂 / Ctrl+O） |
| 拖拽打开 | 把 `.epub` 拖到窗口任意位置，松手即开 |
| 右键「发送到」 | 任意 EPUB 右键 → 发送到 → MoRead，直接打开 |
| 代码语法高亮 | 自动识别语言（class 标记 + 关键字启发式），深色代码主题 |
| 行号显示 | 代码块左侧行号列，与代码行严格对齐，横向滚动不错位 |
| 目录导航 | 左侧抽屉列出全部章节（spine 顺序），点击跳转 |
| 章节翻页 | 顶栏 ‹ › 或键盘 ← → |
| 字号调节 | A- / A+，对正文与代码块同时生效 |
| 安全 | 章节渲染前剥离电子书自带脚本与内联事件 |

支持语言：JavaScript / TypeScript / Python / Go / Java / C(C++) / C# / CSS / HTML / XML / JSON / SQL / Bash / Rust / PHP / Kotlin / Swift / Dart / YAML / Lua / Ruby

## 快速开始

1. 双击 `MoRead.exe`（或放到任意目录）
2. 把 EPUB 拖进窗口，或 📂 选择文件
3. （可选）**发送到集成**：`Win+R` 输入 `shell:sendto` 回车，在打开的文件夹里
   放一个指向 `MoRead.exe` 的快捷方式；之后任意 `.epub` 右键 → 发送到 → MoRead

> 依赖 WebView2 运行时（Windows 10/11 一般自带）。缺失时从这里安装：
> https://developer.microsoft.com/microsoft-edge/webview2/

## 从源码构建（Windows）

需要：Go 1.23+、Node 18+、Wails CLI v2（`go install github.com/wailsapp/wails/v2/cmd/wails@latest`）

```powershell
.\build.ps1              # 构建 → build\bin\MoRead.exe
.\build.ps1 -Package     # 构建并打包 zip → build\dist\MoRead-1.0.0.zip
.\build.ps1 -Clean -Package
```

## 项目结构

```
MoRead/
├── main.go                 # Wails 入口：拖拽配置 / AssetServer / 启动参数
├── app.go                  # 前端绑定：OpenPath / OpenFileDialog / GetStartupFile
├── epub/                   # EPUB 解析引擎（container→OPF→spine，纯标准库）
│   ├── parse.go  types.go  parse_test.go
├── assetsrv/               # 资源回放与章节预处理
│   ├── library.go          # 内存书库（LRU≤3）
│   ├── handler.go          # /epub/* 文件服务 + HTML 注入（样式/脚本/去脚本）
│   └── mr-inject.js        # 注入脚本：语法高亮 + 行号 + 字号响应（零依赖）
├── frontend/               # Vue3 + TS + Vite
│   ├── src/App.vue         # 阅读器主界面
│   └── src/components/TocDrawer.vue
├── build/                  # appicon + 构建产物 build\bin\MoRead.exe
└── build.ps1               # Windows 一键构建 / 打包
```

## 工作原理（一句话版）

- **打开**：`os.Args`（发送到）→ `GetStartupFile`；拖拽 → Wails `OnFileDrop`；对话框 → `OpenFileDialog`
- **解析**：Go 解析 ZIP 容器 → `container.xml` → OPF `manifest/spine` → 全部文件载入内存
- **渲染**：iframe 指向 `/epub/{bookID}/{章节路径}`，Go AssetServer 兜底回放 EPUB 内文件（图片/CSS 同样可用）
- **高亮**：Go 在章节 HTML 注入 `mr-inject.js`，脚本扫描 `<pre>` 重建为「行号列 + 代码列」并做 token 级高亮
- **翻章**：`iframe src` 切换，窗口标题同步书名

## 已知边界

- 阅读进度/书签不做持久化（无书架设计）
- 仅支持 `.epub`；DRM 加密 EPUB 不支持
- 请打开可信来源的电子书（已做脚本剥离，但请保持基本安全习惯）
