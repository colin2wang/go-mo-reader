<script setup lang="ts">
import {nextTick, onBeforeUnmount, onMounted, ref} from 'vue'
import type {MenuItem} from '../menu'

const props = defineProps<{
  x: number
  y: number
  items: MenuItem[]
}>()

const emit = defineEmits<{
  (e: 'select', id: string, value?: string): void
  (e: 'close'): void
}>()

const root = ref<HTMLElement | null>(null)
const left = ref(props.x)
const top = ref(props.y)
const ready = ref(false)
const subIndex = ref(-1)
const flipSub = ref(false)

function place() {
  const el = root.value
  if (!el) return
  const w = el.offsetWidth
  const h = el.offsetHeight
  const vw = window.innerWidth
  const vh = window.innerHeight
  left.value = props.x + w > vw - 6 ? Math.max(6, props.x - w) : props.x
  top.value = props.y + h > vh - 6 ? Math.max(6, vh - h - 6) : props.y
  flipSub.value = left.value + w * 2 + 8 > vw
  ready.value = true
}

function onSelect(item: MenuItem) {
  if (item.disabled || item.sep || item.children) return
  emit('select', item.id)
}

function onSelectChild(item: MenuItem, value: string) {
  subIndex.value = -1
  emit('select', item.id, value)
}

function onWindowDown(e: MouseEvent) {
  if (root.value && e.target instanceof Node && root.value.contains(e.target)) return
  emit('close')
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

function onResize() {
  emit('close')
}

onMounted(async () => {
  await nextTick()
  place()
  window.addEventListener('mousedown', onWindowDown, true)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onWindowDown, true)
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <div
    ref="root"
    class="ctx-menu"
    :class="{ready}"
    :style="{left: left + 'px', top: top + 'px'}"
    @contextmenu.prevent
  >
    <template v-for="(item, i) in items" :key="i">
      <div v-if="item.sep" class="ctx-sep"></div>
      <div
        v-else
        class="ctx-item"
        :class="{disabled: item.disabled}"
        @mouseenter="subIndex = item.children ? i : -1"
        @click="onSelect(item)"
      >
        <span class="ctx-icon">{{ item.icon || '' }}</span>
        <span class="ctx-label">{{ item.label }}</span>
        <span v-if="item.hint" class="ctx-hint">{{ item.hint }}</span>
        <span v-if="item.children" class="ctx-arrow">›</span>
        <div v-if="item.children && subIndex === i" class="ctx-sub" :class="{flip: flipSub}">
          <div
            v-for="c in item.children"
            :key="c.value"
            class="ctx-item"
            :class="{active: c.active}"
            @click.stop="onSelectChild(item, c.value)"
          >
            <span class="ctx-label">{{ c.label }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
