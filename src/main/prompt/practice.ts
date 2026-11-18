/**
 * 练习提示词：目标清单是唯一出题范围，难度由设置决定。
 * 输出是一条一条的扁平结构，坏一两题不影响整批。
 */
import { DIFFICULTY_LABEL, DIFFICULTY_SPEC, type ExerciseDifficulty } from '../../shared/constants';
import type { SentenceNote, VocabEntry } from '../../shared/types';
import type { ChatMessage } from './analysis';

export function buildPracticeMessages(
  text: string,
  vocab: VocabEntry[],
  sentences: SentenceNote[],
  difficulty: ExerciseDifficulty,
): ChatMessage[] {
  const targets = [
    ...vocab.map((item) => ({
      targetId: item.id,
      target: item.term,
      kind: 'vocab' as const,
      phonetic: item.phonetic,
      pos: item.pos,
      meaning: item.meaning,
    })),
    ...sentences.map((item) => ({
      targetId: item.id,
      target: item.quote,
      kind: 'sentence' as const,
      structure: item.structure,
      translation: item.translation,
    })),
  ];

  const system = `你是为中国高中英语教师服务的出题助手。依据给定的文章与目标清单出题，遵守以下规则：
1. 目标清单是本次唯一出题范围：每个 targetId 各出一道题，不增不减、不改 id，不要考察清单之外的语言点。
2. 题目用英文，指令与解析用中文。题干必须能独立作答，不依赖教师口头补充。
3. 答案必须落在目标本身或其语境上：词汇题的答案必须包含该词的准确形式，句子题必须体现该句的结构或语义。开放题给出参考表达并注明"参考"，不设唯一答案。
4. 不推测教材、单元、考试频次或课标等级；不编造原文没有的信息。
5. 难度严格按下面的要求执行：${DIFFICULTY_SPEC[difficulty]}
6. 填空处直接用连续下划线（如 ______），不要写反斜杠转义、不要用 LaTeX 或 Markdown 标记；字符串里不要出现 JSON 不合法的转义字符。
7. kind 必须是中文题型名（如 选词填空、词形变化填空、中译英、英译中、两句合并、语篇衔接改写、长难句仿写、观点表达），不要写英文、下划线代码或编号。
8. explain 是给教师看的简要说明，一句话讲清答案为什么成立（词形、搭配或句式要点），40 字内；没有要点就留空字符串。
9. 只输出一个合法 JSON 对象，不要 Markdown 围栏或解释文字，结构如下：
{
  "exercises": [
    { "id": "E1", "targetId": "V1", "target": "目标原文", "kind": "题型名称", "prompt": "题干", "answer": "参考答案", "explain": "简要说明" }
  ]
}`;

  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: JSON.stringify({
        task: `为下面每个目标各出一道「${DIFFICULTY_LABEL[difficulty]}」难度的练习，共 ${targets.length} 道。`,
        difficulty: DIFFICULTY_LABEL[difficulty],
        targets,
        passage: text,
      }),
    },
  ];
}
