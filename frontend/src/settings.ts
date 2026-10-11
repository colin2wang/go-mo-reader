/**
 * 阅读设置：类型定义、默认值、localStorage 读写与旧版本迁移。
 * 设置同时作用于主窗口（顶栏/浮层配色）与章节 iframe（排版与代码块）。
 */

export type Theme = 'light' | 'dark'
export type FontFamily = 'serif' | 'sans'

/** 逐块语言选择：value 为语言名、'plain'（纯文本）或 'auto'（跟随自动检测） */
export type LangOverride = string
/** 逐块纠正：force=强制按代码块渲染，reject=取消代码块 */
export type BlockOverride = 'force' | 'reject'

export interface ReaderSettings {
  /** 全局主题：白天 / 夜间 */
  theme: Theme
  /** 正文字体族：衬线 / 无衬线 */
  fontFamily: FontFamily
  /** 正文字号（px） */
  fontSize: number
  /** 正文行高倍数 */
  lineHeight: number
  /** 正文最大宽度（px） */
  pageWidth: number
  /** 段首缩进 2em */
  indent: boolean
  /** 两端对齐 */
  justify: boolean
  /** 忽略原书样式（统一排版） */
  unifyStyle: boolean
  /** 代码块字号（px） */
  codeFontSize: number
  /** 代码块默认显示行号 */
  codeLineNumbers: boolean
  /** 自动检测代码语言 */
  autoDetectLang: boolean
  /** 超过该行数时提供折叠 */
  foldThreshold: number
  /** 夜间模式下降图片亮度 */
  dimImagesInDark: boolean
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: 'light',
  fontFamily: 'serif',
  fontSize: 17,
  lineHeight: 1.8,
  pageWidth: 780,
  indent: true,
  justify: true,
  unifyStyle: true,
  codeFontSize: 13.5,
  codeLineNumbers: true,
  autoDetectLang: true,
  foldThreshold: 30,
  dimImagesInDark: false,
}

const KEY = 'mr-settings-v1'
const LEGACY_THEME_KEY = 'mr-code-theme'
export const LANG_KEY = 'mr-code-lang'
export const BLOCK_KEY = 'mr-code-blocks'

function num(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === 'number' && isFinite(v) ? v : def
  return Math.min(max, Math.max(min, n))
}

function bool(v: unknown, def: boolean): boolean {
  return typeof v === 'boolean' ? v : def
}

/** 读取设置；字段缺失或类型不对时逐项回退到默认值 */
export function loadSettings(): ReaderSettings {
  const d = DEFAULT_SETTINGS
  let raw: Record<string, unknown> = {}
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || '{}') || {}
  } catch {
    raw = {}
  }
  // 迁移：老版本只存过代码块主题，这里升级为全局主题
  let theme = raw.theme
  if (theme !== 'light' && theme !== 'dark') {
    try {
      const legacy = localStorage.getItem(LEGACY_THEME_KEY)
      if (legacy === 'dark' || legacy === 'light') theme = legacy
    } catch {
      /* 忽略 */
    }
  }
  return {
    theme: theme === 'dark' ? 'dark' : d.theme,
    fontFamily: raw.fontFamily === 'sans' ? 'sans' : d.fontFamily,
    fontSize: num(raw.fontSize, d.fontSize, 13, 26),
    lineHeight: num(raw.lineHeight, d.lineHeight, 1.4, 2.4),
    pageWidth: num(raw.pageWidth, d.pageWidth, 560, 1200),
    indent: bool(raw.indent, d.indent),
    justify: bool(raw.justify, d.justify),
    unifyStyle: bool(raw.unifyStyle, d.unifyStyle),
    codeFontSize: num(raw.codeFontSize, d.codeFontSize, 10, 22),
    codeLineNumbers: bool(raw.codeLineNumbers, d.codeLineNumbers),
    autoDetectLang: bool(raw.autoDetectLang, d.autoDetectLang),
    foldThreshold: num(raw.foldThreshold, d.foldThreshold, 0, 400),
    dimImagesInDark: bool(raw.dimImagesInDark, d.dimImagesInDark),
  }
}

export function saveSettings(s: ReaderSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* 忽略：异常时退化为内存态 */
  }
}

export function loadStringMap(key: string): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '{}')
    return v && typeof v === 'object' ? v as Record<string, string> : {}
  } catch {
    return {}
  }
}

export function saveStringMap(key: string, map: Record<string, string>): void {
  try {
    localStorage.setItem(key, JSON.stringify(map))
  } catch {
    /* 忽略 */
  }
}
