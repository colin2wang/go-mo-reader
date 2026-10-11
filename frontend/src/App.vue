<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import TocDrawer from './components/TocDrawer.vue'
import ContextMenu from './components/ContextMenu.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import ImageViewer from './components/ImageViewer.vue'
import {
  CloseBook,
  GetStartupFile,
  OpenFileDialog,
  OpenPath,
} from '../wailsjs/go/main/App'
import {OnFileDrop} from '../wailsjs/runtime/runtime'
import {epub} from '../wailsjs/go/models'
import {
  BLOCK_KEY,
  LANG_KEY,
  DEFAULT_SETTINGS,
  loadSettings,
  loadStringMap,
  saveSettings,
  saveStringMap,
  type BlockOverride,
  type LangOverride,
  type ReaderSettings,
  type Theme,
} from './settings'
import {parseFromIframe, postToIframe, type CodeContext, type ImageContext} from './bridge'
import {buildMenu, type MenuContext, type MenuItem} from './menu'

/* ---------------- 状态 ---------------- */
const book = ref<epub.Book | null>(null)
const current = ref(0)
const showToc = ref(false)
const dragging = ref(false)
const toast = ref('')
const iframeEl = ref<HTMLIFrameElement | null>(null)
const settings = ref<ReaderSettings>(loadSettings())
const showSettings = ref(false)

// 逐块选择：语言覆盖、代码块纠正（取消 / 强制标记）
const langOverrides = ref<Record<string, LangOverride>>(loadStringMap(LANG_KEY))
const blockOverrides = ref<Record<string, BlockOverride>>(
  loadStringMap(BLOCK_KEY) as Record<string, BlockOverride>,
)

// 右键菜单
const menuPos = ref<{x: number; y: number} | null>(null)
const menuItems = ref<MenuItem[]>([])
const menuCtx = ref<MenuContext | null>(null)

// 图片查看
const viewer = ref<ImageContext | null>(null)

const chapterURL = computed(() => {
  const b = book.value
  if (!b) return ''
  const ch = b.chapters[current.value]
  return ch ? `/epub/${b.id}/${encodeURI(ch.path)}` : ''
})

const canPrev = computed(() => !!book.value && current.value > 0)
const canNext = computed(() => !!book.value && current.value < book.value.chapters.length - 1)

let toastTimer = 0
function showToast(msg: string) {
  toast.value = msg
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = ''), 2600)
}

/* ---------------- 设置与主题 ---------------- */

function applyThemeToWindow(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
  // 同步原生窗口标题栏（wails 重新生成绑定后才存在，未生成时静默跳过）
  try {
    const app = (window as any)?.go?.main?.App
    if (app && typeof app.SetTheme === 'function') app.SetTheme(theme === 'dark')
  } catch {
    /* 忽略 */
  }
}

watch(
  () => settings.value.theme,
  (t) => {
    applyThemeToWindow(t)
    postToIframe(iframeEl.value?.contentWindow, {type: 'mr-theme', theme: t})
  },
  {immediate: true},
)

function pushSettings() {
  saveSettings(settings.value)
  postToIframe(iframeEl.value?.contentWindow, {type: 'mr-settings', settings: settings.value})
}

// 设置变更即时下发到章节（字号/行高/页宽/缩进等）
watch(settings, pushSettings, {deep: true})

function toggleTheme() {
  settings.value = {...settings.value, theme: settings.value.theme === 'dark' ? 'light' : 'dark'}
}

function setFontSize(px: number) {
  settings.value = {
    ...settings.value,
    fontSize: Math.min(24, Math.max(14, Math.round(px))),
  }
}

/* ---------------- 打开流程 ---------------- */
async function openFile(path: string) {
  if (!path) return
  try {
    const b = await OpenPath(path)
    if (book.value) await CloseBook(book.value.id)
    book.value = b
    current.value = 0
  } catch (e: any) {
    showToast('打开失败：' + String(e?.message ?? e))
  }
}

async function selectFile() {
  const p = await OpenFileDialog()
  await openFile(p)
}

