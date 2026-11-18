<script setup lang="ts">
/**
 * 批量操作栏：紧贴表格上方的一条固定栏。
 * 左侧勾选框刻意与表格第一列（勾选列）对齐，下面是「全选 + 已选数量」，
 * 右侧依次是插槽里的额外选项、「取消」「生成」。
 */
withDefaults(
  defineProps<{
    all: boolean;
    count: number;
    total: number;
    okLabel: string;
    cancelLabel?: string;
    cancelTitle?: string;
    /** 不需要「取消」时（如练习题生成，取消无实际作用）可以关掉 */
    showCancel?: boolean;
    okDisabled?: boolean;
    busy?: boolean;
    /** 删除这类不可逆操作用红色实心按钮 */
    tone?: 'primary' | 'danger';
  }>(),
  { cancelLabel: '取消', cancelTitle: '', showCancel: true, okDisabled: false, busy: false, tone: 'primary' },
);

const emit = defineEmits<{
  (event: 'toggle-all'): void;
  (event: 'cancel'): void;
  (event: 'confirm'): void;
}>();
</script>

<template>
  <div class="bulkbar">
    <label class="bulk-all" @click.prevent="emit('toggle-all')">
      <span class="bulk-check">
        <input type="checkbox" :checked="all" :aria-label="all ? '取消全选' : '全选本页'" />
      </span>
      <span class="bulk-label">{{ all ? '取消全选' : '全选' }}</span>
    </label>
    <span class="bulk-count">
      已选 <b>{{ count }}</b> / {{ total }}
    </span>
    <span class="spacer"></span>
    <slot></slot>
    <slot name="before-cancel"></slot>
    <button
      v-if="showCancel"
      class="btn btn-ghost btn-sm"
      type="button"
      :title="cancelTitle"
      @click="emit('cancel')"
    >
      {{ cancelLabel }}
    </button>
    <button
      class="btn btn-sm"
      :class="tone === 'danger' ? 'btn-danger' : 'btn-primary'"
      type="button"
      :disabled="okDisabled || busy"
      @click="emit('confirm')"
    >
      {{ busy ? '处理中…' : okLabel }}
    </button>
  </div>
</template>
