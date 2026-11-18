import { app } from 'electron';
import path from 'node:path';
import { MAX_COLLOCATION_CHARS } from '../shared/constants';
import { isRecord } from './errors';
import { readJsonFile, writeJsonAtomic } from './storage/jsonFile';

const FILE_VERSION = 1;

interface PersistedShape {
  v: number;
  units: Record<string, Record<string, string>>;
}

/** 单元标识只保留安全字符，避免把用户输入直接当键写进文件。 */
export function unitKeyOf(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) : '';
}

function cleanText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_COLLOCATION_CHARS)
    : '';
}

/**
 * 教材词汇的固定搭配：按「单元 → 序号」落盘到 userData/collocations.json。
 * 只存补出来的搭配，教材原始词表仍在渲染层的 vocab.json 里，互不影响。
 */
export class CollocationStore {
  private units: Record<string, Record<string, string>> = {};
  private loaded = false;
  private file = '';

  init(): void {
    this.file = path.join(app.getPath('userData'), 'collocations.json');
  }

  private async ensure(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const data = await readJsonFile(this.file).catch(() => null);
    if (!isRecord(data) || data.v !== FILE_VERSION || !isRecord(data.units)) return;

    const units: Record<string, Record<string, string>> = {};
    for (const [unitId, value] of Object.entries(data.units)) {
      const key = unitKeyOf(unitId);
      if (!key || !isRecord(value)) continue;
      const map: Record<string, string> = {};
      for (const [order, text] of Object.entries(value)) {
        if (!/^\d{1,4}$/.test(order)) continue;
        const clean = cleanText(text);
        if (clean) map[order] = clean;
      }
      if (Object.keys(map).length) units[key] = map;
    }
    this.units = units;
  }

  async list(unitId: unknown): Promise<Record<string, string>> {
    await this.ensure();
    const key = unitKeyOf(unitId);
    return { ...(this.units[key] ?? {}) };
  }

  /** 批量合并识别结果：已有值优先保留（人工改过的不会被模型覆盖）。 */
  async merge(
    unitId: unknown,
    pairs: Array<{ order: number; collocation: string }>,
  ): Promise<{ map: Record<string, string>; applied: number }> {
    await this.ensure();
    const key = unitKeyOf(unitId);
    if (!key) return { map: {}, applied: 0 };

    const map = { ...(this.units[key] ?? {}) };
    let applied = 0;
    for (const pair of pairs) {
      const order = String(pair.order);
      const clean = cleanText(pair.collocation);
      if (!/^\d{1,4}$/.test(order) || !clean) continue;
      if (map[order]) continue;
      map[order] = clean;
      applied += 1;
    }
    if (!applied) return { map, applied: 0 };

    this.units = { ...this.units, [key]: map };
    await this.save();
    return { map: { ...map }, applied };
  }

  /** 手动编辑单个单元格；传入空字符串即清除。 */
  async set(unitId: unknown, order: number, text: string): Promise<Record<string, string>> {
    await this.ensure();
    const key = unitKeyOf(unitId);
    if (!key || !Number.isInteger(order) || order <= 0 || order > 999) return {};

    const map = { ...(this.units[key] ?? {}) };
    const clean = cleanText(text);
    if (clean) map[String(order)] = clean;
    else delete map[String(order)];

    if (Object.keys(map).length) this.units = { ...this.units, [key]: map };
    else {
      const next = { ...this.units };
      delete next[key];
      this.units = next;
    }
    await this.save();
    return { ...map };
  }

  private async save(): Promise<void> {
    const payload: PersistedShape = { v: FILE_VERSION, units: this.units };
    await writeJsonAtomic(this.file, payload);
  }
}
