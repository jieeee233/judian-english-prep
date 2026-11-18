<script setup lang="ts">
import { inject, ref } from 'vue';
import { locateInSource, markTerm, type SourceHit } from '../../utils/locate';
import { SOURCE_LOCATE } from '../../utils/sourceLocate';

const props = withDefaults(
  defineProps<{
    term: string;
    source: string;
    /** 句子里显示原文定位；表格里显示可悬停的词条 */
    mode?: 'inline' | 'cell';
  }>(),
  { mode: 'inline' },
);

const locateSource = inject(SOURCE_LOCATE, null);

const visible = ref(false);
const hits = ref<SourceHit[]>([]);
const style = ref<Record<string, string>>({});
let timer: number | undefined;

function open(event: MouseEvent) {
  window.clearTimeout(timer);
  // 先让左侧原文跳到命中处，再弹浮层说明
  locateSource?.(props.term, 'term');
  const found = locateInSource(props.source, props.term);
  hits.value = found;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const width = 360;
  const left = Math.min(Math.max(rect.left - 24, 12), window.innerWidth - width - 12);
  const below = rect.bottom + 8;
  const top = below + 220 > window.innerHeight ? Math.max(rect.top - 216, 12) : below;
  style.value = { left: `${left}px`, top: `${top}px`, width: `${width}px` };
  visible.value = true;
}

function close() {
  timer = window.setTimeout(() => {
    visible.value = false;
  }, 120);
}

function keep() {
  window.clearTimeout(timer);
}
</script>

<template>
  <span
    class="term-anchor"
    :class="{ 'is-cell': mode === 'cell' }"
    tabindex="0"
    @mouseenter="open"
    @mouseleave="close"
    @focus="open"
    @blur="close"
  >
    <slot>{{ term }}</slot>
  </span>

  <Teleport to="body">
    <div v-if="visible" class="locate-tip" :style="style" @mouseenter="keep" @mouseleave="close" role="tooltip">
      <p class="locate-head">
        <span class="locate-term">{{ term }}</span>
        <span v-if="hits.length" class="locate-meta">{{ hits.length }} 处</span>
        <span v-else class="locate-meta miss">原文未直接出现</span>
      </p>
      <div v-if="hits.length" class="locate-body">
        <p v-for="(hit, index) in hits" :key="index" class="locate-line">
          <span class="locate-para">第 {{ hit.paragraph }} 段</span>
          <span class="locate-text">
            <template v-for="(chunk, i) in markTerm(hit.sentence, term)" :key="i">
              <mark v-if="chunk.hit">{{ chunk.text }}</mark>
              <template v-else>{{ chunk.text }}</template>
            </template>
          </span>
        </p>
      </div>
      <p v-else class="locate-empty">
        该表达可能以变形或短语形式出现。请在左侧原文中手动搜索，或核对模型给出的词形。
      </p>
    </div>
  </Teleport>
</template>