/* ---------------- Wails 文件拖拽 ---------------- */
// 直接走 WebView2 底层接口上报拖放文件：
// wailsjs 暴露的 ResolveFilePaths(files) 与内部实现 ResolveFilePaths(x, y, files) 参数不一致，
// 直接用会传错参数（wails v2 已知问题）。
function postDropFiles(files: File[]) {
  const wv = (window as any).chrome?.webview
  if (wv?.postMessageWithAdditionalObjects) {
    wv.postMessageWithAdditionalObjects('file:drop:0:0', files)
  }
}

// 章节 iframe 是独立文档，拖放事件不会冒泡到主窗口，必须在 iframe 内接管再转发
function bindIframeDrop() {
  const doc = iframeEl.value?.contentDocument
  if (!doc || (doc as any).__mrDropBound) return
  ;(doc as any).__mrDropBound = true

  doc.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer?.types?.includes('Files')) dragging.value = true
  })
  doc.addEventListener('dragleave', () => (dragging.value = false))
  doc.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault()
    dragging.value = false
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length) postDropFiles(files)
  })
}

function onWailsDrop(_x: number, _y: number, paths: string[]) {
  dragging.value = false
  const epubPath = (paths || []).find((p) => p.toLowerCase().endsWith('.epub'))
  if (epubPath) {
    openFile(epubPath)
  } else if (paths && paths.length > 0) {
    showToast('请拖入 .epub 文件')
  }
}

// DOM 事件仅用于显示遮罩；实际文件路径由 Wails OnFileDrop 提供
function onDragOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer?.types?.includes('Files')) dragging.value = true
}
function onDragLeave(e: DragEvent) {
  e.preventDefault()
  if (e.relatedTarget === null) dragging.value = false
}
function onDOMDrop(e: DragEvent) {
  e.preventDefault()
  dragging.value = false
}

/* ---------------- 章节导航 ---------------- */
function jumpTo(i: number) {
  const b = book.value
  if (!b || i < 0 || i >= b.chapters.length) return
  current.value = i
  showToc.value = false
  scrollTop()
}
const prev = () => jumpTo(current.value - 1)
const next = () => jumpTo(current.value + 1)

function scrollTop() {
  postToIframe(iframeEl.value?.contentWindow, {type: 'mr-scroll-top'})
}

/* ---------------- iframe 生命周期 ---------------- */
function onIframeLoad() {
  bindIframeDrop()
  const win = iframeEl.value?.contentWindow
  postToIframe(win, {type: 'mr-theme', theme: settings.value.theme})
  postToIframe(win, {type: 'mr-settings', settings: settings.value})
  postToIframe(win, {type: 'mr-lang-overrides', map: langOverrides.value})
  postToIframe(win, {type: 'mr-block-overrides', map: blockOverrides.value})
  scrollTop()
}

/* ---------------- 复制 ---------------- */
function fallbackCopy(text: string) {
  if (!text) return
  const done = () => showToast('已复制')
  try {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, () => showToast('复制失败'))
      return
    }
  } catch {
    /* 落到 execCommand */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    showToast(ok ? '已复制' : '复制失败')
  } catch {
    showToast('复制失败')
  }
}

async function copyImage(src: string) {
  try {
    const res = await fetch(src)
    const blob = await res.blob()
    // ClipboardItem 在部分 WebView2 / TS lib 版本里不可用，按需取用并做能力检测
    const CI = (window as any).ClipboardItem
    const clip = navigator.clipboard as any
    if (typeof CI === 'undefined' || !clip?.write) throw new Error('unsupported')
    await clip.write([new CI({[blob.type || 'image/png']: blob})])
    showToast('图片已复制')
  } catch {
    showToast('当前环境不支持复制图片，可改用「查看原图」')
  }
}

/* ---------------- 右键菜单 ---------------- */
function openMenu(msg: {x: number; y: number; selection: string; code: CodeContext | null; image: ImageContext | null; inCode: boolean}) {
  const rect = iframeEl.value?.getBoundingClientRect()
  const baseX = rect ? rect.left : 0
  const baseY = rect ? rect.top : 0
  const ctx: MenuContext = {
    selection: msg.selection,
    code: msg.code,
    image: msg.image,
    inCode: msg.inCode,
    canPrev: canPrev.value,
    canNext: canNext.value,
    settings: settings.value,
  }
  menuCtx.value = ctx
  menuItems.value = buildMenu(ctx)
  // iframe 内 clientX/Y 与主窗口像素 1:1（未使用 zoom 缩放）
  menuPos.value = {x: baseX + msg.x, y: baseY + msg.y}
}

