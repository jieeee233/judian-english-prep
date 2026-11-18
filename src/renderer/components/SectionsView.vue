<script setup lang="ts">
import type { Section } from '../../shared/types';
import { showToast } from '../store';
import { copyToClipboard } from '../utils/copy';

const props = defineProps<{ sections: Section[] }>();

const CN_NUM = ['一', '二', '三', '四'];

async function copySection(section: Section) {
  const ok = await copyToClipboard(`${section.title}\n${section.text}`);
  showToast(
    ok ? 'ok' : 'error',
    ok ? `已复制「${section.title}」` : '复制失败，请手动选择文本后按 Ctrl+C。',
  );
}
</script>

<template>
  <div class="sections">
    <article v-for="(section, index) in props.sections" :key="section.id" class="section-card">
      <header class="section-head">
        <span class="section-index">{{ CN_NUM[index] ?? index + 1 }}</span>
        <h3 class="section-title">{{ section.title }}</h3>
        <button class="link-btn copy" type="button" @click="copySection(section)">复制</button>
      </header>
      <p class="section-body">{{ section.text }}</p>
    </article>
  </div>
</template>
