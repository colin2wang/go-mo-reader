<script setup lang="ts">
import {computed, ref, watch} from 'vue'
import {DEFAULT_SETTINGS, type ReaderSettings} from '../settings'

const props = defineProps<{
  modelValue: ReaderSettings
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: ReaderSettings): void
  (e: 'close'): void
}>()

type Group = 'look' | 'type' | 'code' | 'image'
const group = ref<Group>('look')

const groups: Array<{id: Group; label: string}> = [
  {id: 'look', label: '外观'},
  {id: 'type', label: '排版'},
  {id: 'code', label: '代码'},
  {id: 'image', label: '图片'},
]

// 编辑副本：所有改动即时生效（父级 watch 后下发 iframe）。
// 对话框由 v-if 挂载，打开时从 props 取一次初值即可；
// 再反向 watch props 会与 draft 的 emit 形成互相触发的循环。
const draft = ref<ReaderSettings>({...props.modelValue})
watch(
  draft,
  (v) => emit('update:modelValue', {...v}),
  {deep: true},
)

const fontFamilyLabel = computed(() => (draft.value.fontFamily === 'sans' ? '无衬线' : '衬线'))

function set<K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) {
  draft.value = {...draft.value, [key]: value}
}

function reset() {
  draft.value = {...DEFAULT_SETTINGS, theme: draft.value.theme}
}
</script>

<template>
  <div class="dlg-mask" @click="emit('close')"></div>
  <div class="dlg" role="dialog" aria-label="设置">
    <div class="dlg-head">
      <h3>设置</h3>
      <button class="dlg-x" title="关闭 (Esc)" @click="emit('close')">✕</button>
    </div>

    <div class="dlg-body">
      <nav class="dlg-nav">
        <button
          v-for="g in groups"
          :key="g.id"
          class="dlg-nav-item"
          :class="{active: group === g.id}"
          @click="group = g.id"
        >{{ g.label }}</button>
      </nav>

      <div class="dlg-pane">
        <!-- 外观 -->
        <template v-if="group === 'look'">
          <div class="row">
            <span class="row-label">主题</span>
            <div class="seg">
              <button :class="{on: draft.theme === 'light'}" @click="set('theme', 'light')">白天</button>
              <button :class="{on: draft.theme === 'dark'}" @click="set('theme', 'dark')">夜间</button>
            </div>
          </div>
          <p class="row-note">切换后顶栏、目录、正文、表格与代码块配色会一起变化。</p>
        </template>

        <!-- 排版 -->
        <template v-else-if="group === 'type'">
          <div class="row">
            <span class="row-label">正文字体</span>
            <div class="seg">
              <button :class="{on: draft.fontFamily === 'serif'}" @click="set('fontFamily', 'serif')">衬线</button>
              <button :class="{on: draft.fontFamily === 'sans'}" @click="set('fontFamily', 'sans')">无衬线</button>
            </div>
          </div>
          <div class="row">
            <span class="row-label">字号</span>
            <input
              type="range" min="14" max="24" step="1"
              :value="draft.fontSize"
              @input="set('fontSize', Number(($event.target as HTMLInputElement).value))"
            >
            <span class="row-val">{{ draft.fontSize }}px</span>
          </div>
          <div class="row">
            <span class="row-label">行高</span>
            <input
              type="range" min="1.4" max="2.4" step="0.1"
              :value="draft.lineHeight"
              @input="set('lineHeight', Number(($event.target as HTMLInputElement).value))"
            >
            <span class="row-val">{{ draft.lineHeight.toFixed(1) }}</span>
          </div>
          <div class="row">
            <span class="row-label">页宽</span>
            <input
              type="range" min="560" max="1100" step="20"
              :value="draft.pageWidth"
              @input="set('pageWidth', Number(($event.target as HTMLInputElement).value))"
            >
            <span class="row-val">{{ draft.pageWidth }}px</span>
          </div>
          <div class="row">
            <span class="row-label">段首缩进</span>
            <button class="switch" :class="{on: draft.indent}" @click="set('indent', !draft.indent)">
              <i></i>
            </button>
          </div>
          <div class="row">
            <span class="row-label">两端对齐</span>
            <button class="switch" :class="{on: draft.justify}" @click="set('justify', !draft.justify)">
              <i></i>
            </button>
          </div>
          <div class="row">
            <span class="row-label">忽略原书样式</span>
            <button class="switch" :class="{on: draft.unifyStyle}" @click="set('unifyStyle', !draft.unifyStyle)">
              <i></i>
            </button>
          </div>
          <p class="row-note">关闭后恢复书籍自带的字体、配色与间距。当前字体：{{ fontFamilyLabel }}。</p>
        </template>

        <!-- 代码 -->
        <template v-else-if="group === 'code'">
          <div class="row">
            <span class="row-label">代码字号</span>
            <input
              type="range" min="11" max="20" step="0.5"
              :value="draft.codeFontSize"
              @input="set('codeFontSize', Number(($event.target as HTMLInputElement).value))"
            >
            <span class="row-val">{{ draft.codeFontSize }}px</span>
          </div>
          <div class="row">
            <span class="row-label">显示行号</span>
            <button class="switch" :class="{on: draft.codeLineNumbers}" @click="set('codeLineNumbers', !draft.codeLineNumbers)">
              <i></i>
            </button>
          </div>
          <div class="row">
            <span class="row-label">自动识别语言</span>
            <button class="switch" :class="{on: draft.autoDetectLang}" @click="set('autoDetectLang', !draft.autoDetectLang)">
              <i></i>
            </button>
          </div>
          <div class="row">
            <span class="row-label">折叠行数阈值</span>
            <input
              type="range" min="0" max="120" step="5"
              :value="draft.foldThreshold"
              @input="set('foldThreshold', Number(($event.target as HTMLInputElement).value))"
            >
            <span class="row-val">{{ draft.foldThreshold === 0 ? '不折叠' : draft.foldThreshold + ' 行' }}</span>
          </div>
          <p class="row-note">识别不准时，可在代码块右上角或右键菜单里逐块指定语言，选择会被记住。</p>
        </template>

        <!-- 图片 -->
        <template v-else>
          <div class="row">
            <span class="row-label">夜间降低图片亮度</span>
            <button class="switch" :class="{on: draft.dimImagesInDark}" @click="set('dimImagesInDark', !draft.dimImagesInDark)">
              <i></i>
            </button>
          </div>
          <p class="row-note">夜间模式下把插图整体压暗，适合亮底示意图与公式图。</p>
        </template>
      </div>
    </div>

    <div class="dlg-foot">
      <button class="dlg-btn" @click="reset">恢复默认</button>
      <span class="dlg-space"></span>
      <button class="dlg-btn primary" @click="emit('close')">完成</button>
    </div>
  </div>
</template>
