import { app } from 'electron';
import path from 'node:path';
import { MAX_HISTORY_ITEMS, type AnalysisBlock } from '../shared/constants';
import type { AnalysisInput, AnalysisPayload, HistoryEntry, HistorySummary, Section } from '../shared/types';
import { isRecord } from './errors';
import { parseDiscourse, parseQuestions, parseSentences, parseVocab } from './parse';
import { readJsonFile, writeJsonAtomic } from './storage/jsonFile';

/** 0.4 及更早版本的四段文本标题，仅用于把旧留档转成只读卡片。 */
const LEGACY_TITLES = ['文章大意', '重点词汇', '长难句', '教学提示'];

function normalizeInput(raw: unknown): AnalysisInput | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.text !== 'string' || !raw.text.trim()) return null;
  return { text: raw.text };
}

function normalizeLegacySections(raw: unknown): Section[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined;
  const sections: Section[] = [];
  raw.forEach((item, index) => {
    if (!isRecord(item) || typeof item.text !== 'string' || !item.text.trim()) return;
    sections.push({
      id: typeof item.id === 'string' ? item.id : `legacy-${index}`,
      title: typeof item.title === 'string' && item.title ? item.title : (LEGACY_TITLES[index] ?? `第 ${index + 1} 部分`),
      text: item.text,
    });
  });
  return sections.length ? sections : undefined;
}

/** 逐板块容错：某一板块坏了就丢掉，其余板块照常回放。 */
function normalizePayload(raw: unknown): AnalysisPayload | null {
  if (!isRecord(raw)) return null;
  const payload: AnalysisPayload = {};

  const discourse = parseDiscourse(raw.discourse);
  if (discourse.value !== null) payload.discourse = discourse.value;
  const questions = parseQuestions(raw.questions);
  if (questions.value !== null) payload.questions = questions.value;
  const vocab = parseVocab(raw.vocab);
  if (vocab.value !== null) payload.vocab = vocab.value;
  const sentences = parseSentences(raw.sentences);
  if (sentences.value !== null) payload.sentences = sentences.value;

  if (isRecord(raw.exercise) && Array.isArray(raw.exercise.items) && raw.exercise.items.length) {
    const difficulty = raw.exercise.difficulty;
    payload.exercise =
      difficulty === 'easy' || difficulty === 'medium' || difficulty === 'hard'
        ? {
            difficulty,
            items: raw.exercise.items.flatMap((item, index) => {
              if (!isRecord(item)) return [];
              const prompt = typeof item.prompt === 'string' ? item.prompt : '';
              const answer = typeof item.answer === 'string' ? item.answer : '';
              if (!prompt || !answer) return [];
              return [
                {
                  id: typeof item.id === 'string' && item.id ? item.id : `E${index + 1}`,
                  targetId: typeof item.targetId === 'string' ? item.targetId : '',
                  target: typeof item.target === 'string' ? item.target : '',
                  kind: typeof item.kind === 'string' ? item.kind : '练习',
                  prompt,
                  answer,
                  explain: typeof item.explain === 'string' ? item.explain : '',
                },
              ];
            }),
            completedAt: typeof raw.exercise.completedAt === 'string' ? raw.exercise.completedAt : new Date().toISOString(),
            model: typeof raw.exercise.model === 'string' ? raw.exercise.model : '',
          }
        : null;
  }

  const legacy = normalizeLegacySections(raw.legacy);
  if (legacy) payload.legacy = legacy;

  // 校验提示与生成留档：回看历史时也能看到「当时为什么缺这一块」
  if (Array.isArray(raw.issues)) {
    const issues = raw.issues.filter((item): item is string => typeof item === 'string' && Boolean(item));
    if (issues.length) payload.issues = issues.slice(0, 16);
  }
  if (Array.isArray(raw.trace)) {
    const trace = raw.trace.flatMap((item) => {
      if (!isRecord(item) || typeof item.label !== 'string' || !item.label) return [];
      return [
        {
          label: item.label,
          block: typeof item.block === 'string' ? (item.block as AnalysisBlock) : undefined,
          ms: typeof item.ms === 'number' && Number.isFinite(item.ms) ? item.ms : 0,
          finish: typeof item.finish === 'string' ? item.finish : '',
          chars: typeof item.chars === 'number' && Number.isFinite(item.chars) ? item.chars : 0,
          ok: item.ok === true,
          note: typeof item.note === 'string' ? item.note : '',
        },
      ];
    });
    if (trace.length) payload.trace = trace.slice(0, 12);
  }

  const hasContent =
    Boolean(payload.discourse) ||
    Boolean(payload.questions?.length) ||
    Boolean(payload.vocab?.length) ||
    Boolean(payload.sentences?.length) ||
    Boolean(payload.legacy?.length);
  return hasContent ? payload : null;
}

