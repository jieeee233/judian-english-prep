<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { VocabPracticeItem } from '../../../shared/types';
import AppIcon from '../AppIcon.vue';
import type { PracticeRow } from './practiceRow';

const props = defineProps<{
  title: string;
  subtitle: string;
  rows: PracticeRow[];
  busy: boolean;
  /** 生成时选的题型（不能叫 style，会和 HTML 的 style 属性撞车） */
  examStyle: 'choice' | 'grammar' | 'mixed' | '';
}>();

const emit = defineEmits<{
  (event: 'close'): void;
  (event: 'update', key: string, exercises: VocabPracticeItem[]): void;
  (event: 'reset', key: string): void;
  (event: 'generate', keys: string[], style: 'choice' | 'grammar' | 'mixed', count: number): void;
  (event: 'pick', value: 'choice' | 'grammar' | 'mixed'): void;
}>();

/** 右侧正在查看的词 */
const currentKey = ref('');
/** 左侧待生成的勾选，默认全不选 */
const picked = ref<string[]>([]);
/** 只看有题 / 无题 */
const filter = ref<'all' | 'has' | 'none'>('all');
/** 每词生成几道题 */
const countValue = ref(2);
/** 课堂展示时可以一键收起答案与解析 */
const showAnswer = ref(true);

const visibleRows = computed(() => {
  if (filter.value === 'has') return props.rows.filter((row) => row.exercises.length > 0);
  if (filter.value === 'none') return props.rows.filter((row) => !row.exercises.length);
  return props.rows;
});

// 切换筛选后当前查看词可能被过滤掉，自动落到第一条
watch(
  visibleRows,
  (rows) => {
    if (!rows.some((row) => row.key === currentKey.value)) currentKey.value = rows[0]?.key ?? '';
  },
  { immediate: true },
);

const currentRow = computed(() => visibleRows.value.find((row) => row.key === currentKey.value) ?? null);

const withExercise = computed(() => props.rows.filter((row) => row.exercises.length).length);
const totalExercises = computed(() => props.rows.reduce((sum, row) => sum + row.exercises.length, 0));

const pickedCount = computed(() => picked.value.length);
const allPicked = computed(
  () => visibleRows.value.length > 0 && picked.value.length === visibleRows.value.length,
);

const practiceCount = computed(() => Math.min(4, Math.max(1, countValue.value)));

function isPicked(key: string): boolean {
  return picked.value.includes(key);
}

function togglePick(key: string) {
  picked.value = isPicked(key)
    ? picked.value.filter((item) => item !== key)
    : [...picked.value, key];
}

function togglePickAll() {
  picked.value = allPicked.value ? [] : visibleRows.value.map((row) => row.key);
}

function select(key: string) {
  currentKey.value = key;
  editingKey.value = '';
}

function bumpCount(delta: number) {
  countValue.value = Math.min(4, Math.max(1, practiceCount.value + delta));
}

function runGenerate() {
  if (!picked.value.length || !props.examStyle || props.busy) return;
  emit('generate', [...picked.value], props.examStyle, practiceCount.value);
}

function setStyle(value: string) {
  emit('pick', value as 'choice' | 'grammar' | 'mixed');
}

/* --------------------------- 单题编辑 --------------------------- */

interface DraftItem {
  index: number;
  type: string;
  point: string;
  stem: string;
  answer: string;
  hint: string;
  explanation: string;
  options: string[];
}

const draft = reactive<DraftItem>({
  index: -1,
  type: 'grammar',
  point: '',
  stem: '',
  answer: '',
  hint: '',
  explanation: '',
  options: [],
});
const editingKey = ref('');

/** 题目右上角「⋯」菜单只同时开一个 */
function toggleMenu(key: string, index: number) {
  const id = `${key}#menu${index}`;
  editingKey.value = editingKey.value === id ? '' : id;
}

function menuOpen(key: string, index: number): boolean {
  return editingKey.value === `${key}#menu${index}`;
}

function newItem(seed: string): VocabPracticeItem {
  return {
    id: `${seed}-${Date.now().toString(36)}`,
    type: 'grammar',
    point: '',
    stem: '',
    answer: '',
    hint: '',
    explanation: '',
    options: [],
  };
}

