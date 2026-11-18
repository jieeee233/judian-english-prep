import type { InjectionKey } from 'vue';

/** 定位类型：单词/短语按词边界找，长难句按整句找 */
export type SourceLocateKind = 'term' | 'quote';

/**
 * 解析页提供给结果面板的定位能力：
 * 悬停重点词汇或长难句时，把命中位置回传到左侧原文框并高亮 + 滚动。
 */
export type SourceLocate = (text: string, kind: SourceLocateKind) => void;

export const SOURCE_LOCATE: InjectionKey<SourceLocate> = Symbol('source-locate');
