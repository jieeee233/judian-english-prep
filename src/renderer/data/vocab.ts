import data from './vocab.json';

/**
 * 教材词汇数据（外研社《英语》新标准高中修订版，2019 年审定）。
 * 由 scripts/build-vocab.mjs 从 data/textbook/nse2019/*.json 生成，勿手工编辑。
 *
 * 词条在 JSON 里是数组，顺序固定：
 * [序号, 单词, 音标, 词性, 释义, 标记, 搭配, 练习]
 * 后两项可能缺省（空数组）。
 */
type RawCollocation = [pattern: string, meaning?: string];
type RawExercise = [
  id: string,
  type: string,
  point: string,
  stem: string,
  answer: string,
  hint: string,
  explanation: string,
];
type RawEntry = [
  order: number,
  word: string,
  ipa: string,
  pos: string,
  meaning: string,
  mark: string,
  collocations?: RawCollocation[],
  exercises?: RawExercise[],
];

interface RawUnit {
  n: number;
  title: string;
  entries: RawEntry[];
}

interface RawBook {
  id: string;
  label: string;
  short: string;
  series: string;
  units: RawUnit[];
}

interface RawVocab {
  source: string;
  generatedAt: string;
  totalEntries: number;
  books: RawBook[];
}

/** 一条固定搭配：英文搭配模式 + 中文释义（可能缺省）。 */
export interface VocabCollocation {
  pattern: string;
  meaning: string;
}

/**
 * 教材内置练习。type 取值来自词表数据：
 * - prep 介词/搭配填空
 * - form 词形变化
 * - choice 选择题（AI 生成时使用）
 * - grammar 语法填空（AI 生成时使用）
 */
export interface VocabExercise {
  id: string;
  type: string;
  /** 考点，如「介词搭配」「名词化」 */
  point: string;
  /** 题干，空格处用 ______ 表示 */
  stem: string;
  answer: string;
  /** 提示词，如词形题的括号内原词 */
  hint: string;
  explanation: string;
  /** 选择题选项；本地内置题为空数组 */
  options?: string[];
}

export interface VocabEntry {
  /** 单元内序号，沿用教材词表顺序 */
  order: number;
  word: string;
  ipa: string;
  partOfSpeech: string;
  meaning: string;
  /** 教材原有符号：□ 选择性必修词、* 未做要求的词；空字符串表示无标记 */
  mark: string;
  /** 教材总结的固定搭配 */
  collocations: VocabCollocation[];
  /** 教材配套练习 */
  exercises: VocabExercise[];
}

export interface VocabUnit {
  unitNumber: number;
  title: string;
  entries: VocabEntry[];
}

export interface VocabBook {
  id: string;
  /** 教材全称，如“必修第一册” */
  label: string;
  /** 短名，如“必修一” */
  short: string;
  series: string;
  units: VocabUnit[];
}

const raw = data as unknown as RawVocab;

export const VOCAB_SOURCE = raw.source;
export const VOCAB_TOTAL = raw.totalEntries;

export const VOCAB_BOOKS: VocabBook[] = raw.books.map((book) => ({
  id: book.id,
  label: book.label,
  short: book.short,
  series: book.series,
  units: book.units.map((unit) => ({
    unitNumber: unit.n,
    title: unit.title,
    entries: unit.entries.map((entry) => ({
      order: entry[0],
      word: entry[1],
      ipa: entry[2],
      partOfSpeech: entry[3],
      meaning: entry[4],
      mark: entry[5],
      collocations: (entry[6] ?? []).map((item) => ({
        pattern: item[0] ?? '',
        meaning: item[1] ?? '',
      })),
      exercises: (entry[7] ?? []).map((item) => ({
        id: item[0] ?? '',
        type: item[1] ?? '',
        point: item[2] ?? '',
        stem: item[3] ?? '',
        answer: item[4] ?? '',
        hint: item[5] ?? '',
        explanation: item[6] ?? '',
      })),
    })),
  })),
}));

/** 标记符号的说明，取自教材词表前的注。 */
export const MARK_LEGEND: Record<string, string> = {
  '□': '选择性必修单词',
  '*': '未做要求的单词',
};

export function findBook(bookId: string): VocabBook | undefined {
  return VOCAB_BOOKS.find((book) => book.id === bookId);
}

export function findUnit(bookId: string, unitNumber: number): VocabUnit | undefined {
  return findBook(bookId)?.units.find((unit) => unit.unitNumber === unitNumber);
}

export function unitTitle(unit: VocabUnit): string {
  return `Unit ${unit.unitNumber}${unit.title ? ` · ${unit.title}` : ''}`;
}
