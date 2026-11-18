import type { AnalyzeProgress } from '../shared/types';
import type { DesktopApi } from '../shared/api';
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_SECONDS,
  DEFAULT_VISION_MODEL,
} from '../shared/constants';
import type { AnalysisResult, ExerciseSet, HistoryEntry, HistorySummary, MyVocabEntry } from '../shared/types';
import { buildDemoResult, SAMPLE_PASSAGE } from './demo';

/** 仅供 `vite` 浏览器预览使用：没有 Electron 时提供一套可点的假数据。 */
export function installMockBridge(): DesktopApi {
  const settings = {
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    visionModel: DEFAULT_VISION_MODEL,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    apiKey: '',
    hasKey: true,
    keyPersisted: true,
    encryptionAvailable: true,
  };

  const archive: AnalysisResult[] = [
    buildDemoResult({ text: SAMPLE_PASSAGE }),
    {
      ...buildDemoResult({ text: SAMPLE_PASSAGE.split('\n\n').slice(0, 2).join('\n\n') }),
      source: 'api',
      isSample: false,
      model: DEFAULT_MODEL,
    },
  ];

  const toEntry = (result: AnalysisResult, index: number): HistoryEntry => ({
    id: `preview-${index}`,
    createdAt: new Date(Date.now() - index * 86_400_000).toISOString(),
    input: result.input,
    payload: {
      discourse: result.discourse,
      questions: result.questions,
      vocab: result.vocab,
      sentences: result.sentences,
      exercise: result.exercise ?? null,
    },
    model: result.model,
    source: result.source,
  });

  const entries = archive.map(toEntry);
  let counter = 0;
  const listeners = new Set<(progress: AnalyzeProgress) => void>();

  const toSummary = (entry: HistoryEntry): HistorySummary => ({
    id: entry.id,
    createdAt: entry.createdAt,
    model: entry.model,
    source: entry.source,
    excerpt: entry.input.text.replace(/\s+/g, ' ').slice(0, 90),
    charCount: entry.input.text.length,
    counts: {
      questions: entry.payload.questions?.length ?? 0,
      vocab: entry.payload.vocab?.length ?? 0,
      sentences: entry.payload.sentences?.length ?? 0,
      hasExercise: Boolean(entry.payload.exercise?.items.length),
    },
  });

  const myVocab: MyVocabEntry[] = [];
  /** 预览模式下的固定搭配：unitId -> order -> 搭配 */
  const collocations: Record<string, Record<string, string>> = {};
  /** 预览模式下的练习覆盖：unitId -> key -> 练习 */
  const practice: Record<string, Record<string, import('../shared/types').VocabPracticeItem[]>> = {};

  const MOCK_ARTICLE = `The concept of elevation is relative. A hill is only a hill because the land around it is lower.

When we say a mountain is 2,000 metres high, we are not describing its height above sea level. We are describing the difference between its peak and the valley below it.

1. What does the author mean by "elevation is relative"?
A. Height is measured from the sea.
B. Height depends on the surrounding land.
C. Mountains are higher than hills.
D. Peaks are hard to measure.`;

  return {
    async getSettings() {
      return { ...settings };
    },
    async saveSettings(payload) {
      Object.assign(settings, { ...payload, hasKey: Boolean(payload.apiKey) || settings.hasKey });
      return { ok: true, persisted: true };
    },
    async clearSettings() {
      Object.assign(settings, { apiKey: '', hasKey: false });
      return { ok: true };
    },
    pathForFile() {
      // 浏览器预览拿不到真实路径，拖入时会被前端拦下并提示
      return '';
    },
    async analyze({ requestId, input }) {
      const steps = ['正在一次性生成四个板块（双层 JSON）…', '正在分步生成「重点词汇」（2/4）…'];
      for (const [index, text] of steps.entries()) {
        listeners.forEach((listener) => listener({ requestId, phase: 'combined', text, index, total: 4 }));
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      const result: AnalysisResult = {
        ...buildDemoResult(input),
        source: 'api',
        isSample: false,
        model: settings.model,
        requestId,
      };
      entries.unshift(toEntry(result, ++counter));
      return { ok: true, result };
    },
    onAnalyzeProgress(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    async cancelAnalysis() {
      return { ok: true };
    },
    async generatePractice({ requestId, input }) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      const items = [
        ...input.vocab.map((item, index) => ({
          id: `E${index + 1}`,
          targetId: item.id,
          target: item.term,
          kind: input.difficulty === 'easy' ? '选词填空' : '中译英',
          prompt:
            input.difficulty === 'easy'
              ? `Fill in the blank: The ____ was covered with notices.（${item.meaning.slice(0, 18)}）`
              : `用 ${item.term} 翻译：请结合文中含义写一句完整的英文句子。`,
          answer: `参考答案：需包含 ${item.term}，并体现「${item.meaning.slice(0, 24)}」的含义。`,
        })),
        ...input.sentences.map((item, index) => ({
          id: `E${input.vocab.length + index + 1}`,
          targetId: item.id,
          target: item.quote,
          kind: input.difficulty === 'hard' ? '长难句仿写' : '句子翻译',
          prompt: `翻译并说明结构：${item.quote}`,
          answer: `参考译文：${item.translation || '（演示内容未提供译文）'}`,
        })),
      ];
      const exercise: ExerciseSet = {
        difficulty: input.difficulty,
        items,
        completedAt: new Date().toISOString(),
        model: settings.model,
      };
      listeners.forEach((listener) =>
        listener({ requestId, phase: 'exercise', text: '练习已生成。', index: items.length, total: items.length }),
      );
      return { ok: true, exercise };
    },
    async copyText() {
      return { ok: true };
    },
    async listHistory() {
      return { ok: true, items: entries.map(toSummary) };
    },
    async getHistory(id) {
      const entry = entries.find((item) => item.id === id);
      return entry ? { ok: true, entry } : { ok: false, code: 'STORAGE', message: '记录不存在。' };
    },
    async removeHistory(id) {
      const index = entries.findIndex((item) => item.id === id);
      if (index >= 0) entries.splice(index, 1);
      return { ok: true, items: entries.map(toSummary) };
    },
    async clearHistory() {
      entries.length = 0;
      return { ok: true };
    },
    async exportLesson(payload) {
      return { ok: true, filePath: `（浏览器预览）已生成 ${payload.format} 演示文件` };
    },
    async exportWordSheet(payload) {
      void payload;
      return { ok: true, filePath: '', canceled: true };
    },
    async exportDemo(payload) {
      return { ok: true, filePath: `（浏览器预览）已生成 ${payload.items.length} 个词条的演示文件` };
    },
    async listMyVocab() {
      return { ok: true, items: myVocab };
    },
    async addMyVocab({ items, source }) {
      for (const input of items) {
        const existed = myVocab.find((item) => item.term.toLowerCase() === input.term.toLowerCase());
        if (existed) {
          if (!existed.phonetic && input.phonetic) existed.phonetic = input.phonetic;
          continue;
        }
        const now = new Date().toISOString();
        myVocab.push({
          id: `mv-${myVocab.length + 1}`,
          term: input.term,
          meaning: input.meaning,
          phonetic: input.phonetic ?? '',
          pos: input.pos ?? '',
          collocation: input.collocation ?? '',
          origin: input.origin ?? 'analysis',
          source: input.source || source || '',
          createdAt: now,
          updatedAt: now,
        });
      }
      return { ok: true, items: [...myVocab] };
    },
    async updateMyVocab({ id, patch }) {
      const target = myVocab.find((item) => item.id === id);
      if (!target) return { ok: false, code: 'STORAGE', message: '词条不存在。' };
      Object.assign(target, patch, { updatedAt: new Date().toISOString() });
      return { ok: true, item: target };
    },
    async removeMyVocab(ids) {
      const drop = new Set(ids);
      for (let i = myVocab.length - 1; i >= 0; i -= 1) {
        if (drop.has(myVocab[i].id)) myVocab.splice(i, 1);
      }
      return { ok: true, items: [...myVocab] };
    },
    async extractCollocations({ unit, words, aim }) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      const map = (collocations[unit.id] ??= {});
      const picked = words.slice(0, 8);
      let applied = 0;
      const pairs = picked.map((word) => {
        const collocation = map[String(word.order)] ?? `${word.word} sth. 与…搭配（预览示例）`;
        if (!map[String(word.order)]) {
          map[String(word.order)] = collocation;
          applied += 1;
        }
        return { order: word.order, word: word.word, collocation };
      });
      return {
        ok: true as const,
        pairs,
        model: aim === 'photo' ? settings.visionModel : settings.model,
        via: aim === 'photo' ? ('vision' as const) : ('text' as const),
        sourceLabel: aim === 'photo' ? '预览图片.jpg' : '粘贴文本',
        applied,
      };
    },
    async listCollocations(unitId) {
      return { ok: true as const, unitId, map: { ...(collocations[unitId] ?? {}) } };
    },
    async setCollocation({ unitId, order, text }) {
      const map = (collocations[unitId] ??= {});
      if (text.trim()) map[String(order)] = text.trim();
      else delete map[String(order)];
      return { ok: true as const, unitId, map: { ...map } };
    },
    async importArticle({ aim }) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return {
        ok: true as const,
        text: MOCK_ARTICLE,
        sourceLabel: aim === 'photo' ? 'dsc_0001.jpg（预览示例）' : 'unit3.docx（预览示例）',
        via: aim === 'photo' ? ('vision' as const) : ('text' as const),
        imageCount: aim === 'photo' ? 1 : 0,
      };
    },
    async listVocabPractice(unitId) {
      return { ok: true as const, unitId, map: { ...(practice[unitId] ?? {}) } };
    },
    async saveVocabPractice({ unitId, groups }) {
      const map = (practice[unitId] ??= {});
      for (const group of groups) map[group.key] = group.exercises;
      return { ok: true as const, unitId, map: { ...map } };
    },
    async resetVocabPractice({ unitId, key }) {
      const map = (practice[unitId] ??= {});
      delete map[key];
      return { ok: true as const, unitId, map: { ...map } };
    },
    async generateVocabPractice({ words, style, count }) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const groups = words.map((word) => ({
        word: word.word,
        exercises: Array.from({ length: Math.min(2, count) }, (_, index) => {
          const pattern = word.collocations[0]?.pattern ?? '';
          const isChoice = style === 'choice' || (style === 'mixed' && index % 2 === 0);
          const answer = pattern || word.word;
          return {
            id: `mock-${word.word}-${index + 1}`,
            type: isChoice ? 'choice' : 'grammar',
            point: pattern ? '固定搭配' : '词义辨析',
            stem: isChoice
              ? `${word.word} 的常见搭配是 ______（预览示例题）`
              : `${word.word} 的搭配填空 ______（预览示例题）`,
            answer,
            hint: '',
            explanation: pattern ? `教材搭配：${pattern}` : `释义：${word.meaning}`,
            options: isChoice ? [answer, 'about', 'for', 'with'].filter((item, i, all) => all.indexOf(item) === i) : [],
          };
        }),
      }));
      return { ok: true as const, groups, model: 'preview', issues: [] };
    },
    async appInfo() {
      return {
        version: '0.5.0-preview',
        electron: '浏览器预览',
        platform: 'web',
        dataDir: '（预览模式无本地数据目录）',
      };
    },
  };
}
