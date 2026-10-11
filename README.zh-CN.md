# 墨阅 MoRead（Go 版）

[English](README.md)

单文件 EPUB 阅读器 · **Go + Wails v2 + Vue3 + TypeScript**

> 专为「打开一本书就读」设计：无书架、无登录，拖进来 / 发送到，立刻读。
> 代码书友友好：代码块自动识别 + 语法高亮 + 行号，正文统一排版，白天/夜间一键切换。

---

## 功能

| 功能 | 说明 |
|---|---|
| 单文件打开 | 系统文件对话框选择 EPUB（工具栏 📂 / Ctrl+O） |
| 拖拽打开 | 把 `.epub` 拖到窗口任意位置，松手即开 |
| 右键「发送到」 | 任意 EPUB 右键 → 发送到 → MoRead，直接打开 |
| 代码块识别 | 多维置信度打分（容器语义 + 等宽字体 + 缩进 + 标点密度 − 中文/长行/ASCII 图），正文不再被误判成代码 |
| 语法高亮 | highlight.js 语言子集 + 零依赖兜底引擎；三级语言判别（类名 → 特征签名 → 相关性评分） |
| 逐块语言切换 | 代码块右上角或右键菜单里指定语言 / 纯文本 / 自动，选择按章节记住 |
| 行号与折叠 | 行号列与代码严格对齐；超长块可折叠，阈值可在设置里调 |
| 统一排版 | 忽略原书样式：统一字体、字号、行高、页宽、标题层级、表格、图片、引用；可在设置里关闭 |
| 白天 / 夜间 | 一个开关同时切换顶栏、目录、正文、表格、图片与代码块配色（Ctrl+D） |
| 右键功能菜单 | 复制 / 全选 / 复制代码块、代码块操作、图片查看与复制、字号、主题、章节导航、设置 |
| 阅读设置 | 字体、字号、行高、页宽、段首缩进、两端对齐、代码字号、行号、折叠阈值、夜间图片降亮 |
| 目录导航 | 左侧抽屉列出全部章节（spine 顺序），点击跳转（Ctrl+B） |
| 章节翻页 | 顶栏 ‹ › 或键盘 ← → |
| 字号调节 | A- / A+ 或 Ctrl+- / Ctrl+= / Ctrl+0，对正文与代码块同时生效 |
| 安全 | 章节渲染前剥离电子书自带脚本与内联事件 |

支持语言：JavaScript / TypeScript / Python / Go / Java / C(C++) / C# / Objective-C / Swift / Kotlin / Dart / Scala / Rust / PHP / Ruby / Lua / Perl / SQL / Bash / CSS / SCSS / HTML / XML / JSON / YAML / INI / Markdown / Diff / Makefile / Dockerfile / Nginx

## 快捷键

| 快捷键 | 作用 |
|---|---|
| Ctrl+O | 打开文件 |
| ← / → | 上一章 / 下一章 |
| Ctrl+B | 打开 / 关闭目录 |
| Ctrl+D | 白天 / 夜间切换 |
| Ctrl+= / Ctrl+- / Ctrl+0 | 放大 / 缩小 / 重置字号 |
| Esc | 关闭菜单、设置、目录、图片查看 |

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
├── app.go                  # 前端绑定：OpenPath / OpenFileDialog / GetStartupFile / SetTheme
├── epub/                   # EPUB 解析引擎（container→OPF→spine，纯标准库）
│   ├── parse.go  types.go  parse_test.go
├── assetsrv/               # 资源回放与章节预处理
│   ├── library.go          # 内存书库（LRU≤3，淘汰最久未使用的书）
│   ├── handler.go          # /epub/* 文件服务 + HTML 注入（统一排版样式 / 脚本 / 去脚本）
│   ├── mr-highlight.js     # 零依赖兜底引擎：语言判别 + 着色（hljs 缺失时接管）
│   ├── mr-inject.js        # 注入脚本：样式剥离 / 代码块识别与装饰 / 右键上报与指令执行
│   └── vendor/highlight.js # highlight.js 语言子集构建产物（pnpm run build:inject 生成）
├── frontend/               # Vue3 + TS + Vite
│   ├── inject/hljs-entry.js      # highlight.js 打包入口（语言白名单）
│   ├── vite.inject.config.ts     # 注入脚本的 lib 模式打包配置
│   └── src/
│       ├── App.vue               # 阅读器主界面：主题 / 设置 / 右键菜单 / 图片查看
│       ├── settings.ts           # 阅读设置模型与持久化
│       ├── bridge.ts             # iframe postMessage 协议
│       ├── menu.ts               # 右键菜单项构建
│       └── components/           # TocDrawer / ContextMenu / SettingsDialog / ImageViewer
├── build/                  # appicon + 构建产物 build\bin\MoRead.exe
└── build.ps1               # Windows 一键构建 / 打包
```

## 工作原理（一句话版）

- **打开**：`os.Args`（发送到）→ `GetStartupFile`；拖拽 → Wails `OnFileDrop`；对话框 → `OpenFileDialog`
- **解析**：Go 解析 ZIP 容器 → `container.xml` → OPF `manifest/spine` → 全部文件载入内存
- **渲染**：iframe 指向 `/epub/{bookID}/{章节路径}`，Go AssetServer 兜底回放 EPUB 内文件（图片/CSS 同样可用）
- **统一排版**：章节加载后先采集特征，再剥离原书 `<link>/<style>/style` 属性，交给注入的 reset 样式（`!important`）统一呈现
- **代码块**：`mr-inject.js` 对候选做置信度打分，过阈值才重建为「行号列 + 代码列 + 工具条」，语言由 `mr-highlight.js` 三级判别后交给 highlight.js 着色
- **交互**：章节右键 → iframe 上报上下文 → 主窗口渲染菜单 → 指令回传 iframe 执行；设置变更同样经 postMessage 下发
- **翻章**：`iframe src` 切换，窗口标题同步书名

## 已知边界

- 阅读进度/书签不做持久化（无书架设计）
- 仅支持 `.epub`；DRM 加密 EPUB 不支持
- 请打开可信来源的电子书（已做脚本剥离，但请保持基本安全习惯）
