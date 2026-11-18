<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { DIFFICULTY_UI_LABEL, EXERCISE_DIFFICULTIES, type ExerciseDifficulty } from '../../../shared/constants';
import { formatDateTime } from '../../../shared/format';
import type { ExerciseSet } from '../../../shared/types';
import AppIcon from '../AppIcon.vue';

const props = defineProps<{
  exercise?: ExerciseSet | null;
  difficulty: ExerciseDifficulty;
  status: 'idle' | 'generating' | 'done' | 'error';
  error: string;
  stage?: string;
  source?: string;
  vocabCount: number;
  sentenceCount: number;
  interactive: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:difficulty', value: ExerciseDifficulty): void;
  (event: 'generate'): void;
}>();

/** 首屏先露两道，其余折起来：题目多时不用滚很久才能看到标题 */
const FIRST_SCREEN = 2;

const targetTotal = computed(() => props.vocabCount + props.sentenceCount);
const generating = computed(() => props.status === 'generating');
const canGenerate = computed(() => props.interactive && !generating.value && targetTotal.value > 0);

const items = computed(() => props.exercise?.items ?? []);
const showAll = ref(false);
const revealed = ref<number[]>([]);

const visible = computed(() => (showAll.value ? items.value : items.value.slice(0, FIRST_SCREEN)));
const restCount = computed(() => Math.max(0, items.value.length - visible.value.length));

const meta = computed(() => {
  const set = props.exercise;
  if (!set) return '';
  return `难度${DIFFICULTY_UI_LABEL[set.difficulty]} · 生成于 ${formatDateTime(set.completedAt)}`;
});

watch(
  () => props.exercise?.completedAt,
  () => {
    showAll.value = false;
    revealed.value = [];
  },
);

function toggle(id: string) {
  revealed.value = revealed.value.includes(id)
    ? revealed.value.filter((one) => one !== id)
    : [...revealed.value, id];
}
</script>

<template>
  <div class="pr-board">
    <div v-if="interactive" class="pr-bar">
      <span class="pr-bar-label">练习难度：</span>
      <div class="pr-levels" role="radiogroup" aria-label="练习难度">
        <label v-for="level in EXERCISE_DIFFICULTIES" :key="level" :class="{ selected: difficulty === level }">
          <input
            type="radio"
            name="difficulty"
            :value="level"
            :checked="difficulty === level"
            :disabled="generating"
            @change="emit('update:difficulty', level)"
          />
          {{ DIFFICULTY_UI_LABEL[level] }}
        </label>
      </div>
      <button
        class="btn btn-primary btn-sm"
        type="button"
        :disabled="!canGenerate"
        @click="emit('generate')"
      >
        {{ generating ? '生成中…' : items.length ? '重新生成' : '生成练习' }}
      </button>
    </div>
    <p v-else class="pr-hint readonly">在「文章解析」页生成练习。</p>

    <p v-if="!targetTotal && interactive" class="pr-hint warn">当前没有可用的重点词汇或长难句，请先完成解析。</p>

    <div v-if="error" class="alert error pr-alert" role="alert">
      <span aria-hidden="true">!</span>
      <span>{{ error }}</span>
    </div>

    <div v-if="generating" class="pr-loading" role="status">
      <div class="pulse-bar" aria-hidden="true"><span></span></div>
      <p class="field-hint">{{ stage || '正在生成练习…' }}</p>
    </div>

    <template v-else-if="items.length">
      <header class="pr-head">
        <h3>示例练习 <span>· 共 {{ items.length }} 题</span></h3>
        <span class="pr-meta">{{ meta }}</span>
      </header>

      <p v-for="note in exercise?.issues ?? []" :key="note" class="pr-issue">{{ note }}</p>

      <article v-for="(item, index) in visible" :key="item.id" class="pr-item">
        <span class="pr-no">{{ String(index + 1).padStart(2, '0') }}</span>
        <div class="pr-main">
          <h4 class="pr-title">
            {{ item.kind || '练习' }}
            <span v-if="item.target"> · {{ item.target }}</span>
          </h4>
          <p class="pr-prompt">{{ item.prompt }}</p>

          <div class="pr-answer" :class="{ open: revealed.includes(item.id) }">
            <button type="button" class="pr-toggle" @click="toggle(item.id)">
              <AppIcon name="chevron-right" :size="13" />
              参考答案
            </button>
            <div v-if="revealed.includes(item.id)" class="pr-answer-body">
              <p class="pr-answer-text">{{ item.answer || '—' }}</p>
              <p v-if="item.explain" class="pr-explain">
                <b>简要说明</b>
                {{ item.explain }}
              </p>
            </div>
          </div>
        </div>
      </article>

      <button v-if="restCount" type="button" class="pr-more" @click="showAll = true">
        下方还有 {{ restCount }} 题
        <AppIcon name="chevron-down" :size="13" />
      </button>
    </template>

    <div v-else class="block-empty">
      <p class="block-empty-title">还没有练习</p>
      <p class="block-empty-text">选好难度后点「生成练习」。</p>
    </div>
  </div>
</template>
