/**
 * 结果面板里「P2 · 定位原文」这类标签的计算。
 *
 * 段号必须和左栏分段保持一致，所以统一走 paragraphs 里的规则；
 * 词条另外需要一个短上下文（设计稿里「原文」显示的是 in remarkable health 这样的短语）。
 */

import { locateQuoteRanges, locateRanges } from './locate';
import { paragraphAtOffset, splitParagraphs } from './paragraphs';

/** 该表达在原文里落在哪一段，找不到返回空串 */
export function sourceLabel(source: string, text: string, kind: 'term' | 'quote' = 'term'): string {
  const value = text.trim();
  if (!source || !value) return '';
  const ranges = kind === 'quote' ? locateQuoteRanges(source, value) : locateRanges(source, value);
  if (!ranges.length) return '';
  const para = paragraphAtOffset(splitParagraphs(source), ranges[0].start);
  return para?.label ?? '';
}

const WORD = /[A-Za-z][A-Za-z'’-]*/g;
/** 短语尾部不收这些词，否则读起来像断句 */
const TAIL_NOISE = /^(?:not|just|and|or|but|of|to|in|for|with|at|on|by|as|that|which|who|the|a|an|be|is|was|were|are)$/i;

/**
 * 词条在原文里的短上下文：命中的词前后各留两个词。
 * 命中不到时返回空串，界面显示「—」，不编造。
 */
export function phraseAround(source: string, term: string, span = 2): string {
  const needle = term.trim().replace(/^[^\w]+|[^\w]+$/g, '');
  if (!source || !needle) return '';
  const ranges = locateRanges(source, needle);
  if (!ranges.length) return '';
  const hit = ranges[0];

  // 取命中处所在句子，再在句子里截词窗
  const before = source.slice(0, hit.start);
  const sentenceStart = Math.max(
    before.lastIndexOf('. '),
    before.lastIndexOf('? '),
    before.lastIndexOf('! '),
    before.lastIndexOf('\n'),
  );
  const from = sentenceStart < 0 ? 0 : sentenceStart + 1;
  const after = source.slice(hit.end, hit.end + 300);
  const stopMatch = after.match(/[.!?](\s|$)/);
  const to = stopMatch ? hit.end + (stopMatch.index ?? 0) + 1 : Math.min(source.length, hit.end + 300);

  const sentence = source.slice(from, to);
  const words = [...sentence.matchAll(WORD)];
  if (!words.length) return sentence.trim();

  const hitWord = words.findIndex((word) => {
    const start = from + (word.index ?? 0);
    return start <= hit.start && start + word[0].length >= hit.start;
  });
  if (hitWord < 0) return sentence.trim();

  const first = words[Math.max(0, hitWord - span)];
  // 尾部落在虚词上就收回来，避免出现 "a good steward not just" 这种断头短语
  let tail = Math.min(words.length - 1, hitWord + span);
  while (tail > hitWord && TAIL_NOISE.test(words[tail][0])) tail -= 1;
  const last = words[tail];
  const start = from + (first.index ?? 0);
  const end = from + (last.index ?? 0) + last[0].length;
  return source.slice(start, end).replace(/\s+/g, ' ').trim();
}
