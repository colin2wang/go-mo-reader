import {defineConfig} from 'vite'

// 独立构建：把 inject/hljs-entry.js 打成 IIFE 单文件，落盘到 assetsrv/vendor/highlight.js，
// 供 Go 端 //go:embed 后随章节一起注入。与主应用 bundle 完全隔离（主应用不依赖 highlight.js）。
export default defineConfig({
  build: {
    outDir: '../assetsrv/vendor',
    emptyOutDir: false,
    minify: 'esbuild',
    target: 'es2019',
    write: true,
    lib: {
      entry: 'inject/hljs-entry.js',
      formats: ['iife'],
      name: 'hljs',
      fileName: () => 'highlight.js',
    },
  },
})