function beginEdit(row: PracticeRow, index: number) {
  const item = row.exercises[index];
  draft.index = index;
  draft.type = item.type;
  draft.point = item.point;
  draft.stem = item.stem;
  draft.answer = item.answer;
  draft.hint = item.hint;
  draft.explanation = item.explanation;
  draft.options = item.options.length ? [...item.options] : ['', '', '', ''];
  editingKey.value = `${row.key}#${index}`;
  showAnswer.value = true;
}

function beginAdd(row: PracticeRow) {
  const item = newItem(`${row.key}-new`);
  const next = [...row.exercises, item];
  emit('update', row.key, next);
  beginEdit({ ...row, exercises: next }, next.length - 1);
}

function cancelEdit() {
  editingKey.value = '';
  draft.index = -1;
}

function saveEdit(row: PracticeRow) {
  const stem = draft.stem.trim();
  const answer = draft.answer.trim();
  if (!stem || !answer) return;
  const isChoice = draft.type === 'choice';
  const options = isChoice
    ? draft.options.map((item) => item.trim()).filter(Boolean)
    : [];
  if (isChoice && (options.length < 3 || !options.some((opt) => opt.toLowerCase() === answer.toLowerCase()))) {
    return;
  }
  const item: VocabPracticeItem = {
    id: row.exercises[draft.index]?.id ?? `${row.key}-edited`,
    type: draft.type,
    point: draft.point.trim(),
    stem,
    answer: isChoice ? options.find((opt) => opt.toLowerCase() === answer.toLowerCase()) ?? answer : answer,
    hint: isChoice ? '' : draft.hint.trim(),
    explanation: draft.explanation.trim(),
    options,
  };
  const next = row.exercises.map((old, index) => (index === draft.index ? item : old));
  emit('update', row.key, next);
  cancelEdit();
}

function removeItem(row: PracticeRow, index: number) {
  const next = row.exercises.filter((_, i) => i !== index);
  emit('update', row.key, next);
  if (editingKey.value === `${row.key}#${index}`) cancelEdit();
}

function isEditing(key: string, index: number): boolean {
  return editingKey.value === `${key}#${index}`;
}

function typeLabel(type: string): string {
  if (type === 'choice') return '选择';
  if (type === 'grammar') return '语法填空';
  if (type === 'form') return '词形';
  if (type === 'prep') return '介词';
  return type || '练习';
}

function pad(index: number): string {
  return String(index + 1).padStart(2, '0');
}
</script>

