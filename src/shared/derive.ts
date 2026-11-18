import { BLOCK_TITLES, DIFFICULTY_LABEL, DISCOURSE_FIELDS, DISCOURSE_LABELS } from './constants';
import type { AnalysisPayload, Section } from './types';

/**
 * 把结构化结果摊平成可复制/可导出的五段文本。
 * 复制与 Word/Markdown 导出共用这一份，保证三个出口的内容完全一致。
 */
export function payloadSections(payload: AnalysisPayload): Section[] {
  if (payload.legacy?.length) return payload.legacy;

  const sections: Section[] = [];

  sections.push({
    id: 'discourse',
    title: BLOCK_TITLES.discourse,
    text: payload.discourse
      ? DISCOURSE_FIELDS.map(
          (field) => `${DISCOURSE_LABELS[field]}：${payload.discourse?.[field] ?? ''}`,
        ).join('\n')
      : '本次没有生成篇章分析。请重新解析，或在结果页重新生成后重试。',
  });

  sections.push({
    id: 'questions',
    title: BLOCK_TITLES.questions,
    text: payload.questions?.length
      ? payload.questions
          .map((item, index) =>
            [
              `第 ${item.no || index + 1} 题${item.tag ? `（${item.tag}）` : '（能力标签未归类）'}`,
              `题干：${item.question}`,
              `参考答案：${item.answer}`,
              `原文证据：${item.evidence}`,
              `教学考点：${item.point}`,
              `可能的命题逻辑：${item.logic}`,
            ].join('\n'),
          )
          .join('\n\n')
      : '本次没有生成逐题讲解：文章未包含题目，或该板块生成失败。',
  });

  sections.push({
    id: 'vocab',
    title: BLOCK_TITLES.vocab,
    text: payload.vocab?.length
      ? payload.vocab
          .map((item) => {
            const head = [item.term, item.phonetic ? `/${item.phonetic.replace(/^\/|\/$/g, '')}/` : '', item.pos]
              .filter(Boolean)
              .join(' ');
            return `${item.id} · ${head}：${item.meaning}`;
          })
          .join('\n')
      : '本次没有生成重点词汇。',
  });

  sections.push({
    id: 'sentences',
    title: BLOCK_TITLES.sentences,
    text: payload.sentences?.length
      ? payload.sentences
          .map((item) =>
            [
              `${item.id}｜原句：${item.quote}`,
              `结构：${item.structure}`,
              `翻译：${item.translation}`,
              `分析：${item.analysis}`,
            ].join('\n'),
          )
          .join('\n\n')
      : '本次没有生成长难句。',
  });

  sections.push({
    id: 'exercise',
    title: BLOCK_TITLES.exercise,
    text: payload.exercise?.items.length
      ? [
          `难度：${DIFFICULTY_LABEL[payload.exercise.difficulty]}`,
          '',
          ...payload.exercise.items.map((item) =>
            [`${item.id}｜${item.kind}（目标 ${item.targetId} · ${item.target}）`, `题干：${item.prompt}`, `参考答案：${item.answer}`].join(
              '\n',
            ),
          ),
        ].join('\n')
      : '尚未生成练习：在「搭配与练习」页选择难度后点击生成。',
  });

  return sections;
}

/** 文章标题行：取首行有意义的内容，供导出文件名与文案使用。 */
export function passageTitle(text: string): string {
  const first = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!first) return '';
  return first.length > 42 ? `${first.slice(0, 42)}…` : first;
}
