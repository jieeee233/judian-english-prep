import { app } from 'electron';
import path from 'node:path';
import type { VocabPracticeItem } from '../shared/types';
import { isRecord } from './errors';
import { readJsonFile, writeJsonAtomic } from './storage/jsonFile';

/**
 * 单词练习的本地覆盖层。
 *
 * 教材词表自带 674 条练习，教师可以针对某个词改写或删除，
 * 也可以让 AI 生成新题。覆盖只存「改动过的词」：
 * - 键为教材词条序号（"3"）或我的词汇（"m:<id>"）
 * - 值存在即完全替换该词的内置练习；空数组表示「这个词现在没有题」
 * - 删除键表示回到教材内置
 *
 * 文件：userData/vocab-practice.json
 * 结构：{ v: 1, units: { bx1u1: { "3": [ {…练习…} ] } } }
 */

const FILE_VERSION = 1;
const MAX_ITEMS_PER_WORD = 8;
const MAX_UNITS = 200;

type UnitMap = Record<string, VocabPracticeItem[]>;

function filePath(): string {
  return path.join(app.getPath('userData'), 'vocab-practice.json');
}

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** 单选/语法填空都按同一套字段存，选择题多一个 options。 */
export function normalizeItem(raw: unknown, fallbackId: string): VocabPracticeItem | null {
  if (!isRecord(raw)) return null;
  const stem = str(raw.stem, 600);
  const answer = str(raw.answer, 200);
  if (!stem || !answer) return null;
  const options = Array.isArray(raw.options)
    ? raw.options
        .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
        .slice(0, 6)
        .map((item) => item.trim().slice(0, 160))
    : [];
  const type = str(raw.type, 20) || (options.length ? 'choice' : 'grammar');
  return {
    id: str(raw.id, 60) || fallbackId,
    type,
    point: str(raw.point, 40),
    stem,
    answer,
    hint: str(raw.hint, 80),
    explanation: str(raw.explanation, 400),
    options,
  };
}

function normalizeList(raw: unknown, seed: string): VocabPracticeItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_ITEMS_PER_WORD)
    .flatMap((item, index) => {
      const normalized = normalizeItem(item, `${seed}-${index + 1}`);
      return normalized ? [normalized] : [];
    });
}

export class VocabPracticeStore {
  private cache: Record<string, UnitMap> | null = null;

  private async load(): Promise<Record<string, UnitMap>> {
    if (this.cache) return this.cache;
    const raw = await readJsonFile(filePath()).catch(() => null);
    const units = isRecord(raw) && isRecord(raw.units) ? raw.units : {};
    const result: Record<string, UnitMap> = {};
    for (const [unitId, map] of Object.entries(units)) {
      if (!isRecord(map)) continue;
      const cleaned: UnitMap = {};
      for (const [key, list] of Object.entries(map)) {
        if (!/^(\d+|m:\S+)$/.test(key)) continue;
        if (!Array.isArray(list)) continue;
        cleaned[key] = normalizeList(list, `${unitId}-${key}`);
      }
      result[unitId] = cleaned;
    }
    this.cache = result;
    return result;
  }

  private async persist(units: Record<string, UnitMap>): Promise<void> {
    const keys = Object.keys(units);
    const trimmed: Record<string, UnitMap> = {};
    for (const key of keys.slice(-MAX_UNITS)) trimmed[key] = units[key];
    this.cache = trimmed;
    await writeJsonAtomic(filePath(), { v: FILE_VERSION, units: trimmed });
  }

  /** 某个单元的全部覆盖；返回的对象可直接按序号取。 */
  async list(unitId: string): Promise<UnitMap> {
    const units = await this.load();
    return { ...(units[unitId] ?? {}) };
  }

  /** 整表替换一组词的练习（AI 批量生成后一次落盘）。 */
  async saveMany(unitId: string, groups: { key: string; exercises: unknown }[]): Promise<UnitMap> {
    const units = await this.load();
    const map: UnitMap = { ...(units[unitId] ?? {}) };
    for (const group of groups) {
      const key = str(group.key, 80);
      if (!/^(\d+|m:\S+)$/.test(key)) continue;
      map[key] = normalizeList(group.exercises, `${unitId}-${key}`);
    }
    units[unitId] = map;
    await this.persist(units);
    return { ...map };
  }

  /** 删除某个词的覆盖，回到教材内置练习。 */
  async reset(unitId: string, key: string): Promise<UnitMap> {
    const units = await this.load();
    const map: UnitMap = { ...(units[unitId] ?? {}) };
    delete map[key];
    units[unitId] = map;
    await this.persist(units);
    return { ...map };
  }

  async clearUnit(unitId: string): Promise<UnitMap> {
    const units = await this.load();
    delete units[unitId];
    await this.persist(units);
    return {};
  }
}