<template>
  <section class="panel practice-panel" aria-label="词汇练习">
    <div class="panel-head">
      <div class="panel-head-left">
        <span class="step" aria-hidden="true">Q</span>
        <h2 class="panel-title">
          {{ title }}
          <span class="panel-title-sep">·</span>
          {{ subtitle }}
        </h2>
      </div>
      <div class="panel-head-right">
        <span class="counter">
          {{ rows.length }} 词 · {{ withExercise }} 词有题 · 共 {{ totalExercises }} 题
        </span>
      </div>
    </div>

    <div class="practice-split">
      <aside class="practice-side" aria-label="词条目录">
        <div class="seg seg-block" role="group" aria-label="筛选词条">
          <button
            type="button"
            class="seg-btn"
            :class="{ active: filter === 'all' }"
            @click="filter = 'all'"
          >
            全部 {{ rows.length }}
          </button>
          <button
            type="button"
            class="seg-btn"
            :class="{ active: filter === 'has' }"
            @click="filter = 'has'"
          >
            有题 {{ withExercise }}
          </button>
          <button
            type="button"
            class="seg-btn"
            :class="{ active: filter === 'none' }"
            @click="filter = 'none'"
          >
            无题 {{ rows.length - withExercise }}
          </button>
        </div>

        <label class="side-check">
          <input type="checkbox" :checked="allPicked" aria-label="全选可见词条" @change="togglePickAll" />
          <span>全选</span>
          <span class="side-count">已选 <b>{{ pickedCount }}</b> / {{ visibleRows.length }}</span>
        </label>

        <div class="side-field">
          <span class="side-label">题型</span>
          <div class="type-field">
            <AppIcon name="question-list" :size="16" aria-hidden="true" />
            <select
              class="vb-select side-select"
              :value="examStyle"
              aria-label="选择题型"
              @change="setStyle(($event.target as HTMLSelectElement).value)"
            >
              <option value="" disabled hidden>选择题型</option>
              <option value="choice">选择题</option>
              <option value="grammar">填空题</option>
              <option value="mixed">混合生成</option>
            </select>
          </div>
        </div>

        <div class="side-field">
          <span class="side-label">每词</span>
          <div class="stepper">
            <button
              type="button"
              class="stepper-btn"
              :disabled="practiceCount <= 1"
              aria-label="减少每词题数"
              @click="bumpCount(-1)"
            >
              <AppIcon name="minus" :size="12" />
            </button>
            <b class="stepper-value">{{ practiceCount }}</b>
            <button
              type="button"
              class="stepper-btn"
              :disabled="practiceCount >= 4"
              aria-label="增加每词题数"
              @click="bumpCount(1)"
            >
              <AppIcon name="plus" :size="12" />
            </button>
            <span class="stepper-unit">题</span>
          </div>
        </div>

        <button
          class="btn btn-primary btn-sm gen-btn"
          type="button"
          :disabled="!pickedCount || !examStyle || busy"
          :title="!examStyle ? '请先选择题型' : pickedCount ? '只为勾选的词重新生成练习' : '先在下面勾选要生成的词'"
          @click="runGenerate"
        >
          {{ busy ? '生成中…' : '生成练习' }}
        </button>

        <div class="side-list">
          <div class="side-list-head">
            <span aria-hidden="true"></span>
            <span class="side-order">序号</span>
            <span class="side-word">单词</span>
            <span class="side-badge-col">题目数量</span>
          </div>
          <button
            v-for="row in visibleRows"
            :key="row.key"
            type="button"
            class="side-row"
            :class="{ current: row.key === currentKey }"
            @click="select(row.key)"
          >
            <span class="side-pick" @click.stop>
              <input
                type="checkbox"
                :checked="isPicked(row.key)"
                :aria-label="`选择 ${row.word}`"
                @change="togglePick(row.key)"
              />
            </span>
            <span class="side-order">{{ row.order }}</span>
            <span class="side-word">{{ row.word }}</span>
            <span class="side-badge" :class="{ empty: !row.exercises.length }">
              {{ row.exercises.length ? `${row.exercises.length} 题` : '暂无' }}
            </span>
          </button>
          <p v-if="!visibleRows.length" class="side-empty">
            {{ filter === 'none' ? '每个词都有练习了。' : filter === 'has' ? '还没有任何练习。' : '暂无词条。' }}
          </p>
        </div>
      </aside>

      <div class="practice-main">
        <template v-if="currentRow">
          <header class="word-head">
            <div class="word-head-main">
              <h3 class="word-title">{{ currentRow.word }}</h3>
              <span v-if="currentRow.pos" class="vocab-pos">{{ currentRow.pos }}</span>
              <span class="word-meaning">{{ currentRow.meaning }}</span>
              <span class="word-count">{{ currentRow.exercises.length }} 题</span>
            </div>
            <label class="answer-toggle" title="课堂展示时可以收起答案与解析">
              <input v-model="showAnswer" type="checkbox" />
              <span>显示答案</span>
            </label>
          </header>

          <p v-if="currentRow.collocations.length" class="colloc-chips">
            <span v-for="item in currentRow.collocations" :key="item.pattern" class="colloc-chip">
              {{ item.pattern }}
              <em v-if="item.meaning">{{ item.meaning }}</em>
            </span>
          </p>

          <div class="practice-main-scroll">
            <article v-for="(item, index) in currentRow.exercises" :key="item.id" class="ex-card">
              <template v-if="isEditing(currentRow.key, index)">
                <div class="ex-edit">
                  <textarea v-model="draft.stem" class="textarea ex-input" rows="2" placeholder="题干（空格用 ______）"></textarea>
                  <div v-if="draft.type === 'choice'" class="ex-options">
                    <label v-for="(opt, oi) in draft.options" :key="oi" class="ex-option">
                      <input v-model="draft.answer" type="radio" :value="opt" />
                      <input v-model="draft.options[oi]" class="input input-mini" :placeholder="`选项 ${oi + 1}`" />
                    </label>
                  </div>
                  <div v-else class="ex-row">
                    <label class="ex-field">
                      <span>答案</span>
                      <input v-model="draft.answer" class="input input-mini" />
                    </label>
                    <label class="ex-field">
                      <span>提示词</span>
                      <input v-model="draft.hint" class="input input-mini" placeholder="如 curious" />
                    </label>
                  </div>
                  <input v-model="draft.explanation" class="input input-mini ex-explain" placeholder="解析（可选）" />
                  <div class="ex-actions">
                    <button class="btn btn-primary btn-sm" type="button" @click="saveEdit(currentRow)">保存</button>
                    <button class="btn btn-ghost btn-sm" type="button" @click="cancelEdit">取消</button>
                    <span class="spacer"></span>
                    <button class="link-btn danger" type="button" @click="removeItem(currentRow, index)">删除本题</button>
                  </div>
                </div>
              </template>
              <template v-else>
                <header class="ex-head">
                  <span class="ex-no" aria-hidden="true">{{ pad(index) }}</span>
                  <span class="ex-tag" :class="`ex-tag-${item.type}`">{{ typeLabel(item.type) }}</span>
                  <span v-if="item.point && !item.point.startsWith(typeLabel(item.type))" class="ex-point">
                    {{ item.point }}
                  </span>
                  <span class="spacer"></span>
                  <button class="btn btn-ghost btn-sm" type="button" @click="beginEdit(currentRow, index)">
                    编辑
                  </button>
                  <span class="row-more">
                    <button
                      class="icon-btn"
                      type="button"
                      :aria-label="`第 ${index + 1} 题更多操作`"
                      @click.stop="toggleMenu(currentRow.key, index)"
                    >
                      <AppIcon name="more" :size="16" />
                    </button>
                    <div
                      v-if="menuOpen(currentRow.key, index)"
                      class="row-menu"
                      :class="{ up: index >= currentRow.exercises.length - 1 }"
                      role="menu"
                    >
                      <button type="button" role="menuitem" class="danger" @click.stop="removeItem(currentRow, index)">
                        <AppIcon name="trash" :size="13" />
                        删除本题
                      </button>
                    </div>
                  </span>
                </header>
                <p class="ex-stem">{{ item.stem }}</p>
                <p v-if="item.options.length" class="ex-opts">
                  <span v-for="opt in item.options" :key="opt" class="ex-opt">{{ opt }}</span>
                </p>
                <div v-if="showAnswer" class="ex-answer-block">
                  <p class="ex-answer">
                    答案：<b>{{ item.answer }}</b>
                    <span v-if="item.hint" class="ex-hint">（提示 {{ item.hint }}）</span>
                  </p>
                  <p v-if="item.explanation" class="ex-note">解析：{{ item.explanation }}</p>
                </div>
                <button v-else class="ex-reveal" type="button" @click="showAnswer = true">
                  答案已隐藏 · 点此显示
                </button>
              </template>
            </article>

            <div v-if="!currentRow.exercises.length" class="empty ex-empty">
              <p>这个词暂时没有练习题，可以手动加一题，或勾选后让 AI 生成。</p>
            </div>
          </div>

          <footer class="practice-main-foot">
            <button class="btn btn-primary btn-sm icon-text" type="button" @click="beginAdd(currentRow)">
              <AppIcon name="plus" :size="13" />
              手动加一题
            </button>
            <button
              v-if="currentRow.builtin"
              class="btn btn-ghost btn-sm icon-text"
              type="button"
              title="用教材原题替换本机修改"
              @click="emit('reset', currentRow.key)"
            >
              <AppIcon name="refresh" :size="13" />
              恢复教材默认
            </button>
            <span class="spacer"></span>
            <span class="field-hint">勾选左侧词条后点「生成练习」，只覆盖勾选的词。</span>
          </footer>
        </template>

        <div v-else class="empty practice-empty">
          <span class="empty-mark" aria-hidden="true">Q</span>
          <p>左侧还没有可查看的词条，换个筛选条件试试。</p>
        </div>
      </div>
    </div>
  </section>
</template>
