<script setup lang="ts">
import {epub} from '../../wailsjs/go/models'

defineProps<{
  book: epub.Book
  current: number
}>()

const emit = defineEmits<{
  (e: 'jump', index: number): void
  (e: 'close'): void
}>()
</script>

<template>
  <div class="toc-mask" @click="emit('close')"></div>
  <aside class="toc-drawer">
    <div class="toc-head">
      <h3>{{ book.title }}</h3>
      <p v-if="book.author">{{ book.author }} · {{ book.chapters.length }} 章</p>
      <p v-else>{{ book.chapters.length }} 章</p>
    </div>
    <nav class="toc-list">
      <button
        v-for="ch in book.chapters"
        :key="ch.index"
        class="toc-item"
        :class="{active: ch.index === current}"
        :title="ch.title"
        @click="emit('jump', ch.index)"
      >{{ ch.index + 1 }}. {{ ch.title }}</button>
    </nav>
  </aside>
</template>
