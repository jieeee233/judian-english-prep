<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';

const props = defineProps<{
  value: string;
  /** 逐条搭配（带中文含义）；显示时分行，编辑时仍按 value 汇总成一行 */
  entries?: Array<{ pattern: string; meaning: string }>;
  hint?: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ (event: 'save', text: string): void }>();

const editing = ref(false);
const draft = ref('');
const input = ref<HTMLInputElement | null>(null);

async function start() {
  if (props.disabled) return;
  draft.value = props.value;
  editing.value = true;
  await nextTick();
  input.value?.focus();
  input.value?.select();
}

function commit() {
  if (!editing.value) return;
  editing.value = false;
  const text = draft.value.trim();
  if (text !== props.value.trim()) emit('save', text);
}

function cancel() {
  editing.value = false;
}

watch(
  () => props.value,
  (value) => {
    if (!editing.value) draft.value = value;
  },
);
</script>

<template>
  <input
    v-if="editing"
    ref="input"
    v-model="draft"
    class="input input-mini colloc-input"
    maxlength="120"
    placeholder="英文搭配 + 中文释义"
    @keydown.enter.prevent="commit"
    @keydown.esc.prevent="cancel"
    @blur="commit"
  />
  <button
    v-else
    type="button"
    class="colloc-cell"
    :class="{ 'is-empty': !value }"
    :disabled="disabled"
    :title="hint || (value ? '点击修改这条搭配' : '点击手动填写搭配')"
    @click="start"
  >
    <template v-if="entries && entries.length">
      <span v-for="(item, index) in entries" :key="index" class="colloc-line">
        <span class="colloc-pattern">{{ item.pattern }}</span>
        <span v-if="item.meaning" class="colloc-meaning">{{ item.meaning }}</span>
      </span>
    </template>
    <span v-else-if="value">{{ value }}</span>
    <span v-else class="colloc-dash">—</span>
  </button>
</template>
