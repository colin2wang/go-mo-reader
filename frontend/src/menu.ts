/**
 * 右键菜单项模型与构建逻辑。
 * 菜单内容随上下文变化（是否选中文本 / 是否在代码块上 / 是否在图片上），
 * 集中在这里拼装，App.vue 只负责按 id 派发动作。
 */
import type {CodeContext, ImageContext} from './bridge'
import type {ReaderSettings} from './settings'

export interface MenuChild {
  label: string
  value: string
  active?: boolean
}

export interface MenuItem {
  id: string
  label: string
  hint?: string
  icon?: string
  disabled?: boolean
  sep?: boolean
  children?: MenuChild[]
}

export interface MenuContext {
  selection: string
  code: CodeContext | null
  image: ImageContext | null
  inCode: boolean
  canPrev: boolean
  canNext: boolean
  settings: ReaderSettings
}

/** 代码块语言子菜单候选（与注入脚本语言集一致） */
const LANG_CANDIDATES: Array<{label: string; value: string}> = [
  {label: 'Python', value: 'python'},
  {label: 'JavaScript', value: 'javascript'},
  {label: 'Go', value: 'go'},
  {label: 'Java', value: 'java'},
  {label: 'C/C++', value: 'cpp'},
  {label: 'C#', value: 'csharp'},
  {label: 'SQL', value: 'sql'},
  {label: 'Rust', value: 'rust'},
  {label: 'PHP', value: 'php'},
  {label: 'Kotlin', value: 'kotlin'},
  {label: 'Swift', value: 'swift'},
  {label: 'Dart', value: 'dart'},
  {label: 'Lua', value: 'lua'},
  {label: 'Ruby', value: 'ruby'},
  {label: 'Shell', value: 'bash'},
  {label: 'CSS', value: 'css'},
  {label: 'JSON', value: 'json'},
  {label: 'YAML', value: 'yaml'},
  {label: 'HTML/XML', value: 'html'},
]

export function buildMenu(ctx: MenuContext): MenuItem[] {
  const items: MenuItem[] = []
  const push = (it: MenuItem) => items.push(it)

  // —— 文本操作 ——
  push({id: 'copy', label: '复制', hint: 'Ctrl+C', icon: '⧉', disabled: !ctx.selection})
  push({id: 'select-all', label: '全选', hint: 'Ctrl+A', icon: '▦'})

  // —— 代码块 ——
  if (ctx.code) {
    push({id: 'sep1', label: '', sep: true})
    push({id: 'copy-code', label: '复制代码块', icon: '⧉'})
    push({
      id: 'lang',
      label: '代码语言',
      icon: '≡',
      children: [
        {label: '自动检测', value: 'auto', active: !ctx.code.lang},
        {label: '纯文本', value: 'plain'},
        ...LANG_CANDIDATES.map((c) => ({...c, active: ctx.code!.lang === c.value})),
      ],
    })
    push({id: 'numbers', label: ctx.code.showNums ? '隐藏行号' : '显示行号', icon: '#'})
    push({
      id: ctx.code.collapsed ? 'expand' : 'collapse',
      label: ctx.code.collapsed ? '展开代码块' : '折叠代码块',
      icon: ctx.code.collapsed ? '⌄' : '⌃',
      disabled: ctx.code.lines < 6,
    })
    push({id: 'reject', label: '取消代码块', icon: '↩'})
  } else {
    push({id: 'sep1', label: '', sep: true})
    push({id: 'mark-code', label: '标记为代码块', icon: '≡'})
  }

  // —— 图片 ——
  if (ctx.image) {
    push({id: 'sep2', label: '', sep: true})
    push({id: 'view-image', label: '查看原图', icon: '🖼'})
    push({id: 'copy-image', label: '复制图片', icon: '⧉'})
  }

  // —— 阅读控制 ——
  push({id: 'sep3', label: '', sep: true})
  push({id: 'font-dec', label: '缩小字号', hint: 'Ctrl+-', icon: 'A-'})
  push({id: 'font-inc', label: '放大字号', hint: 'Ctrl+=', icon: 'A+'})
  push({id: 'font-reset', label: '重置字号', hint: 'Ctrl+0', icon: 'A'})
  push({
    id: 'theme',
    label: ctx.settings.theme === 'dark' ? '切换到白天' : '切换到夜间',
    icon: ctx.settings.theme === 'dark' ? '☀' : '🌙',
  })
  push({id: 'sep4', label: '', sep: true})
  push({id: 'prev', label: '上一章', hint: '←', icon: '‹', disabled: !ctx.canPrev})
  push({id: 'next', label: '下一章', hint: '→', icon: '›', disabled: !ctx.canNext})
  push({id: 'toc', label: '打开目录', hint: 'Ctrl+B', icon: '☰'})
  push({id: 'sep5', label: '', sep: true})
  push({id: 'settings', label: '设置…', icon: '⚙'})

  return items
}