function normalizeMissing(raw: unknown): AnalysisBlock[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const allowed: AnalysisBlock[] = ['discourse', 'questions', 'vocab', 'sentences'];
  const list = raw.filter((item): item is AnalysisBlock => allowed.includes(item as AnalysisBlock));
  return list.length ? list : undefined;
}

function normalizeEntry(raw: unknown): HistoryEntry | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (typeof raw.createdAt !== 'string' || !raw.createdAt) return null;
  const input = normalizeInput(raw.input);
  if (!input) return null;

  // v1 留档：内容直接是 sections，转成只读 legacy 板块
  const payload = normalizePayload(isRecord(raw.payload) ? raw.payload : { legacy: raw.sections });
  if (!payload) return null;

  return {
    id: raw.id,
    createdAt: raw.createdAt,
    input,
    payload,
    model: typeof raw.model === 'string' ? raw.model : '',
    source: raw.source === 'demo' ? 'demo' : 'api',
    ...(normalizeMissing(raw.missing) ? { missing: normalizeMissing(raw.missing) } : {}),
  };
}

function excerptOf(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 90);
}

/** 历史记录：单一 JSON 文件，最多 200 条，写入串行化避免互相覆盖。 */
export class HistoryStore {
  private file = '';
  private items: HistoryEntry[] | null = null;
  private queue: Promise<void> = Promise.resolve();

  init(): void {
    this.file = path.join(app.getPath('userData'), 'history.json');
  }

  private async load(): Promise<HistoryEntry[]> {
    if (this.items) return this.items;
    const data = await readJsonFile(this.file);
    const items: HistoryEntry[] = [];
    if (isRecord(data) && Array.isArray(data.items)) {
      for (const raw of data.items) {
        const entry = normalizeEntry(raw);
        if (entry) items.push(entry);
      }
    }
    this.items = items;
    return items;
  }

  private persist(): Promise<void> {
    const snapshot = { v: 2, items: this.items ?? [] };
    this.queue = this.queue.catch(() => undefined).then(() => writeJsonAtomic(this.file, snapshot));
    return this.queue;
  }

  async add(entry: HistoryEntry): Promise<void> {
    const items = await this.load();
    // 同一 requestId 重复写入时替换旧记录
    const existIndex = items.findIndex((item) => item.id === entry.id);
    if (existIndex >= 0) items.splice(existIndex, 1);
    items.unshift(entry);
    if (items.length > MAX_HISTORY_ITEMS) items.length = MAX_HISTORY_ITEMS;
    this.items = items;
    await this.persist();
  }

  async summaries(): Promise<HistorySummary[]> {
    const items = await this.load();
    return items.map((item) => ({
      id: item.id,
      createdAt: item.createdAt,
      model: item.model,
      source: item.source,
      excerpt: excerptOf(item.input.text),
      charCount: item.input.text.length,
      counts: {
        questions: item.payload.questions?.length ?? 0,
        vocab: item.payload.vocab?.length ?? 0,
        sentences: item.payload.sentences?.length ?? 0,
        hasExercise: Boolean(item.payload.exercise?.items.length),
      },
      ...(item.payload.legacy?.length ? { legacy: true } : {}),
    }));
  }

  async get(id: string): Promise<HistoryEntry | null> {
    const items = await this.load();
    return items.find((item) => item.id === id) ?? null;
  }

  async remove(id: string): Promise<HistorySummary[]> {
    const items = await this.load();
    this.items = items.filter((item) => item.id !== id);
    await this.persist();
    return this.summaries();
  }

  async clear(): Promise<void> {
    this.items = [];
    await this.persist();
  }
}
