import { app } from 'electron';
import path from 'node:path';
import { MAX_MY_VOCAB } from '../shared/constants';
import type { MyVocabEntry, MyVocabInput } from '../shared/types';
import { isRecord } from './errors';
import { readJsonFile, writeJsonAtomic } from './storage/jsonFile';

const FILE_VERSION = 1;

function filePath(): string {
  return path.join(app.getPath('userData'), 'my-vocab.json');
}

function str(value: unknown, max = 400): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** 音标统一存不带斜杠的形式，界面上统一加 / /，避免出现 //teɪk//。 */
function ipa(value: unknown): string {
  return str(value, 120).replace(/^\/+|\/+$/g, '').trim();
}

/** 去重键：同一个词不重复收藏，短语按空格归一。 */
function keyOf(term: string): string {
  return term.toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalize(raw: unknown): MyVocabEntry | null {
  if (!isRecord(raw)) return null;
  const term = str(raw.term, 120);
  const meaning = str(raw.meaning, 400);
  if (!term || !meaning) return null;
  const origin = raw.origin === 'analysis' || raw.origin === 'textbook' ? raw.origin : 'manual';
  const now = new Date().toISOString();
  return {
    id: str(raw.id, 60) || `mv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    term,
    phonetic: ipa(raw.phonetic),
    pos: str(raw.pos, 40),
    meaning,
    collocation: str(raw.collocation, 300),
    origin,
    source: str(raw.source, 120),
    createdAt: str(raw.createdAt, 40) || now,
    updatedAt: str(raw.updatedAt, 40) || now,
  };
}

export class MyVocabStore {
  private cache: MyVocabEntry[] | null = null;

  private async load(): Promise<MyVocabEntry[]> {
    if (this.cache) return this.cache;
    const raw = await readJsonFile(filePath()).catch(() => null);
    const list = isRecord(raw) && Array.isArray(raw.items) ? raw.items : [];
    this.cache = list.flatMap((item) => {
      const entry = normalize(item);
      return entry ? [entry] : [];
    });
    return this.cache;
  }

  private async persist(items: MyVocabEntry[]): Promise<void> {
    this.cache = items.slice(0, MAX_MY_VOCAB);
    await writeJsonAtomic(filePath(), { v: FILE_VERSION, items: this.cache });
  }

  async list(): Promise<MyVocabEntry[]> {
    return [...(await this.load())];
  }

  /** 批量收藏：已存在的词沿用旧记录，只补空字段，不覆盖教师改过的释义。 */
  async add(inputs: MyVocabInput[], defaultSource = ''): Promise<MyVocabEntry[]> {
    const items = await this.load();
    const index = new Map(items.map((item) => [keyOf(item.term), item]));
    const result: MyVocabEntry[] = [];

    for (const input of inputs) {
      const term = str(input.term, 120);
      const meaning = str(input.meaning, 400);
      if (!term || !meaning) continue;
      const existed = index.get(keyOf(term));
      if (existed) {
        if (!existed.phonetic && input.phonetic) existed.phonetic = ipa(input.phonetic);
        if (!existed.collocation && input.collocation) existed.collocation = str(input.collocation, 300);
        existed.updatedAt = new Date().toISOString();
        result.push(existed);
        continue;
      }
      const entry = normalize({
        ...input,
        source: input.source || defaultSource,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      if (!entry) continue;
      index.set(keyOf(entry.term), entry);
      items.push(entry);
      result.push(entry);
    }

    await this.persist(items);
    return result;
  }

  async update(id: string, patch: Partial<MyVocabInput>): Promise<MyVocabEntry | null> {
    const items = await this.load();
    const target = items.find((item) => item.id === id);
    if (!target) return null;
    if (patch.term !== undefined) target.term = str(patch.term, 120) || target.term;
    if (patch.meaning !== undefined) target.meaning = str(patch.meaning, 400) || target.meaning;
    if (patch.phonetic !== undefined) target.phonetic = ipa(patch.phonetic);
    if (patch.pos !== undefined) target.pos = str(patch.pos, 40);
    if (patch.collocation !== undefined) target.collocation = str(patch.collocation, 300);
    target.updatedAt = new Date().toISOString();
    await this.persist(items);
    return target;
  }

  async remove(ids: string[]): Promise<MyVocabEntry[]> {
    const items = await this.load();
    const drop = new Set(ids);
    const kept = items.filter((item) => !drop.has(item.id));
    await this.persist(kept);
    return [...kept];
  }

  async clear(): Promise<void> {
    await this.persist([]);
  }
}