function closeMenu() {
  menuPos.value = null
  menuCtx.value = null
}

function onMenuSelect(id: string, value?: string) {
  const ctx = menuCtx.value
  const win = iframeEl.value?.contentWindow
  switch (id) {
    case 'copy':
      postToIframe(win, {type: 'mr-copy'})
      break
    case 'select-all':
      postToIframe(win, {type: 'mr-select-all'})
      break
    case 'copy-code':
      if (ctx?.code) postToIframe(win, {type: 'mr-copy-code', index: ctx.code.index})
      break
    case 'lang':
      if (ctx?.code && value) {
        postToIframe(win, {type: 'mr-code-action', index: ctx.code.index, action: 'lang', value})
      }
      break
    case 'numbers':
      if (ctx?.code) postToIframe(win, {type: 'mr-code-action', index: ctx.code.index, action: 'numbers'})
      break
    case 'collapse':
      if (ctx?.code) postToIframe(win, {type: 'mr-code-action', index: ctx.code.index, action: 'collapse'})
      break
    case 'expand':
      if (ctx?.code) postToIframe(win, {type: 'mr-code-action', index: ctx.code.index, action: 'expand'})
      break
    case 'reject':
      if (ctx?.code) postToIframe(win, {type: 'mr-code-action', index: ctx.code.index, action: 'reject'})
      break
    case 'mark-code':
      postToIframe(win, {type: 'mr-mark-code'})
      break
    case 'font-dec':
      setFontSize(settings.value.fontSize - 1)
      break
    case 'font-inc':
      setFontSize(settings.value.fontSize + 1)
      break
    case 'font-reset':
      setFontSize(DEFAULT_SETTINGS.fontSize)
      break
    case 'theme':
      toggleTheme()
      break
    case 'prev':
      prev()
      break
    case 'next':
      next()
      break
    case 'toc':
      showToc.value = true
      break
    case 'view-image':
      if (ctx?.image) viewer.value = ctx.image
      break
    case 'copy-image':
      if (ctx?.image) copyImage(ctx.image.src)
      break
    case 'settings':
      showSettings.value = true
      break
    default:
      break
  }
  closeMenu()
}

/* ---------------- 来自 iframe 的消息 ---------------- */
function onChildMessage(e: MessageEvent) {
  const d = parseFromIframe(e.data)
  if (!d) return
  switch (d.type) {
    case 'mr-lang-set':
      langOverrides.value = {...langOverrides.value, [d.key]: d.lang}
      saveStringMap(LANG_KEY, langOverrides.value)
      break
    case 'mr-block-set':
      blockOverrides.value = {...blockOverrides.value, [d.key]: d.value}
      saveStringMap(BLOCK_KEY, blockOverrides.value)
      break
    case 'mr-clipboard':
      if (!d.ok) fallbackCopy(d.text)
      else showToast('已复制')
      break
    case 'mr-context':
      openMenu(d)
      break
    default:
      break
  }
}

/* ---------------- 键盘 ---------------- */
function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
    e.preventDefault()
    selectFile()
    return
  }
  if (e.key === 'Escape') {
    if (viewer.value) viewer.value = null
    else if (menuPos.value) closeMenu()
    else if (showSettings.value) showSettings.value = false
    else if (showToc.value) showToc.value = false
    return
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
    e.preventDefault()
    setFontSize(settings.value.fontSize + 1)
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key === '-') {
    e.preventDefault()
    setFontSize(settings.value.fontSize - 1)
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key === '0') {
    e.preventDefault()
    setFontSize(DEFAULT_SETTINGS.fontSize)
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
    e.preventDefault()
    toggleTheme()
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
    e.preventDefault()
    showToc.value = !showToc.value
    return
  }
  if (!book.value || menuPos.value || showSettings.value) return
  if (e.key === 'ArrowLeft') prev()
  else if (e.key === 'ArrowRight') next()
}

