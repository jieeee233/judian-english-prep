<script setup lang="ts">
/**
 * 「导出词单」下拉：三种版式，导出成 Word（段落 + 编号，不用表格）。
 * 只负责选择版式，真正的导出交给父组件。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import AppIcon from '../AppIcon.vue';
import type { WordSheetMode } from '../../../shared/types';

defineProps<{ disabled?: boolean; busy?: boolean }>();
const emit = defineEmits<{ (event: 'export', mode: WordSheetMode): void }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);

function pick(mode: WordSheetMode) {
  open.value = false;
  emit('export', mode);
}

function onDocClick(event: MouseEvent) {
  if (open.value && !(event.target as HTMLElement | null)?.closest('.ws-wrap')) open.value = false;
}

onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));
</script>

<template>
  <div ref="root" class="ws-wrap">
    <button
      class="btn btn-ghost btn-sm icon-text"
      type="button"
      :disabled="disabled || busy"
      :aria-expanded="open"
      aria-haspopup="menu"
      title="把勾选的单词导出成默写单"
      @click.stop="open = !open"
    >
      <AppIcon name="word" :size="14" />
      {{ busy ? '导出中…' : '导出词单' }}
      <AppIcon name="chevron-down" :size="12" />
    </button>
    <div v-if="open" class="ws-menu" role="menu">
      <button type="button" role="menuitem" @click.stop="pick('en2zh')">
        <b>英译汉</b>
        <em>只给英文与词性，留白写中文</em>
      </button>
      <button type="button" role="menuitem" @click.stop="pick('zh2en')">
        <b>汉译英</b>
        <em>只给词性与中文，留白写英文</em>
      </button>
      <button type="button" role="menuitem" @click.stop="pick('both')">
        <b>中英对照</b>
        <em>完整词条，可用作词汇单</em>
      </button>
    </div>
  </div>
</template>
