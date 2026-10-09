<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref} from 'vue'
import TocDrawer from './components/TocDrawer.vue'
import {
  CloseBook,
  GetStartupFile,
  OpenFileDialog,
  OpenPath,
} from '../wailsjs/go/main/App'
import {OnFileDrop} from '../wailsjs/runtime/runtime'
import {epub} from '../wailsjs/go/models'

/* ---------------- 状态 ---------------- */
const book = ref<epub.Book | null>(null)
const current = ref(0)
const showToc = ref(false)
const dragging = ref(false)
const toast = ref('')
const iframeEl = ref<HTMLIFrameElement | null>(null)
const fontZoom = ref(1)

const chapterURL = computed(() => {
  const b = book.value
  if (!b) return ''
  const ch = b.chapters[current.value]
  return ch ? `/epub/${b.id}/${encodeURI(ch.path)}` : ''
})

let toastTimer = 0
function showToast(msg: string) {
  toast.value = msg
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = ''), 2600)
}

/* ---------------- 打开流程 ---------------- */
async function openFile(path: string) {
  if (!path) return
  try {
    const b = await OpenPath(path)
    if (book.value) await CloseBook(book.value.id)
    book.value = b
    current.value = 0
    fontZoom.value = 1
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
  iframeEl.value?.contentWindow?.postMessage({type: 'mr-scroll-top'}, '*')
}

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
    e.preventDefault()
    selectFile()
    return
  }
  if (!book.value) return
  if (e.key === 'ArrowLeft') prev()
  else if (e.key === 'ArrowRight') next()
}

/* ---------------- 字号调节 ---------------- */
// 新 iframe 加载完成后同步当前缩放并回到顶部
function onIframeLoad() {
  bindIframeDrop()
  iframeEl.value?.contentWindow?.postMessage(
    {type: 'mr-font', set: fontZoom.value}, '*')
  scrollTop()
}
function changeFont(delta: number) {
  fontZoom.value = Math.min(2, Math.max(0.6, fontZoom.value + delta))
  iframeEl.value?.contentWindow?.postMessage(
    {type: 'mr-font', delta}, '*')
}

/* ---------------- 生命周期 ---------------- */
onMounted(async () => {
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('drop', onDOMDrop)
  window.addEventListener('keydown', onKeydown)
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
        <div><b>代码阅读</b> · 自动语法高亮 + 行号显示</div>
      </div>
    </div>
  </div>

  <template v-else>
    <header class="topbar">
      <button class="icon-btn" title="目录 (☰)" @click="showToc = true">☰</button>
      <button class="icon-btn" title="打开文件 (Ctrl+O)" @click="selectFile">📂</button>
      <div class="book-meta">
        <span class="book-title" :title="book.title">{{ book.title }}</span>
        <span class="book-author" v-if="book.author">{{ book.author }}</span>
      </div>
      <div class="font-group">
        <button class="icon-btn" title="缩小字号" @click="changeFont(-0.1)">A-</button>
        <button class="icon-btn" title="放大字号" @click="changeFont(0.1)">A+</button>
      </div>
      <button class="icon-btn" title="上一章 (←)" :disabled="current <= 0" @click="prev">‹</button>
      <span class="chapter-pos">{{ current + 1 }} / {{ book.chapters.length }}</span>
      <button class="icon-btn" title="下一章 (→)" :disabled="current >= book.chapters.length - 1" @click="next">›</button>
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

  <!-- 拖放遮罩 -->
  <div v-if="dragging" class="drop-mask">
    <div class="drop-box">📄 松开以打开 EPUB</div>
  </div>

  <!-- Toast -->
  <div v-if="toast" class="toast">{{ toast }}</div>
</template>
