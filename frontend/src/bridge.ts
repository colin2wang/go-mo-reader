/**
 * 主窗口 ↔ 章节 iframe 的 postMessage 协议。
 * 章节是独立文档（同源但独立 DOM），所有交互都走这一层，
 * 新增字段时两端同步在此处声明，避免各处硬编码字符串。
 */
import type {BlockOverride, LangOverride, ReaderSettings, Theme} from './settings'

/** iframe 上报的代码块上下文（右键菜单据此决定显示哪些分组） */
export interface CodeContext {
  index: number
  lang: string | null
  lines: number
  collapsed: boolean
  showNums: boolean
}

/** iframe 上报的图片上下文 */
export interface ImageContext {
  src: string
  alt: string
}

export type CodeAction =
  | 'lang'        // 切换语言，value 为语言名 / 'plain' / 'auto'
  | 'numbers'     // 切换行号
  | 'collapse'    // 折叠
  | 'expand'      // 展开
  | 'reject'      // 取消代码块（还原原文）

/** 主窗口 → iframe */
export type ToIframe =
  | {type: 'mr-theme'; theme: Theme}
  | {type: 'mr-settings'; settings: ReaderSettings}
  | {type: 'mr-lang-overrides'; map: Record<string, LangOverride>}
  | {type: 'mr-block-overrides'; map: Record<string, BlockOverride>}
  | {type: 'mr-scroll-top'}
  | {type: 'mr-copy'}
  | {type: 'mr-select-all'}
  | {type: 'mr-copy-code'; index: number}
  | {type: 'mr-code-action'; index: number; action: CodeAction; value?: string}
  | {type: 'mr-mark-code'}   // 把当前光标/选区所在元素强制标记为代码块

/** iframe → 主窗口 */
export type FromIframe =
  | {type: 'mr-lang-set'; key: string; lang: string}
  | {type: 'mr-block-set'; key: string; value: BlockOverride}
  | {type: 'mr-context'; x: number; y: number; selection: string; code: CodeContext | null; image: ImageContext | null; inCode: boolean}
  | {type: 'mr-clipboard'; text: string; ok: boolean}
  | {type: 'mr-code-changed'; index: number; lang: string | null; lines: number; collapsed: boolean; showNums: boolean}

/** 向章节 iframe 下发消息（iframe 尚未就绪时静默丢弃） */
export function postToIframe(win: Window | null | undefined, msg: ToIframe): void {
  if (!win) return
  try {
    win.postMessage(msg, '*')
  } catch {
    /* 忽略：跨文档异常不影响主流程 */
  }
}

/** 解析 iframe 上报消息，非本协议消息返回 null */
export function parseFromIframe(data: unknown): FromIframe | null {
  const d = data as {type?: string} | null
  if (!d || typeof d.type !== 'string' || d.type.indexOf('mr-') !== 0) return null
  return d as FromIframe
}
