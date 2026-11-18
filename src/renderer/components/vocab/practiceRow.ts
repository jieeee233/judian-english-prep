import type { DemoCollocation, VocabPracticeItem } from '../../../shared/types';

/** 「查看练习题」表格的一行：一个词条及其练习 */
export interface PracticeRow {
  key: string;
  order: number;
  word: string;
  /** 词性，AI 出题时作为上下文 */
  pos: string;
  meaning: string;
  collocation: string;
  /** 结构化搭配，AI 出题时优先考这些 */
  collocations: DemoCollocation[];
  exercises: VocabPracticeItem[];
  /** 该词在教材里本来就有练习，删光后可以「恢复教材默认」 */
  builtin: boolean;
}
