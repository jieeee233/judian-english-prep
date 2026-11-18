<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue';
import type { SentenceNote } from '../../../shared/types';
import { sourceLabel } from '../../utils/sourceRef';
import { SOURCE_LOCATE } from '../../utils/sourceLocate';
import { parseClauses } from './parseText';

const props = withDefaults(defineProps<{ items?: SentenceNote[]; source?: string }>(), { source: '' });

const locate = inject(SOURCE_LOCATE, null);

const list = computed(() => props.items ?? []);
const open = ref(0);

const rows = computed(() =>
  list.value.map((item) => ({
    item,
    label: sourceLabel(props.source, item.quote, 'quote'),
    clauses: parseClauses(item.structure ?? ''),
  })),
);

const current = computed(() => rows.value[open.value] ?? null);

watch(
  () => list.value.length,
  () => {
    if (open.value >= list.value.length) open.value = 0;
  },
);

function goSource(quote: string) {
  if (quote.trim()) locate?.(quote, 'quote');
}
</script>

<template>
  <div v-if="rows.length" class="sn-board">
    <div class="sn-pills" role="tablist" aria-label="长难句">
      <button
        v-for="(row, index) in rows"
        :key="row.item.id + index"
        type="button"
        role="tab"
        class="sn-pill"
        :class="{ active: open === index }"
        :aria-selected="open === index"
        @click="open = index"
      >
        句{{ index + 1 }}
      </button>
    </div>

    <article v-if="current" class="sn-panel">
      <header class="sn-head">
        <h3>句{{ open + 1 }}<span v-if="current.label" class="sn-from">（来自 {{ current.label }}）</span></h3>
        <button v-if="current.label" type="button" class="sn-locate" @click="goSource(current.item.quote)">
          {{ current.label }} · 定位原文
        </button>
      </header>

      <p class="sn-quote">{{ current.item.quote }}</p>

      <dl class="sn-rows">
        <div class="sn-row is-tree">
          <dt>句式结构</dt>
          <dd>
            <div v-if="current.clauses.length" class="sn-tree">
              <div v-for="clause in current.clauses" :key="clause.label + clause.body" class="sn-tree-row">
                <span class="sn-tree-label">{{ clause.label }}</span>
                <span class="sn-tree-line" aria-hidden="true"></span>
                <span class="sn-tree-text">{{ clause.body }}</span>
              </div>
            </div>
            <p v-else class="sn-plain">{{ current.item.structure || '—' }}</p>
          </dd>
        </div>

        <div class="sn-row">
          <dt>翻译</dt>
          <dd>{{ current.item.translation || '—' }}</dd>
        </div>

        <div v-if="current.item.analysis" class="sn-row">
          <dt>分析</dt>
          <dd>{{ current.item.analysis }}</dd>
        </div>
      </dl>
    </article>
  </div>

  <div v-else class="block-empty">
    <p class="block-empty-title">本次没有生成长难句</p>
    <p class="block-empty-text">可重新解析，或换一篇结构更复杂的文章。</p>
  </div>
</template>
