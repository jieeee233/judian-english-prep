/**
 * 解析层的对外出口。
 *
 * 内部分成四块，各自只干一件事：
 * - json.ts      语法修复：让坏掉的 JSON 尽量能读
 * - coerce.ts    字段取值：别名、类型、长度统一
 * - blocks.ts    四个板块的字段映射与校验
 * - exercises.ts 练习结果的映射与补位
 * - quality.ts   内容规则：长难句是否真的是原文里的完整句子
 */
export {
  escapeControlCharsInStrings,
  extractPreview,
  parseJsonLoose,
  repairJson,
  repairStrayQuotes,
  salvageArrayItems,
  salvageObjects,
  salvageValue,
  stripThinking,
} from './json';

export {
  asItems,
  brief,
  failed,
  isSelfNarration,
  normalizeKey,
  pick,
  text,
} from './coerce';

export {
  BLOCK_LIMITS,
  BLOCK_MINIMUM,
  parseBlockValue,
  parseBlocks,
  parseDiscourse,
  parseQuestions,
  parseSentences,
  parseSingleBlock,
  parseVocab,
  type Outcome,
  type ParseBlocksOutcome,
  type ParseOptions,
  type Rejected,
  type SingleBlockOutcome,
} from './blocks';

export { parseExercises, type ExerciseOutcome } from './exercises';

export { checkSentenceQuote, checkTranslation, hasFiniteVerb, quoteInPassage } from './quality';
