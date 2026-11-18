<script setup lang="ts">
import { computed, onActivated, ref } from 'vue';
import { payloadSections } from '../../shared/derive';
import { formatRelative } from '../../shared/format';
import type { HistoryEntry, HistorySummary } from '../../shared/types';
import AppIcon from '../components/AppIcon.vue';
import ResultBoard from '../components/result/ResultBoard.vue';
import SectionsView from '../components/SectionsView.vue';
import { currentInput, showToast, store } from '../store';
import { desktop } from '../useDesktop';

const items = ref<HistorySummary[]>([]);
const keyword = ref('');
const activeId = ref('');
const detail = ref<HistoryEntry | null>(null);
const loading = ref(true);
const busy = ref(false);

const filtered = computed(() => {
  const text = keyword.value.trim().toLowerCase();
  if (!text) return items.value;
  return items.value.filter((item) =>
    [item.excerpt, item.model, item.legacy ? '旧版' : ''].join(' ').toLowerCase().includes(text),
  );
});

function countText(item: HistorySummary): string {
  if (item.legacy) return '旧版结果';
  const parts = [
    item.counts.questions ? `${item.counts.questions} 题` : '',
    item.counts.vocab ? `${item.counts.vocab} 词` : '',
    item.counts.sentences ? `${item.counts.sentences} 句` : '',
  ].filter(Boolean);
  return parts.join(' · ') || '空记录';
}

/** 详情标题：与解析页同一套取法，取正文首句前段 */
const detailTitle = computed(() => {
  const text = detail.value?.input.text ?? '';
  const first = text.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
  if (!first) return '未命名文章';
  const cleaned = first.replace(/^[\d.\s、]+/, '').trim();
  if (cleaned.length <= 26) return cleaned;
  const cut = cleaned.slice(0, 26);
  const space = cut.lastIndexOf(' ');
  return `${space > 14 ? cut.slice(0, space) : cut}…`;
});

async function load() {
  loading.value = true;
  try {
    const response = await desktop().listHistory();
    if (!response.ok) {
      showToast('error', response.message);
      return;
    }
    items.value = response.items;
    if (items.value.length && !items.value.some((item) => item.id === activeId.value)) {
      await select(items.value[0].id);
    }
    if (!items.value.length) {
      activeId.value = '';
      detail.value = null;
    }
  } catch {
    showToast('error', '无法读取历史记录，请重新启动应用后重试。');
  } finally {
    loading.value = false;
  }
}

async function select(id: string) {
  activeId.value = id;
  const response = await desktop().getHistory(id);
  if (!response.ok) {
    showToast('error', response.message);
    detail.value = null;
    return;
  }
  detail.value = response.entry;
  // 回看记录时先停在篇章分析，避免沿用解析页里选中的页签
  store.resultTab = 'discourse';
}

async function remove(id: string) {
  if (busy.value) return;
  busy.value = true;
  try {
    const response = await desktop().removeHistory(id);
    if (!response.ok) {
      showToast('error', response.message);
      return;
    }
    items.value = response.items;
    showToast('ok', '已删除该条记录。');
    if (activeId.value === id) {
      activeId.value = '';
      detail.value = null;
      if (items.value.length) await select(items.value[0].id);
    }
  } finally {
    busy.value = false;
  }
}

async function clearAll() {
  if (busy.value || !items.value.length) return;
  if (!window.confirm(`确定清空全部 ${items.value.length} 条历史记录？该操作不可撤销。`)) return;
  busy.value = true;
  try {
    const response = await desktop().clearHistory();
    if (!response.ok) {
      showToast('error', response.message);
      return;
    }
    items.value = [];
    detail.value = null;
    activeId.value = '';
    showToast('ok', '历史记录已清空。');
  } finally {
    busy.value = false;
  }
}

/** 把历史记录的文章回填到解析页，继续在此基础上修改。 */
function resume(entry: HistoryEntry) {
  store.form.text = entry.input.text;
  store.analysis.error = '';
  store.practice.status = 'idle';
  store.resultTab = 'discourse';
  // 新版记录连结果一起带回，免得为了看一眼还得重跑一次模型
  if (entry.payload.legacy?.length || !entry.payload.discourse) {
    store.analysis.result = null;
    store.analysis.status = 'idle';
  } else {
    store.analysis.result = {
      ...entry.payload,
      input: entry.input,
      source: entry.source,
      isSample: false,
      model: entry.model,
      completedAt: entry.createdAt,
      requestId: entry.id,
      missing: entry.missing,
    };
    store.analysis.status = 'success';
  }
  store.view = 'analysis';
  showToast('ok', '已回填该篇记录。');
}

