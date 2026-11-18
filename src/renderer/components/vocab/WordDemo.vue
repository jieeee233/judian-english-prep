<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { DemoItem } from '../../../shared/types';
import { showToast } from '../../store';
import { desktop } from '../../useDesktop';
import { plain } from '../../utils/plain';

const props = defineProps<{
  items: DemoItem[];
  title: string;
}>();

const emit = defineEmits<{ (event: 'close'): void }>();

const index = ref(0);
const exporting = ref(false);
const current = computed(() => props.items[index.value]);
const total = computed(() => props.items.length);

/** 卡片顶部的搭配：优先用逐条数据，没有就退回单行文本 */
const collocList = computed(() => {
  const item = current.value;
  if (!item) return [];
  if (item.collocations && item.collocations.length) return item.collocations;
  if (item.collocation) return [{ pattern: item.collocation, meaning: '' }];
  return [];
});

function move(step: number) {
  const next = index.value + step;
  if (next < 0 || next >= total.value) return;
  index.value = next;
}

async function exportFile() {
  if (exporting.value) return;
  exporting.value = true;
  try {
    const response = await desktop().exportDemo(
      plain({ title: props.title, items: props.items as DemoItem[] }),
    );
    if (!response.ok) {
      showToast('error', response.message);
      return;
    }
    if (response.canceled) {
      showToast('info', '已取消导出。');
      return;
    }
    showToast('ok', `演示文件已保存：${response.filePath}`);
  } catch (error) {
    showToast('error', error instanceof Error ? error.message : '导出失败，请稍后重试。');
  } finally {
    exporting.value = false;
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
    return;
  }
  if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) {
    event.preventDefault();
    move(-1);
    return;
  }
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(event.key)) {
    event.preventDefault();
    move(1);
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="demo" role="region" aria-label="单词演示">
    <button class="demo-back" type="button" @click="emit('close')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      返回词表
    </button>

    <span class="demo-progress">{{ index + 1 }} / {{ total }}</span>

    <div class="demo-zone prev" title="上一页" @click="move(-1)"></div>
    <div class="demo-zone mid" @click="move(1)"></div>
    <div class="demo-zone next" title="下一页" @click="move(1)"></div>

    <div class="demo-stage">
      <Transition name="slide-card" mode="out-in">
        <article v-if="current" :key="current.order + current.word" class="demo-card">
          <div class="demo-top">
            <span>第 {{ index + 1 }} / {{ total }} 词</span>
            <span class="dot" aria-hidden="true"></span>
            <span>{{ current.exercises?.length ? `${current.exercises.length} 道练习` : '暂无练习' }}</span>
          </div>
          <h2 class="demo-word">{{ current.word }}</h2>
          <p v-if="current.ipa" class="demo-ipa">/{{ current.ipa }}/</p>
          <div class="demo-rule" aria-hidden="true"></div>
          <p class="demo-meaning">
            <span v-if="current.pos" class="demo-pos">{{ current.pos }}</span>
            {{ current.meaning || '（暂无释义）' }}
          </p>
          <div v-if="collocList.length" class="demo-collocs">
            <h3>固定搭配</h3>
            <p v-for="colloc in collocList" :key="colloc.pattern" class="demo-colloc-row">
              <b>{{ colloc.pattern }}</b>
              <span v-if="colloc.meaning">{{ colloc.meaning }}</span>
            </p>
          </div>
        </article>
      </Transition>
    </div>

    <div class="demo-foot">
      <span class="demo-hint">
        <kbd>←</kbd><kbd>→</kbd> 切换 · <kbd>空格</kbd> 下一个 · <kbd>Esc</kbd> 返回
      </span>
      <button class="btn btn-primary btn-sm" type="button" :disabled="exporting" @click="exportFile">
        {{ exporting ? '正在生成…' : '生成演示文件' }}
      </button>
    </div>
  </div>
</template>
