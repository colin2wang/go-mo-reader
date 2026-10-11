# assetsrv/vendor

存放第三方前端构建产物，由 Go 侧 `//go:embed vendor` 整体嵌入章节页。

## highlight.js（生成产物，勿手工编辑）

- 源文件：`frontend/inject/hljs-entry.js`（只注册常用语言子集）
- 构建配置：`frontend/vite.inject.config.ts`
- 生成命令（在 `frontend/` 目录下执行）：

```bash
pnpm run build:inject          # 等价于 vite build --config vite.inject.config.ts
```

- 产物路径：`assetsrv/vendor/highlight.js`（IIFE，挂载 `window.hljs`）
- 服务地址：`/mr-vendor/highlight.js`，由 `assetsrv/handler.go` 在章节 HTML 里注入

`pnpm run build` 与 `pnpm run dev` 都会自动执行该构建，因此正常走 `wails build` / `wails dev`
无需手动干预。产物未生成时也不会编译失败：章节脚本会回退到 `mr-highlight.js` 内置引擎，
只是语言覆盖与着色精度下降。
