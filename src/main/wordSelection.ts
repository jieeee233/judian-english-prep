/**
 * 重点词汇的选取与二次筛选。
 *
 * 模型负责找表达（短语、熟词生义、影响理解的表达），这里负责：
 * 1) 解析前先给出「课标词候选」，收敛模型的选词范围；
 * 2) 解析后按规则复核：原文里没有的丢掉、功能词最多留一个、非课标最多留一个、最多 5 项。
 */
import type { VocabEntry } from '../shared/types';
import { isHardBasic, isSoftBasic, lemma, matchCurriculum, normalizeTerm } from './curriculum';

/**
 * 从文章里挑出「课标词候选」，交给模型作为选词范围。
 * 只做规则，不调用模型；顺序按教学价值粗排。
 */
export function extractCandidates(text: string, limit = 30): string[] {
  const seen = new Map<string, { surface: string; count: number; level: string; first: number }>();
  const pattern = /[A-Za-z][A-Za-z'’-]*/g;
  let match: RegExpExecArray | null;
  let position = 0;

  while ((match = pattern.exec(text)) !== null) {
    const surface = match[0];
    const key = normalizeTerm(surface);
    if (!key || key.length < 5) continue;
    if (key.includes(' ') || isHardBasic(key) || isSoftBasic(key)) continue;
    // 普通专有名称不作为训练重点：只在文中以大写出现过的，跳过
    if (/^[A-Z]/.test(surface) && !text.includes(` ${key} `)) continue;
    const hit = matchCurriculum(key);
    if (!hit.hit) continue;
    const prev = seen.get(hit.key);
    if (prev) {
      prev.count += 1;
    } else {
      seen.set(hit.key, { surface, count: 1, level: hit.level, first: position });
    }
    position += 1;
  }

  return [...seen.values()]
    .map((item) => ({
      ...item,
      score:
        (item.level === '**' ? 3 : item.level ? 2 : 0) +
        (item.surface.length >= 9 ? 3 : item.surface.length >= 7 ? 2 : 1) +
        (item.count > 1 ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.first - b.first)
    .slice(0, limit)
    .map((item) => item.surface);
}

export interface RefineResult {
  items: VocabEntry[];
  /** 被筛掉或合并掉的词，写进 issues 便于教师核对 */
  dropped: string[];
}

const MAX_VOCAB = 5;

/**
 * 按课标规则给模型给的词汇做二次筛选：
 * 1. 原文里没出现的一律丢（防编造）；
 * 2. 短语整体保留（短语是模型的活）；
 * 3. 课标词保留；过于简单的功能词最多留一个（当作熟词生义）；
 * 4. 非课标单词最多留一个（要求确实影响理解）；
 * 5. 屈折形式归组、重复的去重，最多 5 项。
 */
export function refineVocab(items: VocabEntry[], text: string): RefineResult {
  const haystack = ` ${normalizeTerm(text)} `;
  const kept: VocabEntry[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  let basicUsed = 0;
  let offListUsed = 0;

  for (const item of items) {
    const term = String(item.term ?? '').trim();
    if (!term) continue;
    const key = normalizeTerm(term);
    if (!key) continue;

    const dedupeKey = `${lemma(key)}|${String(item.meaning ?? '').slice(0, 8)}`;
    if (seen.has(dedupeKey)) {
      dropped.push(`${term}（重复）`);
      continue;
    }

    // 原文里必须有这个表达（短语允许被拆开加词，所以退一步按首个词判）
    const firstWord = key.split(' ')[0];
    if (!haystack.includes(` ${key} `) && !haystack.includes(` ${firstWord} `)) {
      dropped.push(`${term}（原文未见）`);
      continue;
    }

    const isPhrase = key.includes(' ');
    const hit = matchCurriculum(key);

    if (!isPhrase) {
      if (isHardBasic(key)) {
        dropped.push(`${term}（功能词）`);
        continue;
      }
      if (!hit.hit) {
        if (offListUsed >= 1) {
          dropped.push(`${term}（非课标）`);
          continue;
        }
        offListUsed += 1;
      } else if (isSoftBasic(key)) {
        if (basicUsed >= 1) {
          dropped.push(`${term}（过于简单）`);
          continue;
        }
        basicUsed += 1;
      }
    }

    seen.add(dedupeKey);
    kept.push(item);
    if (kept.length >= MAX_VOCAB) break;
  }

  return { items: kept, dropped };
}
