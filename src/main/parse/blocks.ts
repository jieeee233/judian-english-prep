/**
 * 四个板块的字段映射与校验。
 *
 * 每个板块一个 parse 函数，输入是「从模型 JSON 里抠出来的那一块」，
 * 输出只有两种：可用值 + 提示，或不可用 + 原因。
 * 板块之间互不引用，缺一个不影响其它三个。
 */
import { ANALYSIS_BLOCKS, MAX_BLOCK_ITEMS, type AnalysisBlock } from '../../shared/constants';
import type { DiscourseNote, QuestionNote, SentenceNote, VocabEntry } from '../../shared/types';
import { normalizeAbilityTag } from '../../shared/ability';
import { isRecord } from '../errors';
import { asItems, brief, failed, isSelfNarration, pick, text } from './coerce';
import { parseJsonLoose, salvageArrayItems, salvageValue, stripThinking } from './json';
import { checkSentenceQuote, checkTranslation } from './quality';

/** 各板块的业务上限：提示词要求 5 项，解析层不允许无限追加 */
export const BLOCK_LIMITS: Record<AnalysisBlock, number> = {
  discourse: 1,
  questions: 20,
  vocab: 5,
  sentences: 5,
};

/** 最少条目：少于这个数就当作「这轮没做成」，交给自纠错重试 */
export const BLOCK_MINIMUM: Record<AnalysisBlock, number> = {
  discourse: 1,
  questions: 0,
  vocab: 2,
  sentences: 2,
};

/** 被丢掉的条目与原因，重试时原样回给模型，让它知道错在哪 */
export interface Rejected {
  value: string;
  reason: string;
}

export interface BlockValue<T> {
  value: T;
  issues: string[];
  rejected?: Rejected[];
}

export type Outcome<T> = BlockValue<T> | { value: null; issues: string[]; reason: string; rejected?: Rejected[] };

const CONTAINER_KEYS: Record<AnalysisBlock, string[]> = {
  discourse: ['discourse', 'passageAnalysis', 'textAnalysis', '语篇分析', '篇章分析'],
  questions: ['questions', 'questionNotes', 'questionAnalysis', '逐题讲解', '题目讲解', '题目'],
  vocab: ['vocab', 'vocabulary', 'keyWords', 'words', '重点词汇', '词汇'],
  sentences: ['sentences', 'longSentences', 'difficultSentences', '长难句', '难句'],
};

const DISCOURSE_ALIASES = {
  genre: ['genre', 'type', 'textType', '体裁', '文体'],
  gist: ['gist', 'mainIdea', 'theme', 'summary', '主旨', '大意', '主题', '中心思想'],
  structure: ['structure', 'organization', 'organizationStructure', '篇章结构', '结构', '段落结构'],
  purpose: ['purpose', 'writingPurpose', 'intention', '写作目的', '目的', '写作意图'],
};

const QUESTION_ALIASES = {
  no: ['no', 'number', 'num', 'index', '题号', '序号'],
  question: ['question', 'stem', 'questionText', 'item', '题干', '题目', '原题'],
  answer: ['answer', 'answerKey', 'key', '参考答案', '答案'],
  evidence: ['evidence', 'quote', 'proof', '原文证据', '证据', '原文依据'],
  point: ['point', 'examPoint', 'teachingPoint', '考点', '教学考点', '考查点'],
  logic: ['logic', 'rationale', 'reasoning', '命题逻辑', '设问逻辑', '可能的命题逻辑'],
  tag: ['tag', 'abilityTag', 'ability', 'label', '能力标签', '课标能力标签', '标签'],
  note: ['note', 'tip', 'teacherNote', 'reminder', '提示', '教师核对提示', '核对提示', '易错提示'],
};

const VOCAB_ALIASES = {
  id: ['id', 'no', '编号', '序号'],
  term: ['term', 'word', 'phrase', 'expression', '单词', '短语', '表达'],
  phonetic: ['phonetic', 'ipa', 'pronunciation', '音标'],
  pos: ['pos', 'partOfSpeech', '词性'],
  meaning: ['meaning', 'meaningInContext', 'sense', 'definition', '文中含义', '释义', '含义'],
  usage: ['usage', 'collocation', 'pattern', '用法', '教学用法', '搭配', '常用搭配', '用法说明'],
};

const SENTENCE_ALIASES = {
  id: ['id', 'no', '编号', '序号'],
  quote: ['quote', 'sentence', 'original', '原文', '原句', '完整原句'],
  structure: ['structure', 'syntax', '结构'],
  translation: ['translation', 'translationZh', '翻译', '译文'],
  analysis: ['analysis', 'explain', '分析', '解析'],
};

