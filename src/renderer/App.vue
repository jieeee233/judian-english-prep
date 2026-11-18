<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import brandMark from './brand-mark.png';
import AnalysisView from './views/AnalysisView.vue';
import HistoryView from './views/HistoryView.vue';
import SettingsView from './views/SettingsView.vue';
import VocabView from './views/VocabView.vue';
import { go, showToast, store, type ViewKey } from './store';
import { loadMyVocab } from './useMyVocab';
import { desktop } from './useDesktop';

const navItems: Array<{ key: ViewKey; label: string }> = [
  { key: 'analysis', label: '文章解析' },
  { key: 'wordbook', label: '单词本' },
  { key: 'history', label: '历史记录' },
  { key: 'settings', label: 'API 设置' },
];

const currentView = computed(() => {
  switch (store.view) {
    case 'analysis':
      return AnalysisView;
    case 'wordbook':
      return VocabView;
    case 'history':
      return HistoryView;
    default:
      return SettingsView;
  }
});

const generating = computed(() => store.analysis.status === 'generating');

// 专注备课只在解析页有意义：离开该页自动还原导航，避免整站没有出口
watch(
  () => store.view,
  (view) => {
    if (view !== 'analysis') store.focus = false;
  },
);

onMounted(async () => {
  try {
    store.settings = await desktop().getSettings();
    // 启动即预热我的词汇，重点词汇页的"已收藏"标记才准
    void loadMyVocab();
    if (!store.settings.hasKey) store.view = 'settings';
  } catch (error) {
    showToast('error', error instanceof Error ? error.message : '无法读取本地设置，请重新启动应用。');
  } finally {
    store.ready = true;
  }
  if (store.previewMode) {
    showToast('info', '当前是浏览器预览模式：数据为模拟内容，不会真的请求模型。');
  }
});
</script>

<template>
  <div class="shell" :class="{ 'is-focus': store.focus }">
    <header class="topbar">
      <div class="topbar-brand">
        <span class="topbar-mark" aria-hidden="true"><img :src="brandMark" alt="" width="28" height="28" /></span>
        <strong>句点英语备课</strong>
      </div>

      <nav class="topnav" aria-label="主导航">
        <button
          v-for="item in navItems"
          :key="item.key"
          type="button"
          class="topnav-item"
          :class="{ active: store.view === item.key }"
          :aria-current="store.view === item.key ? 'page' : undefined"
          @click="go(item.key)"
        >
          {{ item.label }}
          <span v-if="item.key === 'analysis' && generating" class="topnav-dot" aria-hidden="true"></span>
        </button>
      </nav>

      <span class="spacer"></span>
    </header>

    <main class="workspace">
      <Transition name="toast">
        <div v-if="store.toast" class="toast" :class="store.toast.kind" role="status">
          {{ store.toast.text }}
        </div>
      </Transition>

      <div v-if="!store.ready" class="empty">
        <span class="empty-mark" aria-hidden="true">Aa</span>
        <p>正在读取本地设置…</p>
      </div>
      <KeepAlive v-else>
        <component :is="currentView" />
      </KeepAlive>
    </main>
  </div>
</template>
