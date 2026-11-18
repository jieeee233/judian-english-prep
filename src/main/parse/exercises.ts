/**
 * 练习结果的解析：每个目标一题，缺题、对不上目标都记进问题清单。
 */
import { MAX_EXERCISES } from '../../shared/constants';
import type { Exercise, SentenceNote, VocabEntry } from '../../shared/types';
import { isRecord } from '../errors';
import { asItems, pick, text } from './coerce';
import { parseJsonLoose, salvageObjects, stripThinking } from './json';


/**
 * 题型名兜底：模型偶尔把题型写成 fill_in_the_blank 这类下划线代码，
 * 界面上要显示中文题型，这里统一收一遍。
 */
const KIND_BY_CODE: Record<string, string> = {
  fill_in_the_blank: '选词填空',
  fill_in_blanks: '选词填空',
  fill_blank: '选词填空',
  cloze: '选词填空',
  blank_filling: '选词填空',
  word_formation: '词形变化填空',
  word_form: '词形变化填空',
  multiple_choice: '单项选择',
  choice: '单项选择',
  translation: '中译英',
  translate: '中译英',
  translate_zh_to_en: '中译英',
  translate_en_to_zh: '英译中',
  sentence_combination: '两句合并',
  sentence_combining: '两句合并',
  combine_sentences: '两句合并',
  combine: '两句合并',
  paraphrase: '同义改写',
  rewrite: '改写',
  imitating_writing: '长难句仿写',
  imitation: '长难句仿写',
  discourse_rewriting: '语篇衔接改写',
  opinion: '观点表达',
};

function normalizeKind(raw: string): string {
  const value = raw.trim();
  if (!value) return '练习';
  if (/[\u4e00-\u9fa5]/.test(value)) return value;
  const code = value.toLowerCase().replace(/[\s-]+/g, '_');
  return KIND_BY_CODE[code] ?? value.replace(/_/g, ' ');
}

const EXERCISE_ALIASES = {
  id: ['id', 'no', '编号'],
  targetId: ['targetId', 'targetid', 'ref', 'refId', '目标', '目标id'],
  target: ['target', '目标内容'],
  kind: ['kind', 'type', '题型'],
  prompt: ['prompt', 'question', 'stem', '题干'],
  answer: ['answer', 'key', '参考答案', '答案'],
  explain: ['explain', 'explanation', 'note', '简要说明', '说明', '解析'],
};

export interface ExerciseOutcome {
  items: Exercise[];
  issues: string[];
  empty: boolean;
  parsed: boolean;
}

function targetLookup(vocab: VocabEntry[], sentences: SentenceNote[]): Map<string, string> {
  const map = new Map<string, string>();
  vocab.forEach((item) => map.set(item.id, item.term));
  sentences.forEach((item) => map.set(item.id, item.quote));
  return map;
}

export function parseExercises(
  content: string,
  vocab: VocabEntry[],
  sentences: SentenceNote[],
): ExerciseOutcome {
  const body = stripThinking(content);
  if (!body) return { items: [], issues: ['模型只返回了思考过程，没有正文'], empty: true, parsed: false };

  const parsed = parseJsonLoose(body);
  const root = isRecord(parsed) ? parsed : null;
  const rawList =
    (root && pick(root, ['exercises', 'practice', 'items', '练习', '题目'])) ?? (Array.isArray(parsed) ? parsed : null);
  let list = asItems(rawList);
  if (!list.length) {
    // 整段解析失败时逐对象抢救，能救几题救几题
    const salvaged = salvageObjects(body);
    if (salvaged.length) list = salvaged;
  }
  const targets = targetLookup(vocab, sentences);
  const issues: string[] = [];
  const items: Exercise[] = [];
  const seen = new Set<string>();

  for (const [index, item] of list.slice(0, MAX_EXERCISES).entries()) {
    const prompt = text(pick(item, EXERCISE_ALIASES.prompt));
    const answer = text(pick(item, EXERCISE_ALIASES.answer));
    if (!prompt || !answer) continue;
    let targetId = text(pick(item, EXERCISE_ALIASES.targetId));
    if (!targetId || !targets.has(targetId)) {
      // 对不上目标时按顺序补位，并记一条问题，避免整批作废
      const fallback = [...targets.keys()][items.length];
      if (fallback && !seen.has(fallback)) {
        issues.push(`第 ${index + 1} 题的 targetId「${targetId || '空'}」对不上目标清单，已按顺序归到 ${fallback}`);
        targetId = fallback;
      } else {
        continue;
      }
    }
    if (seen.has(targetId)) continue;
    seen.add(targetId);
    items.push({
      id: text(pick(item, EXERCISE_ALIASES.id)) || `E${items.length + 1}`,
      targetId,
      target: text(pick(item, EXERCISE_ALIASES.target)) || targets.get(targetId) || '',
      kind: normalizeKind(text(pick(item, EXERCISE_ALIASES.kind))),
      prompt,
      answer,
      explain: text(pick(item, EXERCISE_ALIASES.explain)).replace(/\s+/g, ' ').slice(0, 80),
    });
  }

  const missingTargets = [...targets.keys()].filter((id) => !seen.has(id));
  if (missingTargets.length) issues.push(`以下目标没有生成题目：${missingTargets.join('、')}`);

  return { items, issues, empty: false, parsed: Boolean(root) || list.length > 0 };
}
