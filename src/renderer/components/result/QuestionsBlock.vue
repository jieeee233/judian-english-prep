<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue';
import type { QuestionNote } from '../../../shared/types';
import { SOURCE_LOCATE } from '../../utils/sourceLocate';
import { sourceLabel } from '../../utils/sourceRef';
import AppIcon from '../AppIcon.vue';
import { splitOptions } from './parseText';

const props = withDefaults(defineProps<{ items?: QuestionNote[]; source?: string }>(), { source: '' });

const locate = inject(SOURCE_LOCATE, null);

const list = computed(() => props.items ?? []);
const open = ref(0);
/** 题号 + 选项：模型通常把题干与四个选项写在同一字段里 */
const parsed = computed(() =>
  list.value.map((item) => {
    const { stem, options } = splitOptions(item.question ?? '');
    const answer = (item.answer ?? '').trim();
    // 模型常只给一个字母，界面按设计稿补成「A · Honored.」
    const picked = /^[A-D]$/i.test(answer) ? options.find((one) => one.mark === answer.toUpperCase()) : null;
    return {
      item,
      stem: stem || item.question || '',
      options,
      answer: picked ? `${answer.toUpperCase()} · ${picked.text}` : answer,
      label: sourceLabel(props.source, item.evidence ?? '', 'quote'),
    };
  }),
);
const current = computed(() => parsed.value[open.value] ?? null);

watch(
  () => list.value.length,
  () => {
    if (open.value >= list.value.length) open.value = 0;
  },
);

function pick(index: number) {
  open.value = open.value === index ? -1 : index;
}

function goSource(text: string) {
  const value = (text ?? '').trim();
  if (value) locate?.(value, 'quote');
}
</script>

<template>
  <div v-if="list.length" class="qs-board">
    <div class="qs-pills" role="tablist" aria-label="题目">
      <span class="qs-count">{{ list.length }} 题</span>
      <button
        v-for="(row, index) in parsed"
        :key="row.item.no + index"
        type="button"
        role="tab"
        class="qs-pill"
        :class="{ active: open === index }"
        :aria-selected="open === index"
        @click="open = index"
      >
        {{ row.item.no || index + 1 }}
      </button>
    </div>

    <template v-if="current">
      <article class="qs-panel">
        <header class="qs-panel-head">
          <h3>第{{ current.item.no }}题</h3>
          <span v-if="current.item.tag" class="qs-tag">{{ current.item.tag }}</span>
        </header>

        <p class="qs-stem">{{ current.stem }}</p>

        <div v-if="current.options.length" class="qs-options">
          <div v-for="option in current.options" :key="option.mark" class="qs-option">
            <b>{{ option.mark }}.</b>
            <span>{{ option.text }}</span>
          </div>
        </div>

        <dl class="qs-rows">
          <div class="qs-row">
            <dt>答案</dt>
            <dd><span class="qs-answer">{{ current.answer || '—' }}</span></dd>
          </div>

          <div class="qs-row">
            <dt>原文依据</dt>
            <dd>
              <button
                v-if="current.item.evidence"
                type="button"
                class="qs-evidence"
                title="点击在左侧原文中定位"
                @click="goSource(current.item.evidence)"
              >
                <span class="qs-evidence-text">{{ current.item.evidence }}</span>
                <span v-if="current.label" class="qs-locate">{{ current.label }} · 定位原文</span>
              </button>
              <span v-else class="qs-blank">—</span>
            </dd>
          </div>

          <div class="qs-row">
            <dt>教学考点</dt>
            <dd>{{ current.item.point || '—' }}</dd>
          </div>

          <div class="qs-row">
            <dt>命题分析</dt>
            <dd>{{ current.item.logic || '—' }}</dd>
          </div>

          <div v-if="current.item.note" class="qs-row">
            <dt>核对提示</dt>
            <dd><span class="qs-note">{{ current.item.note }}</span></dd>
          </div>
        </dl>
      </article>

      <div v-if="list.length > 1" class="qs-rest">
        <button
          v-for="(row, index) in parsed"
          v-show="index !== open"
          :key="'rest-' + index"
          type="button"
          class="qs-rest-row"
          @click="open = index"
        >
          <span>第{{ row.item.no }}题</span>
          <span v-if="row.item.tag" class="qs-rest-tag">{{ row.item.tag }}</span>
          <AppIcon name="chevron-down" :size="14" />
        </button>
      </div>
    </template>
  </div>

  <div v-else class="block-empty">
    <p class="block-empty-title">本文没有识别到题目</p>
    <p class="block-empty-text">逐题讲解只处理文章里真实出现的题目，请确认题干与选项已完整粘贴。</p>
  </div>
</template>