async function exportAs(format: 'docx' | 'md') {
  const entry = detail.value;
  if (!entry || busy.value) return;
  busy.value = true;
  try {
    const response = await desktop().exportLesson({
      format,
      sections: payloadSections(entry.payload),
      input: entry.input,
      model: entry.model,
      completedAt: entry.createdAt,
      source: entry.source,
      isSample: false,
    });
    if (!response.ok) {
      showToast('error', response.message);
      return;
    }
    showToast(response.canceled ? 'info' : 'ok', response.canceled ? '已取消导出。' : `已导出：${response.filePath}`);
  } finally {
    busy.value = false;
  }
}

/** 当前输入与选中记录是否一致，用于提示"回填"会覆盖草稿。 */
const draftMismatch = computed(() => {
  const entry = detail.value;
  if (!entry) return false;
  return JSON.stringify(currentInput()) !== JSON.stringify(entry.input) && Boolean(store.form.text.trim());
});

// KeepAlive 下每次切回都重新拉取，保证刚生成的结果立刻可见
onActivated(load);
</script>

<template>
  <div class="page hs-page">
    <aside class="hs-list card" aria-label="历史记录列表">
      <div class="hs-list-head">
        <h2>历史记录</h2>
      </div>

      <label class="hs-search">
        <AppIcon name="search" :size="14" />
        <input v-model="keyword" type="search" placeholder="搜索记录" aria-label="搜索历史记录" />
      </label>

      <div v-if="loading" class="hs-empty">正在读取…</div>
      <div v-else-if="!filtered.length" class="hs-empty">
        {{ items.length ? '没有匹配的记录' : '还没有历史记录' }}
      </div>

      <div v-else class="hs-items">
        <div
          v-for="item in filtered"
          :key="item.id"
          class="hs-item"
          :class="{ active: item.id === activeId }"
          role="button"
          tabindex="0"
          @click="select(item.id)"
          @keydown.enter.prevent="select(item.id)"
          @keydown.space.prevent="select(item.id)"
        >
          <span class="hs-item-title">{{ item.excerpt }}</span>
          <button
            class="hs-item-del"
            type="button"
            title="删除这条记录"
            aria-label="删除这条记录"
            @click.stop="remove(item.id)"
          >
            <AppIcon name="close" :size="11" />
          </button>
          <span class="hs-item-meta">{{ countText(item) }} · {{ formatRelative(item.createdAt) }}</span>
        </div>
      </div>

      <div v-if="items.length" class="hs-foot">
        <span>共 {{ items.length }} 条</span>
        <span class="spacer"></span>
        <button class="link-btn" type="button" :disabled="busy" @click="clearAll">清空记录</button>
      </div>
    </aside>

    <section class="hs-detail card" aria-label="记录详情">
      <template v-if="detail">
        <header class="hs-head">
          <div class="hs-title">
            <h1 :title="detailTitle">{{ detailTitle }}</h1>
            <div class="hs-meta">
              <span v-if="detail.payload.legacy?.length">旧版结果</span>
              <template v-else>
                <span>{{ detail.payload.questions?.length ?? 0 }} 题</span>
                <i>·</i>
                <span>{{ detail.payload.vocab?.length ?? 0 }} 词</span>
                <i>·</i>
                <span>{{ detail.payload.sentences?.length ?? 0 }} 句</span>
                <i>·</i>
              </template>
              <span>{{ formatRelative(detail.createdAt) }}</span>
            </div>
          </div>
          <div class="hs-actions">
            <button class="btn btn-primary btn-sm icon-text" type="button" :disabled="busy" @click="resume(detail)">
              <AppIcon name="arrow-left" :size="13" />
              回填到解析页
            </button>
            <button class="btn btn-ghost btn-sm icon-text" type="button" :disabled="busy" @click="exportAs('docx')">
              <AppIcon name="word" :size="13" />
              导出 Word
            </button>
          </div>
        </header>

        <div v-if="draftMismatch" class="an-stale">
          解析页草稿里还有其它文章，回填会覆盖。
          <button class="link-btn" type="button" @click="resume(detail)">仍要回填</button>
        </div>

        <SectionsView v-if="detail.payload.legacy?.length" :sections="detail.payload.legacy" />
        <ResultBoard
          v-else
          :payload="detail.payload"
          :missing="detail.missing"
          :interactive-practice="false"
          difficulty="medium"
          practice-status="idle"
          practice-error=""
          :source="detail.input.text"
        />
      </template>

      <div v-else class="empty" style="flex: 1 1 auto">
        <span class="empty-mark" aria-hidden="true">Aa</span>
        <p>{{ loading ? '正在读取…' : '选择左侧的一条记录' }}</p>
      </div>
    </section>
  </div>
</template>
