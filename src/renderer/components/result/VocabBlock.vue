<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import type { VocabEntry } from '../../../shared/types';
import { findMyVocab } from '../../useMyVocab';
import { phraseAround, sourceLabel } from '../../utils/sourceRef';
import { SOURCE_LOCATE } from '../../utils/sourceLocate';
import AppIcon from '../AppIcon.vue';

const props = withDefaults(
  defineProps<{
    items?: VocabEntry[];
    /** 原文正文，用于算「原文」短语与段号 */
    source?: string;
    /** 是否允许编辑（历史记录里只读） */
    editable?: boolean;
  }>(),
  { source: '', editable: false },
);

const emit = defineEmits<{
  (event: 'remove', ids: string[]): void;
  (event: 'save', items: VocabEntry[]): void;
}>();

const locate = inject(SOURCE_LOCATE, null);

const list = computed(() => props.items ?? []);
const selecting = ref(false);
const picked = ref<string[]>([]);

/** 模型把词典义与文中义写在同一字段：拆成左栏的简短义项与右栏的语境义 */
function splitMeaning(meaning: string): { dict: string; context: string } {
  const raw = (meaning || '').trim();
  if (!raw) return { dict: '', context: '' };
  const paren = raw.match(/[（(]([^）)]*)[）)]/);
  const context = paren ? paren[1].trim() : '';
  const dict = raw
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/^[，,。；;\s]+|[，,。；;\s]+$/g, '')
    .trim();
  const senses = dict
    .split(/[；;]/)
    .map((one) => one.trim())
    .filter(Boolean);
  const brief = senses.length > 2 ? senses.slice(0, 2).join('；') : dict;
  return { dict: brief || dict, context: context || dict };
}

const rows = computed(() =>
  list.value.map((item) => {
    const phrase = phraseAround(props.source, item.term);
    return {
      item,
      phrase: phrase || item.term,
      meaning: splitMeaning(item.meaning ?? ''),
      label: sourceLabel(props.source, item.term, 'term'),
      saved: Boolean(findMyVocab(item.term)),
    };
  }),
);

const allPicked = computed(() => list.value.length > 0 && picked.value.length === list.value.length);

function toggle(id: string) {
  picked.value = picked.value.includes(id)
    ? picked.value.filter((one) => one !== id)
    : [...picked.value, id];
}

function toggleAll() {
  picked.value = allPicked.value ? [] : list.value.map((item) => item.id);
}

function startEdit(id?: string) {
  selecting.value = true;
  picked.value = id ? [id] : [];
}

function finish() {
  selecting.value = false;
  picked.value = [];
}

function saveOne(item: VocabEntry) {
  emit('save', [item]);
}

function savePicked() {
  const chosen = list.value.filter((item) => picked.value.includes(item.id));
  if (chosen.length) emit('save', chosen);
  picked.value = [];
}

/** 头部一次存入全部：省去逐个点 */
function savePickedAll() {
  if (list.value.length) emit('save', [...list.value]);
}

function removePicked() {
  if (!picked.value.length) return;
  emit('remove', [...picked.value]);
  picked.value = [];
  if (!list.value.length) selecting.value = false;
}

function goSource(text: string) {
  const value = text.trim();
  if (value) locate?.(value, 'term');
}

/**
 * 悬停单词即在左栏定位原文。
 * 加一点延迟，避免鼠标划过去时原文来回跳；同一个词不重复触发。
 */
let hoverTimer: number | undefined;
let lastHovered = '';

function hoverTerm(term: string) {
  if (!term || term === lastHovered) return;
  if (hoverTimer) window.clearTimeout(hoverTimer);
  hoverTimer = window.setTimeout(() => {
    lastHovered = term;
    goSource(term);
  }, 160);
}

function leaveTerm() {
  if (hoverTimer) window.clearTimeout(hoverTimer);
}
</script>

<template>
  <div v-if="list.length" class="vc-board">
    <header class="vc-head">
      <h3>重点词汇<span class="vc-count">（{{ list.length }} 个）</span></h3>
      <span v-if="selecting" class="vc-select-hint">已选 {{ picked.length }} 个</span>
    </header>

    <article v-for="row in rows" :key="row.item.id" class="vc-card" :class="{ picked: picked.includes(row.item.id) }">
      <div class="vc-main">
        <div class="vc-lead">
          <h4
            class="vc-term"
            title="悬停可在左侧原文中定位"
            @mouseenter="hoverTerm(row.item.term)"
            @mouseleave="leaveTerm"
          >
            {{ row.item.term }}
          </h4>
          <p v-if="row.item.phonetic" class="vc-ipa">/{{ row.item.phonetic.replace(/^\/|\/$/g, '') }}/</p>
          <span v-if="row.item.pos" class="vc-pos">{{ row.item.pos }}</span>
          <p class="vc-meaning">{{ row.meaning.dict || '—' }}</p>
        </div>

        <div class="vc-body">
          <div v-if="selecting || editable" class="vc-actions">
            <label v-if="selecting" class="vc-check">
              <input
                type="checkbox"
                :checked="picked.includes(row.item.id)"
                :aria-label="`选择 ${row.item.term}`"
                @change="toggle(row.item.id)"
              />
            </label>
            <template v-else>
              <button class="btn btn-ghost btn-sm icon-text" type="button" @click="startEdit(row.item.id)">
                <AppIcon name="edit" :size="12" />编辑
              </button>
              <button
                class="btn btn-ghost btn-sm icon-text vc-save"
                type="button"
                :title="row.saved ? '已在「我的词汇」中，重复保存只会补齐空字段' : '存入我的词汇'"
                @click="saveOne(row.item)"
              >
                <AppIcon :name="row.saved ? 'check' : 'plus'" :size="12" />
                {{ row.saved ? '已存入' : '存入我的词汇' }}
              </button>
            </template>
          </div>

          <dl class="vc-rows">
            <div class="vc-row">
              <dt>原文</dt>
              <dd>
                <button type="button" class="vc-phrase" title="点击在左侧原文中定位" @click="goSource(row.item.term)">
                  {{ row.phrase }}
                </button>
                <button
                  v-if="row.label"
                  type="button"
                  class="vc-locate"
                  @click="goSource(row.item.term)"
                >{{ row.label }} · 定位原文</button>
              </dd>
            </div>
            <div class="vc-row">
              <dt>语境义</dt>
              <dd>{{ row.meaning.context || row.item.meaning || '—' }}</dd>
            </div>
            <div v-if="row.item.usage" class="vc-row">
              <dt>教学用法</dt>
              <dd>{{ row.item.usage }}</dd>
            </div>
          </dl>
        </div>
      </div>
    </article>

    <footer v-if="selecting" class="vc-bulk">
      <button class="link-btn" type="button" @click="toggleAll">{{ allPicked ? '取消全选' : '全选' }}</button>
      <span class="spacer"></span>
      <button class="btn btn-ghost btn-sm" type="button" :disabled="!picked.length" @click="savePicked">
        存入我的词汇{{ picked.length ? `（${picked.length}）` : '' }}
      </button>
      <button class="btn btn-ghost btn-sm danger" type="button" :disabled="!picked.length" @click="removePicked">
        删除{{ picked.length ? `（${picked.length}）` : '' }}
      </button>
      <button class="btn btn-ghost btn-sm" type="button" @click="finish">完成</button>
    </footer>
  </div>

  <div v-else class="block-empty">
    <p class="block-empty-title">本次没有生成重点词汇</p>
    <p class="block-empty-text">可点顶部「重新解析」再试一次。</p>
  </div>
</template>
