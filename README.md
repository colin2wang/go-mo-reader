# MoRead (Go Edition)

[简体中文](README.zh-CN.md)

Single-file EPUB reader · **Go + Wails v2 + Vue3 + TypeScript**

> Designed for "open a book and just read": no bookshelf, no login — drag it in / Send to, and start reading immediately.
> Friendly for code e-books: `<pre>` code blocks get automatic syntax highlighting + line numbers (21 languages).

---

## Features

| Feature | Description |
|---|---|
| Single-file open | Pick an EPUB via the system file dialog (toolbar 📂 / Ctrl+O) |
| Drag & drop | Drop a `.epub` anywhere on the window to open it |
| Right-click "Send to" | Right-click any EPUB → Send to → MoRead, opens directly |
| Code syntax highlighting | Auto language detection (class markers + keyword heuristics), dark code theme |
| Line numbers | Line-number column beside code blocks, strictly aligned even when scrolling horizontally |
| TOC navigation | Side drawer lists all chapters (spine order), click to jump |
| Chapter paging | Toolbar ‹ › or keyboard ← → |
| Font size | A- / A+, applies to body text and code blocks at once |
| Security | Scripts and inline event handlers from the e-book are stripped before rendering |

Supported languages: JavaScript / TypeScript / Python / Go / Java / C(C++) / C# / CSS / HTML / XML / JSON / SQL / Bash / Rust / PHP / Kotlin / Swift / Dart / YAML / Lua / Ruby

## Quick Start

1. Double-click `MoRead.exe` (or put it in any directory)
2. Drag an EPUB into the window, or pick a file via 📂
3. (Optional) **Send to integration**: press `Win+R`, type `shell:sendto`, press Enter, and in the opened folder
   create a shortcut pointing to `MoRead.exe`; then right-click any `.epub` → Send to → MoRead

> Requires the WebView2 runtime (usually preinstalled on Windows 10/11). If missing, install it from:
> https://developer.microsoft.com/microsoft-edge/webview2/

## Build from Source (Windows)

Requirements: Go 1.23+, Node 18+, Wails CLI v2 (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`)

```powershell
.\build.ps1              # build → build\bin\MoRead.exe
.\build.ps1 -Package     # build and pack a zip → build\dist\MoRead-1.0.0.zip
.\build.ps1 -Clean -Package
```

## Project Structure

```
MoRead/
├── main.go                 # Wails entry: drag & drop config / AssetServer / startup args
├── app.go                  # Frontend bindings: OpenPath / OpenFileDialog / GetStartupFile
├── epub/                   # EPUB parsing engine (container→OPF→spine, stdlib only)
│   ├── parse.go  types.go  parse_test.go
├── assetsrv/               # Asset serving & chapter preprocessing
│   ├── library.go          # In-memory book library (LRU≤3)
│   ├── handler.go          # /epub/* file serving + HTML injection (styles/scripts/de-scripting)
│   └── mr-inject.js        # Injection script: syntax highlighting + line numbers + font-size response (zero deps)
├── frontend/               # Vue3 + TS + Vite
│   ├── src/App.vue         # Reader main UI
│   └── src/components/TocDrawer.vue
├── build/                  # appicon + build output build\bin\MoRead.exe
└── build.ps1               # Windows one-click build / packaging
```

## How It Works (one-liner version)

- **Open**: `os.Args` (Send to) → `GetStartupFile`; drag & drop → Wails `OnFileDrop`; dialog → `OpenFileDialog`
- **Parse**: Go parses the ZIP container → `container.xml` → OPF `manifest/spine` → all files loaded into memory
- **Render**: an iframe points to `/epub/{bookID}/{chapter path}`; the Go AssetServer serves files from the EPUB (images/CSS work too)
- **Highlight**: Go injects `mr-inject.js` into the chapter HTML; the script scans `<pre>`, rebuilds it as "line-number column + code column", and applies token-level highlighting
- **Chapter paging**: switch the `iframe src`; the window title syncs with the book title

## Known Limitations

- Reading progress / bookmarks are not persisted (by design — no bookshelf)
- Only `.epub` is supported; DRM-encrypted EPUBs are not
- Open e-books from trusted sources only (scripts are stripped, but keep basic safety habits)