/** 体裁只留类别词：去掉"体裁："前缀与后面的理由，最多 16 字。 */
function shortGenre(value: string): string {
  const stripped = value.replace(/^(体裁|文体)\s*[:：]\s*/, '');
  const head = stripped.split(/[，,。；;（(]/)[0].trim();
  return (head || stripped).slice(0, 16);
}

/** 一句话的补充说明：去掉换行与自述，最多 60 字，避免撑破卡片 */
function shortNote(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  if (!flat || isSelfNarration(flat)) return '';
  return flat.slice(0, 60);
}

/**
 * 篇章结构按段展示：模型有时把 P1/P2/P3 写成一段长文，
 * 这里按「P数字」标记断行，界面才能一段一张小卡。
 */
function splitStructure(value: string): string {
  const flat = value.replace(/\r/g, '').trim();
  if (!flat) return '';
  if (flat.includes('\n')) return flat;
  return flat
    .replace(/([。；;])\s*(?=P\d+\s*[｜|:：])/g, '$1\n')
    .replace(/\s+(?=P\d+\s*[｜|:：])/g, '\n')
    .trim();
}

function nextId(prefix: string, index: number, used: Set<string>): string {
  let id = `${prefix}${index + 1}`;
  let offset = index + 1;
  while (used.has(id)) {
    offset += 1;
    id = `${prefix}${offset}`;
  }
  used.add(id);
  return id;
}

/* --------------------------------- 篇章分析 --------------------------------- */

export function parseDiscourse(raw: unknown): Outcome<DiscourseNote> {
  const source = Array.isArray(raw) ? raw.find(isRecord) : raw;
  if (!isRecord(source)) return failed('篇章分析不是对象');

  const note: DiscourseNote = {
    genre: shortGenre(text(pick(source, DISCOURSE_ALIASES.genre))),
    gist: text(pick(source, DISCOURSE_ALIASES.gist)),
    structure: splitStructure(text(pick(source, DISCOURSE_ALIASES.structure))),
    purpose: text(pick(source, DISCOURSE_ALIASES.purpose)),
  };
  const issues: string[] = [];
  const labels: Record<keyof DiscourseNote, string> = {
    genre: '体裁',
    gist: '主旨',
    structure: '篇章结构',
    purpose: '写作目的',
  };
  (Object.keys(note) as Array<keyof DiscourseNote>).forEach((field) => {
    if (!note[field]) issues.push(`篇章分析缺少「${labels[field]}」`);
  });
  if (!note.gist) return failed('篇章分析缺少主旨', issues);
  return { value: note, issues };
}

/* --------------------------------- 逐题讲解 --------------------------------- */

export function parseQuestions(raw: unknown): Outcome<QuestionNote[]> {
  const list = asItems(raw);
  if (!list.length) {
    // 文章本身没有题目是正常情况，交给界面说明，不算失败
    if (Array.isArray(raw) && raw.length === 0) {
      return { value: [], issues: ['文章里没有识别到题目，逐题讲解为空'] };
    }
    return failed('逐题讲解为空或不是数组');
  }

  const issues: string[] = [];
  const rejected: Rejected[] = [];
  const result: QuestionNote[] = [];
  for (const [index, item] of list.slice(0, BLOCK_LIMITS.questions).entries()) {
    const question = text(pick(item, QUESTION_ALIASES.question));
    const answer = text(pick(item, QUESTION_ALIASES.answer));
    if (!question && !answer) continue;
    const rawTag = text(pick(item, QUESTION_ALIASES.tag));
    const tag = normalizeAbilityTag(rawTag);
    const no = text(pick(item, QUESTION_ALIASES.no)) || String(index + 1);
    if (!question) issues.push(`第 ${no} 题缺少题干`);
    if (!answer) issues.push(`第 ${no} 题缺少参考答案`);
    if (!tag) {
      issues.push(rawTag ? `第 ${no} 题能力标签「${rawTag}」不在八个标签内，已标注为未归类` : `第 ${no} 题未给出能力标签`);
    }
    if (!question) {
      rejected.push({ value: brief(no, 8), reason: '缺少题干' });
      continue;
    }
    result.push({
      no,
      question,
      answer,
      evidence: text(pick(item, QUESTION_ALIASES.evidence)),
      point: text(pick(item, QUESTION_ALIASES.point)),
      logic: text(pick(item, QUESTION_ALIASES.logic)),
      tag,
      note: shortNote(text(pick(item, QUESTION_ALIASES.note))),
    });
  }

  if (!result.length) return failed('逐题讲解里没有可用的题目', issues);
  return { value: result, issues, ...(rejected.length ? { rejected } : {}) };
}

/* --------------------------------- 重点词汇 --------------------------------- */

export function parseVocab(raw: unknown): Outcome<VocabEntry[]> {
  const list = asItems(raw);
  if (!list.length) return failed('重点词汇为空或不是数组');

  const issues: string[] = [];
  const rejected: Rejected[] = [];
  const result: VocabEntry[] = [];
  const usedIds = new Set<string>();
  for (const item of list.slice(0, MAX_BLOCK_ITEMS)) {
    const term = text(pick(item, VOCAB_ALIASES.term));
    const meaning = text(pick(item, VOCAB_ALIASES.meaning));
    if (!term || !meaning) {
      if (term) {
        issues.push(`词汇「${term}」缺少文中含义`);
        rejected.push({ value: term, reason: '缺少文中含义' });
      }
      continue;
    }
    if (isSelfNarration(meaning)) {
      issues.push(`词汇「${term}」的释义是模型自述而非文中含义，已丢弃`);
      rejected.push({ value: term, reason: '释义是套话而非文中含义' });
      continue;
    }
    const rawId = text(pick(item, VOCAB_ALIASES.id));
    const id = /^V\d+$/.test(rawId) && !usedIds.has(rawId) ? rawId : nextId('V', result.length, usedIds);
    usedIds.add(id);
    result.push({
      id,
      term,
      phonetic: text(pick(item, VOCAB_ALIASES.phonetic)).replace(/^\/|\/$/g, ''),
      pos: text(pick(item, VOCAB_ALIASES.pos)),
      meaning,
      usage: shortNote(text(pick(item, VOCAB_ALIASES.usage))),
    });
    if (result.length >= BLOCK_LIMITS.vocab) break;
  }

  if (!result.length) return failed('重点词汇里没有可用条目', issues);
  return { value: result, issues, ...(rejected.length ? { rejected } : {}) };
}

/* --------------------------------- 长难句 ---------------------------------- */

/**
 * 长难句是最容易被凑数的板块：模型会把选项、介词短语、从句片段当句子。
 * 传入原文时逐条验「是不是原文里的完整单句」，不合格的记进 rejected，
 * 重试时把原因回给模型；读历史留档时不传原文，只做字段与重复校验。
 */
export function parseSentences(raw: unknown, passage = ''): Outcome<SentenceNote[]> {
  const list = asItems(raw);
  if (!list.length) return failed('长难句为空或不是数组');

  const strict = Boolean(passage);
  const issues: string[] = [];
  const rejected: Rejected[] = [];
  const result: SentenceNote[] = [];
  const usedIds = new Set<string>();

  for (const item of list.slice(0, MAX_BLOCK_ITEMS)) {
    let quote = text(pick(item, SENTENCE_ALIASES.quote));
    if (!quote) continue;

    if (strict) {
      const check = checkSentenceQuote(quote, passage);
      if (!check.ok) {
        issues.push(`句子「${brief(quote)}」${check.reason}，已丢弃`);
        rejected.push({ value: quote, reason: check.reason ?? '不是完整句子' });
        continue;
      }
      // 模型改动了原文的小毛病时，一律以原文写法为准
      if (check.text) quote = check.text;
    }
    if (result.some((one) => one.quote === quote)) {
      rejected.push({ value: quote, reason: '与前面的句子重复' });
      continue;
    }

    const structure = text(pick(item, SENTENCE_ALIASES.structure));
    const analysis = text(pick(item, SENTENCE_ALIASES.analysis));
    let translation = text(pick(item, SENTENCE_ALIASES.translation));

    if (!structure && !translation) {
      issues.push(`句子「${brief(quote)}」缺少结构与翻译`);
      rejected.push({ value: quote, reason: '缺少结构与翻译' });
      continue;
    }
    if (strict && translation) {
      const translationCheck = checkTranslation(translation, quote);
      if (!translationCheck.ok) {
        issues.push(`句子「${brief(quote)}」译文不可用（${translationCheck.reason}），已清空`);
        translation = '';
      }
    }
    const cleanAnalysis = isSelfNarration(analysis) ? '' : analysis;
    const rawId = text(pick(item, SENTENCE_ALIASES.id));
    const id = /^S\d+$/.test(rawId) && !usedIds.has(rawId) ? rawId : nextId('S', result.length, usedIds);
    usedIds.add(id);
    result.push({ id, quote, structure, translation, analysis: cleanAnalysis });
    if (result.length >= BLOCK_LIMITS.sentences) break;
  }

  if (strict && result.length < BLOCK_MINIMUM.sentences) {
    const reason =
      result.length === 0 ? '长难句里没有可用条目' : `长难句只通过 ${result.length} 条，少于 2 条`;
    return { ...failed(reason, issues), rejected };
  }
  if (!result.length) return failed('长难句里没有可用条目', issues);
  return { value: result, issues, ...(rejected.length ? { rejected } : {}) };
}

/* -------------------------------- 统一入口 --------------------------------- */

export function parseBlockValue(block: AnalysisBlock, raw: unknown, passage = ''): Outcome<unknown> {
  switch (block) {
    case 'discourse':
      return parseDiscourse(raw);
    case 'questions':
      return parseQuestions(raw);
    case 'vocab':
      return parseVocab(raw);
    case 'sentences':
      return parseSentences(raw, passage);
  }
}

export interface ParseOptions {
  /** 只校验这些板块；缺省四个都要 */
  blocks?: readonly AnalysisBlock[];
  /** 原文：用于长难句的逐字比对 */
  passage?: string;
}

export interface ParseBlocksOutcome {
  blocks: {
    discourse?: DiscourseNote;
    questions?: QuestionNote[];
    vocab?: VocabEntry[];
    sentences?: SentenceNote[];
  };
  missing: AnalysisBlock[];
  issues: string[];
  rejected: Rejected[];
  /** 是否读到了 JSON 结构（用于区分「格式不合规」与「压根没内容」） */
  jsonObject: boolean;
  empty: boolean;
}

function rawForBlock(root: Record<string, unknown> | null, textSource: string, block: AnalysisBlock): unknown {
  let raw = root ? pick(root, CONTAINER_KEYS[block]) : undefined;
  // 分步请求的形态：模型直接给出板块本体（例如只有 genre/gist/structure/purpose 四个键）
  if (raw === undefined && root && block === 'discourse' && pick(root, DISCOURSE_ALIASES.gist) !== undefined) {
    raw = root;
  }
  if (raw === undefined) raw = salvageValue(textSource, CONTAINER_KEYS[block]);
  // 数组板块整体坏了（多半是某条里的引号没转义）：逐条抢救，留下能用的
  if (raw === undefined && block !== 'discourse') {
    const items = salvageArrayItems(textSource, CONTAINER_KEYS[block]);
    if (items.length) raw = items;
  }
  return raw;
}

/**
 * 一次请求可能只含部分板块：按 expected 逐个校验，各自成败。
 * 任一板块格式错误都不会连累其它板块。
 */
export function parseBlocks(content: string, options: ParseOptions = {}): ParseBlocksOutcome {
  const expected = options.blocks ?? ANALYSIS_BLOCKS;
  const passage = options.passage ?? '';
  const text0 = stripThinking(content);
  if (!text0) {
    return {
      blocks: {},
      missing: [...expected],
      issues: ['模型只返回了思考过程，没有正文'],
      rejected: [],
      jsonObject: false,
      empty: true,
    };
  }

  const parsed = parseJsonLoose(text0);
  const root = isRecord(parsed) ? parsed : null;
  const blocks: ParseBlocksOutcome['blocks'] = {};
  const missing: AnalysisBlock[] = [];
  const issues: string[] = [];
  const rejected: Rejected[] = [];
  let jsonObject = Boolean(root);

  for (const block of expected) {
    const raw = rawForBlock(root, text0, block);
    if (raw !== undefined) jsonObject = true;

    const outcome = parseBlockValue(block, raw, passage);
    issues.push(...outcome.issues);
    if (outcome.rejected?.length) rejected.push(...outcome.rejected);
    if (outcome.value === null) {
      missing.push(block);
      continue;
    }
    (blocks as Record<string, unknown>)[block] = outcome.value;
  }

  return { blocks, missing, issues, rejected, jsonObject, empty: false };
}

export interface SingleBlockOutcome {
  value: unknown | null;
  issues: string[];
  rejected: Rejected[];
  empty: boolean;
  reason?: string;
}

/** 单板块请求的解析：模型可能给对象、数组或整对象包一层。 */
export function parseSingleBlock(
  block: AnalysisBlock,
  content: string,
  passage = '',
): SingleBlockOutcome {
  const body = stripThinking(content);
  if (!body) {
    const miss = failed('模型只返回了思考过程，没有正文');
    return { value: null, issues: miss.issues, rejected: [], reason: miss.reason, empty: true };
  }
  const parsed = parseJsonLoose(body);
  const root = isRecord(parsed) ? parsed : null;
  let raw = rawForBlock(root, body, block);
  // 分步请求有时直接给数组
  if (raw === undefined && Array.isArray(parsed) && block !== 'discourse') raw = parsed;

  const outcome = parseBlockValue(block, raw, passage);
  return {
    value: outcome.value,
    issues: outcome.issues,
    rejected: outcome.rejected ?? [],
    empty: false,
    ...('reason' in outcome ? { reason: outcome.reason } : {}),
  };
}
