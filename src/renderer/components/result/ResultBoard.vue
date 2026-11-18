<script setup lang="ts">
import { computed } from 'vue';
import { BLOCK_TITLES, RESULT_TABS, type AnalysisBlock, type ExerciseDifficulty, type ResultTab } from '../../../shared/constants';
import type { AnalysisPayload, ExerciseSet, VocabEntry } from '../../../shared/types';
import { store } from '../../store';
import DiscourseBlock from './DiscourseBlock.vue';
import PracticeBlock from './PracticeBlock.vue';
import QuestionsBlock from './QuestionsBlock.vue';
import SentencesBlock from './SentencesBlock.vue';
import VocabBlock from './VocabBlock.vue';

const props = defineProps<{
  payload: AnalysisPayload;
  missing?: AnalysisBlock[];
  interactivePractice?: boolean;
  difficulty: ExerciseDifficulty;
  practiceStatus: 'idle' | 'generating' | 'done' | 'error';
  practiceError: string;
  practiceStage?: string;
  /** 原文正文，供「P2 · 定位原文」与悬停定位使用 */
  source?: string;
  /** 允许编辑重点词汇（历史记录只读） */
  vocabEditable?: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:difficulty', value: ExerciseDifficulty): void;
  (event: 'generate'): void;
  (event: 'removeVocab', ids: string[]): void;
  (event: 'saveVocab', items: VocabEntry[]): void;
}>();

const counts = computed(() => ({
  discourse: props.payload.discourse ? 1 : 0,
  questions: props.payload.questions?.length ?? 0,
  vocab: props.payload.vocab?.length ?? 0,
  sentences: props.payload.sentences?.length ?? 0,
  exercise: props.payload.exercise?.items.length ?? 0,
}));

function isMissing(key: ResultTab): boolean {
  if (key === 'exercise') return false;
  return (props.missing ?? []).includes(key as AnalysisBlock);
}

/**
 * 页签只认 store 一份状态：切到单词本再回来仍停在刚才那一页，
 * 也不会因为出练习把结果对象换新而跳页。
 */
const tab = computed<ResultTab>({
  get: () => store.resultTab,
  set: (value) => {
    store.resultTab = value;
  },
});

const exercise = computed<ExerciseSet | null>(() => props.payload.exercise ?? null);
</script>

<template>
  <nav class="result-tabs" role="tablist" aria-label="解析结果板块">
    <button
      v-for="key in RESULT_TABS"
      :key="key"
      type="button"
      role="tab"
      class="result-tab"
      :class="{ active: tab === key, missing: isMissing(key) }"
      :aria-selected="tab === key"
      :title="isMissing(key) ? '本次没有拿到这一板块，可在顶部重新解析' : undefined"
      @click="tab = key"
    >
      {{ BLOCK_TITLES[key] }}
    </button>
  </nav>

  <div class="result-body">
    <DiscourseBlock v-if="tab === 'discourse'" :note="payload.discourse" />
    <QuestionsBlock v-else-if="tab === 'questions'" :items="payload.questions" :source="source ?? ''" />
    <VocabBlock
      v-else-if="tab === 'vocab'"
      :items="payload.vocab"
      :source="source ?? ''"
      :editable="Boolean(vocabEditable)"
      @remove="emit('removeVocab', $event)"
      @save="emit('saveVocab', $event)"
    />
    <SentencesBlock v-else-if="tab === 'sentences'" :items="payload.sentences" :source="source ?? ''" />
    <PracticeBlock
      v-else
      :exercise="exercise"
      :difficulty="difficulty"
      :status="practiceStatus"
      :error="practiceError"
      :stage="practiceStage ?? ''"
      :vocab-count="counts.vocab"
      :sentence-count="counts.sentences"
      :source="source ?? ''"
      :interactive="Boolean(interactivePractice)"
      @update:difficulty="emit('update:difficulty', $event)"
      @generate="emit('generate')"
    />
  </div>
</template>
