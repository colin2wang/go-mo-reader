# MoRead (Go Edition)

[简体中文](README.zh-CN.md)

Single-file EPUB reader · **Go + Wails v2 + Vue3 + TypeScript**

> Designed for "open a book and just read": no bookshelf, no login — drag it in / Send to, and start reading immediately.
> Friendly for code e-books: confident code-block detection, syntax highlighting, line numbers, unified typography, and light/dark themes.

---

## Features

| Feature | Description |
|---|---|
| Single-file open | Pick an EPUB via the system file dialog (toolbar 📂 / Ctrl+O) |
| Drag & drop | Drop a `.epub` anywhere on the window to open it |
| Right-click "Send to" | Right-click any EPUB → Send to → MoRead, opens directly |
| Code block detection | Multi-signal confidence scoring (tag semantics + monospace font + indentation + punctuation density − prose/long-line/ASCII-art penalties) so body text is no longer mistaken for code |
| Syntax highlighting | highlight.js language subset with a zero-dependency fallback engine; three-stage language detection (class → signature → relevance) |
| Per-block language | Pick a language / plain text / auto from the block toolbar or context menu; remembered per chapter |
| Line numbers & folding | Aligned line-number column; long blocks can be folded (threshold configurable) |
| Unified typography | Ignore the book's own styling: consistent font, size, line height, page width, headings, tables, images, quotes — can be turned off in settings |
| Light / dark theme | One switch re-skins the toolbar, TOC, body text, tables, images and code blocks (Ctrl+D) |
| Context menu | Copy / select all / copy code block, code-block actions, view & copy image, font size, theme, chapter navigation, settings |
| Reader settings | Font, size, line height, page width, first-line indent, justification, code size, line numbers, fold threshold, dim images in dark mode |
| TOC navigation | Side drawer lists all chapters (spine order), click to jump (Ctrl+B) |
| Chapter paging | Toolbar ‹ › or keyboard ← → |
| Font size | A- / A+ or Ctrl+- / Ctrl+= / Ctrl+0, applies to body text and code blocks at once |
| Security | Scripts and inline event handlers from the e-book are stripped before rendering |

Supported languages: JavaScript / TypeScript / Python / Go / Java / C(C++) / C# / Objective-C / Swift / Kotlin / Dart / Scala / Rust / PHP / Ruby / Lua / Perl / SQL / Bash / CSS / SCSS / HTML / XML / JSON / YAML / INI / Markdown / Diff / Makefile / Dockerfile / Nginx

## Shortcuts

| Shortcut | Action |
|---|---|
| Ctrl+O | Open file |
| ← / → | Previous / next chapter |
| Ctrl+B | Toggle TOC |
| Ctrl+D | Toggle light / dark |
| Ctrl+= / Ctrl+- / Ctrl+0 | Increase / decrease / reset font size |
| Esc | Close menu, settings, TOC, image viewer |

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
├── app.go                  # Frontend bindings: OpenPath / OpenFileDialog / GetStartupFile / SetTheme
├── epub/                   # EPUB parsing engine (container→OPF→spine, stdlib only)
│   ├── parse.go  types.go  parse_test.go
├── assetsrv/               # Asset serving & chapter preprocessing
│   ├── library.go          # In-memory book library (LRU≤3, evicts least recently used)
│   ├── handler.go          # /epub/* file serving + HTML injection (unified stylesheet / scripts / de-scripting)
│   ├── mr-highlight.js     # Zero-dependency fallback engine: language detection + highlighting
│   ├── mr-inject.js        # Injection script: style stripping / code-block detection & decoration / context reporting & commands
│   └── vendor/highlight.js # highlight.js subset build artifact (via pnpm run build:inject)
├── frontend/               # Vue3 + TS + Vite
│   ├── inject/hljs-entry.js      # highlight.js bundle entry (language allow-list)
│   ├── vite.inject.config.ts     # lib-mode build config for the injection script
│   └── src/
│       ├── App.vue               # Reader main UI: theme / settings / context menu / image viewer
│       ├── settings.ts           # Reader settings model & persistence
│       ├── bridge.ts             # iframe postMessage protocol
│       ├── menu.ts               # Context menu item builder
│       └── components/           # TocDrawer / ContextMenu / SettingsDialog / ImageViewer
├── build/                  # appicon + build output build\bin\MoRead.exe
└── build.ps1               # Windows one-click build / packaging
```

## How It Works (one-liner version)

- **Open**: `os.Args` (Send to) → `GetStartupFile`; drag & drop → Wails `OnFileDrop`; dialog → `OpenFileDialog`
- **Parse**: Go parses the ZIP container → `container.xml` → OPF `manifest/spine` → all files loaded into memory
- **Render**: an iframe points to `/epub/{bookID}/{chapter path}`; the Go AssetServer serves files from the EPUB (images/CSS work too)
- **Typography**: features are collected first, then the book's own `<link>/<style>/style` attributes are stripped and an `!important` reset stylesheet takes over
- **Code blocks**: `mr-inject.js` scores each candidate; only blocks above the threshold are rebuilt as "line-number column + code column + toolbar", with the language resolved by `mr-highlight.js` and rendered by highlight.js
- **Interaction**: right-click in a chapter → the iframe reports context → the main window renders the menu → commands go back to the iframe; settings changes travel the same channel
- **Chapter paging**: switch the `iframe src`; the window title syncs with the book title

## Known Limitations

- Reading progress / bookmarks are not persisted (by design — no bookshelf)
- Only `.epub` is supported; DRM-encrypted EPUBs are not
- Open e-books from trusted sources only (scripts are stripped, but keep basic safety habits)
