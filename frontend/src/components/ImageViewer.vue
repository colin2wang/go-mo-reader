<script setup lang="ts">
import {onBeforeUnmount, onMounted, ref} from 'vue'

defineProps<{
  src: string
  alt?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const scale = ref(1)
const MIN = 0.2
const MAX = 6

function zoom(delta: number) {
  scale.value = Math.min(MAX, Math.max(MIN, Math.round((scale.value + delta) * 100) / 100))
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  zoom(e.deltaY < 0 ? 0.12 : -0.12)
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
  else if (e.key === '+' || e.key === '=') zoom(0.2)
  else if (e.key === '-') zoom(-0.2)
  else if (e.key === '0') scale.value = 1
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="viewer" @click.self="emit('close')" @wheel="onWheel">
    <div class="viewer-bar">
      <span class="viewer-title" :title="alt">{{ alt || '图片' }}</span>
      <button title="缩小" @click="zoom(-0.2)">－</button>
      <span class="viewer-scale">{{ Math.round(scale * 100) }}%</span>
      <button title="放大" @click="zoom(0.2)">＋</button>
      <button title="原始尺寸" @click="scale = 1">1:1</button>
      <button class="viewer-x" title="关闭 (Esc)" @click="emit('close')">✕</button>
    </div>
    <div class="viewer-stage">
      <img :src="src" :alt="alt || ''" :style="{transform: 'scale(' + scale + ')'}" @click.stop>
    </div>
  </div>
</template>
