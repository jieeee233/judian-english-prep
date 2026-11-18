<script setup lang="ts">
import { computed } from 'vue';
import { DISCOURSE_LABELS } from '../../../shared/constants';
import type { DiscourseNote } from '../../../shared/types';
import AppIcon from '../AppIcon.vue';
import { parseStructure } from './parseText';

const props = defineProps<{ note?: DiscourseNote }>();

const genre = computed(() => props.note?.genre?.trim() || '');
const gist = computed(() => props.note?.gist?.trim() || '');
const purpose = computed(() => props.note?.purpose?.trim() || '');
const structure = computed(() => parseStructure(props.note?.structure ?? ''));

/** 结构原文没有段号时（模型写成一段散文），退化成一张不带段签的卡 */
const hasTags = computed(() => structure.value.some((line) => line.tag));
</script>

<template>
  <div v-if="note" class="dc-list">
    <div class="dc-row">
      <span class="dc-label">{{ DISCOURSE_LABELS.genre }}</span>
      <div class="dc-value">
        <span v-if="genre" class="dc-genre">{{ genre }}</span>
        <span v-else class="dc-blank">—</span>
      </div>
    </div>

    <div class="dc-row">
      <span class="dc-label">{{ DISCOURSE_LABELS.gist }}</span>
      <p class="dc-value">{{ gist || '—' }}</p>
    </div>

    <div class="dc-row dc-row-top">
      <span class="dc-label">{{ DISCOURSE_LABELS.structure }}</span>
      <div class="dc-value">
        <div v-if="structure.length" class="dc-paras" :class="{ 'is-flat': !hasTags }">
          <article v-for="(line, index) in structure" :key="index" class="dc-para">
            <span v-if="hasTags" class="dc-para-tag">
              {{ line.tag || `P${index + 1}` }}
              <AppIcon name="chevron-down" :size="10" class="dc-para-arrow" />
            </span>
            <div class="dc-para-body">
              <h4 v-if="line.title">{{ line.title }}</h4>
              <p>{{ line.body }}</p>
            </div>
          </article>
        </div>
        <p v-else class="dc-value">—</p>
      </div>
    </div>

    <div class="dc-row">
      <span class="dc-label">{{ DISCOURSE_LABELS.purpose }}</span>
      <p class="dc-value">{{ purpose || '—' }}</p>
    </div>
  </div>

  <div v-else class="block-empty">
    <p class="block-empty-title">本次没有生成篇章分析</p>
    <p class="block-empty-text">可点顶部「重新解析」再试一次。</p>
  </div>
</template>