/* ---------------- 生命周期 ---------------- */
onMounted(async () => {
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('drop', onDOMDrop)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('message', onChildMessage)
  applyThemeToWindow(settings.value.theme)
  // useDropTarget=false：为 true 时 Wails 会校验落点元素是否带
  // `--wails-drop-target: drop` 样式，不满足就静默丢弃回调（本项目未定义该 CSS 变量）
  OnFileDrop(onWailsDrop, false)
  // 右键"发送到"启动：主动拉取命令行文件参数
  try {
    const p = await GetStartupFile()
    if (p) await openFile(p)
  } catch { /* 忽略 */ }
})

onBeforeUnmount(() => {
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('drop', onDOMDrop)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('message', onChildMessage)
})
</script>

<template>
  <!-- 欢迎页 / 阅读视图 -->
  <div v-if="!book" class="welcome">
    <div class="welcome-card">
      <div class="welcome-logo">📖</div>
      <h1>墨阅 MoRead</h1>
      <p class="sub">Go + Wails + Vue3 · 轻量 EPUB 阅读器</p>
      <button class="open-btn" @click="selectFile">打开 EPUB 文件</button>
      <div class="hint-list">
        <div><b>拖拽打开</b> · 将 EPUB 文件拖入本窗口</div>
        <div><b>发送到打开</b> · 右键 EPUB → 发送到 → 墨阅 MoRead</div>
        <div><b>代码阅读</b> · 语法高亮 + 行号 + 逐块切换语言</div>
        <div><b>右键菜单</b> · 复制、代码块操作、字号、主题与设置</div>
      </div>
    </div>
  </div>

  <template v-else>
    <header class="topbar">
      <button class="icon-btn" title="目录 (Ctrl+B)" @click="showToc = true">☰</button>
      <button class="icon-btn" title="打开文件 (Ctrl+O)" @click="selectFile">📂</button>
      <div class="book-meta">
        <span class="book-title" :title="book.title">{{ book.title }}</span>
        <span class="book-author" v-if="book.author">{{ book.author }}</span>
      </div>
      <div class="font-group">
        <button class="icon-btn" title="缩小字号 (Ctrl+-)" @click="setFontSize(settings.fontSize - 1)">A-</button>
        <button class="icon-btn" title="放大字号 (Ctrl+=)" @click="setFontSize(settings.fontSize + 1)">A+</button>
      </div>
      <button
        class="icon-btn"
        :title="settings.theme === 'dark' ? '夜间模式（点击切白天，Ctrl+D）' : '白天模式（点击切夜间，Ctrl+D）'"
        @click="toggleTheme"
      >{{ settings.theme === 'dark' ? '☀' : '🌙' }}</button>
      <button class="icon-btn" title="设置" @click="showSettings = true">⚙</button>
      <button class="icon-btn" title="上一章 (←)" :disabled="!canPrev" @click="prev">‹</button>
      <span class="chapter-pos">{{ current + 1 }} / {{ book.chapters.length }}</span>
      <button class="icon-btn" title="下一章 (→)" :disabled="!canNext" @click="next">›</button>
    </header>

    <main class="reader-area">
      <iframe
        ref="iframeEl"
        :key="chapterURL"
        :src="chapterURL"
        title="章节内容"
        @load="onIframeLoad"
        sandbox="allow-same-origin allow-scripts"
      ></iframe>
    </main>

    <TocDrawer
      v-if="showToc"
      :book="book"
      :current="current"
      @jump="jumpTo"
      @close="showToc = false"
    />
  </template>

  <!-- 右键菜单 -->
  <ContextMenu
    v-if="menuPos"
    :x="menuPos.x"
    :y="menuPos.y"
    :items="menuItems"
    @select="onMenuSelect"
    @close="closeMenu"
  />

  <!-- 设置 -->
  <SettingsDialog
    v-if="showSettings"
    v-model="settings"
    @close="showSettings = false"
  />

  <!-- 图片查看 -->
  <ImageViewer
    v-if="viewer"
    :src="viewer.src"
    :alt="viewer.alt"
    @close="viewer = null"
  />

  <!-- 拖放遮罩 -->
  <div v-if="dragging" class="drop-mask">
    <div class="drop-box">📄 松开以打开 EPUB</div>
  </div>

  <!-- Toast -->
  <div v-if="toast" class="toast">{{ toast }}</div>
</template>
