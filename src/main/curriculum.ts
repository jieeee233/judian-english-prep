/**
 * 课标词表索引：判断一个表达是否在课标范围内、属于哪一档，以及「太简单」的功能词表。
 *
 * 只做查表与归一化，不掺业务规则；选词策略在 wordSelection.ts。
 */
import curriculumRaw from './data/curriculum.json';

type Row = [string, string[], string];

export interface Match {
  hit: boolean;
  level: string;
  /** 命中的课标词形 */
  key: string;
}

/** 纯功能词：无论什么情况都不作为教学重点 */
const HARD_BASIC = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'so', 'if', 'as', 'of', 'to', 'in', 'on', 'at', 'by', 'for',
  'with', 'from', 'into', 'onto', 'over', 'under', 'about', 'after', 'before', 'again', 'also', 'very',
  'be', 'is', 'am', 'are', 'was', 'were', 'been', 'being', 'do', 'does', 'did', 'done', 'have', 'has',
  'had', 'will', 'would', 'can', 'could', 'may', 'might', 'must', 'shall', 'should', 'not', 'no', 'yes',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his',
  'its', 'our', 'their', 'this', 'that', 'these', 'those', 'there', 'here', 'who', 'what', 'which',
  'when', 'where', 'why', 'how', 'all', 'any', 'some', 'each', 'every', 'both', 'few', 'more', 'most',
  'other', 'such', 'than', 'then', 'now', 'one', 'two', 'just', 'like', 'back', 'down', 'up', 'out',
  'off', 'only', 'even', 'still', 'too', 'well', 'much', 'many', 'own', 'same', 'because',
]);

/** 常见但偶尔有熟词生义价值：最多留一个 */
const SOFT_BASIC = new Set([
  'get', 'got', 'go', 'goes', 'went', 'gone', 'come', 'came', 'make', 'made', 'take', 'took', 'taken',
  'give', 'gave', 'given', 'say', 'said', 'see', 'saw', 'seen', 'know', 'knew', 'known', 'think',
  'thought', 'want', 'use', 'used', 'put', 'let', 'keep', 'kept', 'look', 'looked', 'find', 'found',
  'good', 'bad', 'big', 'small', 'new', 'old', 'hard', 'free', 'last', 'long', 'right', 'left',
]);

const SUFFIXES = ['s', 'es', 'ed', 'ing', 'ies', 'er', 'est', 'ly', "'s"];

let index: Map<string, string> | null = null;
let lemmaIndex: Map<string, string> | null = null;
let derivedIndex: Map<string, string> | null = null;

function buildIndex(): Map<string, string> {
  const table = new Map<string, string>();
  const stems = new Map<string, string>();
  const heads = new Map<string, string>();
  for (const row of curriculumRaw as Row[]) {
    const [expression, variants, level] = row;
    if (!expression) continue;
    if (!table.has(expression)) table.set(expression, level);
    if (!expression.includes(' ')) {
      if (!stems.has(lemma(expression))) stems.set(lemma(expression), expression);
      // 派生词索引：优先记住带级别标记的词，命中率更贴近教学重点
      if (expression.length >= 6) {
        const head = expression.slice(0, 6);
        if (!heads.has(head) || level) heads.set(head, expression);
      }
    }
    for (const variant of variants) {
      if (variant && !table.has(variant)) table.set(variant, level);
      if (variant && !variant.includes(' ') && !stems.has(lemma(variant))) stems.set(lemma(variant), variant);
    }
  }
  lemmaIndex = stems;
  derivedIndex = heads;
  return table;
}

function table(): Map<string, string> {
  if (!index) index = buildIndex();
  return index;
}

/** 归一化：小写、去标点、压空格。短语保留空格 */
export function normalizeTerm(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9'’\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 粗略词形归并，用于判重与词表匹配 */
export function lemma(word: string): string {
  const base = normalizeTerm(word);
  if (base.includes(' ')) return base;
  for (const suffix of SUFFIXES) {
    if (base.length > suffix.length + 3 && base.endsWith(suffix)) {
      const cut = base.slice(0, -suffix.length);
      if (suffix === 'ies') return `${cut}y`;
      return cut.replace(/e$/, '');
    }
  }
  return base;
}

/** 查课标表：精确 → 词形归并 → 派生（共享 6 字符以上词头） */
export function matchCurriculum(term: string): Match {
  const key = normalizeTerm(term);
  if (!key) return { hit: false, level: '', key: '' };
  const exact = table().get(key);
  if (exact !== undefined) return { hit: true, level: exact, key };

  const stem = lemma(key);
  const stemmed = table().get(stem);
  if (stemmed !== undefined) return { hit: true, level: stemmed, key: stem };

  // 原文可能是变形（retired / retiring），按词形归并再找一次
  const base = lemmaIndex?.get(stem);
  if (base) return { hit: true, level: table().get(base) ?? '', key: base };

  // 派生词：enthusiasm ← enthusiastic，词头相同即视为课标范围内（仍按独立词条处理）
  if (!key.includes(' ') && key.length >= 6) {
    const head = key.slice(0, 6);
    const derived = derivedIndex?.get(head);
    if (derived) return { hit: true, level: table().get(derived) ?? '', key: derived };
  }
  return { hit: false, level: '', key: stem };
}

export function isHardBasic(term: string): boolean {
  const key = normalizeTerm(term);
  return HARD_BASIC.has(key) || HARD_BASIC.has(lemma(key));
}

export function isSoftBasic(term: string): boolean {
  const key = normalizeTerm(term);
  return SOFT_BASIC.has(key) || SOFT_BASIC.has(lemma(key));
}
