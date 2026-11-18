<script setup lang="ts">
/**
 * 线性图标集：统一 24 视框、圆头描边，颜色跟随 currentColor。
 * 只用图标表达动作时，务必在按钮上补 title/aria-label。
 */
withDefaults(defineProps<{ name: string; size?: number; stroke?: number }>(), {
  size: 16,
  stroke: 1.7,
});

type Shape = { paths: string[]; fill?: boolean };

const ICONS: Record<string, Shape> = {
  'question-list': { paths: ['M4 6h3v3H4z', 'M4 15h3v3H4z', 'M11 7.5h9', 'M11 16.5h9'] },
  paperclip: {
    paths: [
      'M20.6 11.2l-8.3 8.3a5.2 5.2 0 0 1-7.4-7.4l8.1-8.1a3.5 3.5 0 0 1 4.9 4.9l-7.9 7.9a1.75 1.75 0 0 1-2.5-2.5l7.2-7.2',
    ],
  },
  trash: {
    paths: ['M4 7h16', 'M9.2 7V4.6h5.6V7', 'M6.6 7l.9 12.4h9l.9-12.4', 'M10.2 10.6v5.6', 'M13.8 10.6v5.6'],
  },
  play: { paths: ['M8.2 5.2l10.6 6.8-10.6 6.8z'], fill: true },
  copy: {
    paths: [
      'M11 9h7.5A2.5 2.5 0 0 1 21 11.5V19a2.5 2.5 0 0 1-2.5 2.5H11A2.5 2.5 0 0 1 8.5 19v-7.5A2.5 2.5 0 0 1 11 9z',
      'M15.5 6.2V5A2 2 0 0 0 13.5 3h-8A2 2 0 0 0 3.5 5v8a2 2 0 0 0 2 2h1.2',
    ],
  },
  search: { paths: ['M10.8 4.2a6.6 6.6 0 1 1 0 13.2 6.6 6.6 0 0 1 0-13.2z', 'M15.6 15.6L20.5 20.5'] },
  plus: { paths: ['M12 5.2v13.6', 'M5.2 12h13.6'] },
  minus: { paths: ['M5.2 12h13.6'] },
  'chevron-down': { paths: ['M6.4 9.4l5.6 5.6 5.6-5.6'] },
  'chevron-right': { paths: ['M9.4 6.4l5.6 5.6-5.6 5.6'] },
  more: { paths: ['M6.2 12h.01', 'M12 12h.01', 'M17.8 12h.01'] },
  close: { paths: ['M6.2 6.2l11.6 11.6', 'M17.8 6.2L6.2 17.8'] },
  'arrow-left': { paths: ['M19 12H5.2', 'M11.2 5.6L5 12l6.2 6.4'] },
  shield: { paths: ['M12 21c4.4-2 7.4-5.2 7.4-9.3V6.2L12 3 4.6 6.2v5.5C4.6 15.8 7.6 19 12 21z'] },
  download: { paths: ['M12 4v10.2', 'M8 11l4 4 4-4', 'M5 19.4h14'] },
  file: {
    paths: [
      'M13.6 3.2H7.4a2 2 0 0 0-2 2v13.6a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8.4z',
      'M13.6 3.2v5.2h5.2',
      'M9 13h6',
      'M9 16.6h3.6',
    ],
  },
  word: {
    paths: [
      'M13.6 3.2H7.4a2 2 0 0 0-2 2v13.6a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8.4z',
      'M13.6 3.2v5.2h5.2',
      'M8.2 12l1.2 4.6 1.4-3.2 1.4 3.2L13.4 12',
    ],
  },
  markdown: { paths: ['M8.6 8.4L4.8 12l3.8 3.6', 'M15.4 8.4L19.2 12l-3.8 3.6', 'M13.4 7.2l-2.8 9.6'] },
  check: { paths: ['M5.2 12.4l4.4 4.4L18.8 7.4'] },
  edit: { paths: ['M4 20h4.2L19.4 8.8a2.1 2.1 0 0 0-3-3L5.2 17 4 20z', 'M14.6 6.6l3 3'] },
  refresh: { paths: ['M20 12a8 8 0 1 1-2.4-5.7', 'M20.2 4.2v4.4h-4.4'] },
  folder: { paths: ['M3.2 7.6a2 2 0 0 1 2-2h3.4l2 2.6h6.2a2 2 0 0 1 2 2v7.2a2 2 0 0 1-2 2H5.2a2 2 0 0 1-2-2z'] },
  info: { paths: ['M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z', 'M12 11v5.4', 'M12 7.8h.01'] },
  book: {
    paths: [
      'M4 5.4A2 2 0 0 1 6 3.4h5v16.4H6a2 2 0 0 0-2 2z',
      'M20 5.4a2 2 0 0 0-2-2h-5v16.4h5a2 2 0 0 1 2 2z',
    ],
  },
  sparkles: {
    paths: [
      'M11.4 3.4l1.7 4.3 4.3 1.7-4.3 1.7-1.7 4.3-1.7-4.3L5.4 9.4l4.3-1.7z',
      'M18.2 14.6l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z',
    ],
  },
  /** 四角展开：专注备课（收起全局导航） */
  expand: { paths: ['M9.4 4.2H4.2v5.2', 'M14.6 4.2h5.2v5.2', 'M19.8 14.6v5.2h-5.2', 'M4.2 14.6v5.2h5.2'] },
  collapse: { paths: ['M4.2 9.4h5.2V4.2', 'M19.8 9.4h-5.2V4.2', 'M14.6 19.8v-5.2h5.2', 'M9.4 19.8v-5.2H4.2'] },
  image: {
    paths: [
      'M4.8 4.6h14.4a1.8 1.8 0 0 1 1.8 1.8v11.2a1.8 1.8 0 0 1-1.8 1.8H4.8A1.8 1.8 0 0 1 3 17.6V6.4a1.8 1.8 0 0 1 1.8-1.8z',
      'M3.4 16.4l4.9-4.4 3.5 3.1 3-2.6 5.8 4.7',
      'M15.4 8.6h.01',
    ],
  },
};

function shapes(name: string): Shape {
  return ICONS[name] ?? ICONS.info;
}
</script>

<template>
  <svg
    class="app-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    :fill="shapes(name).fill ? 'currentColor' : 'none'"
    :stroke="shapes(name).fill ? 'none' : 'currentColor'"
    :stroke-width="stroke"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="(d, index) in shapes(name).paths" :key="index" :d="d" />
  </svg>
</template>
