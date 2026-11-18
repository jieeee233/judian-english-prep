import { app, BrowserWindow, clipboard, ipcMain, net, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '../shared/api';
import { MAX_CLIPBOARD_CHARS, MAX_COLLOCATION_CHARS, MAX_MY_VOCAB, REQUEST_ID_PATTERN } from '../shared/constants';
import { importArticle } from './article-import';
import { extractCollocations } from './collocation-service';
import type { CollocationStore } from './collocations';
import { fail } from './errors';
import { exportDemo, exportLesson, exportWordSheet } from './export/service';
import type { HistoryStore } from './history';
import type { MyVocabStore } from './myvocab';
import type { AnalysisRunner } from './runner';
import type { SettingsStore } from './settings';
import type { VocabPracticeStore } from './vocabPractice';
import { generateWordPractice } from './vocabPracticeService';

export interface IpcDeps {
  settings: SettingsStore;
  history: HistoryStore;
  myVocab: MyVocabStore;
  collocations: CollocationStore;
  vocabPractice: VocabPracticeStore;
  runner: AnalysisRunner;
  isTrustedWindow: (windowId: number) => boolean;
}

/** 只接受来自我们创建的窗口主框架的调用，挡掉 iframe / 其它 webContents。 */
function assertTrusted(event: IpcMainInvokeEvent, deps: IpcDeps): number {
  const windowId = event.sender.id;
  if (!deps.isTrustedWindow(windowId) || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('不允许的窗口操作。');
  }
  return windowId;
}

const done = { ok: true } as const;

/** 版本号由构建期注入（见 vite.main.config.ts），保证任何启动方式都显示应用版本。 */
declare const __APP_VERSION__: string;

function resolveVersion(): string {
  if (typeof __APP_VERSION__ === 'string' && __APP_VERSION__) return __APP_VERSION__;
  return app.getVersion();
}

export function registerIpc(deps: IpcDeps): void {
  const { settings, history, myVocab, collocations, vocabPractice, runner } = deps;

  ipcMain.handle(IPC.settingsGet, (event) => {
    assertTrusted(event, deps);
    return settings.view();
  });

  ipcMain.handle(IPC.settingsSave, async (event, payload: unknown) => {
    const windowId = assertTrusted(event, deps);
    if (runner.isBusy(windowId)) {
      return fail('BUSY', '请先等待或取消当前解析，再修改 API 设置。');
    }
    const validated = settings.validate(payload);
    if (!validated.ok) return fail('VALIDATION', validated.message);
    try {
      const { persisted } = await settings.save(validated.value);
      return { ok: true, persisted };
    } catch {
      return fail('STORAGE', '设置写入失败，请检查磁盘权限后重试。');
    }
  });

  ipcMain.handle(IPC.settingsClear, async (event) => {
    const windowId = assertTrusted(event, deps);
    if (runner.isBusy(windowId)) {
      return fail('BUSY', '请先等待或取消当前解析，再清除设置。');
    }
    try {
      await settings.clear();
      return done;
    } catch {
      return fail('STORAGE', '清除设置失败，请重试。');
    }
  });

  ipcMain.handle(IPC.analyze, async (event, payload: unknown) => {
    const windowId = assertTrusted(event, deps);
    const result = await runner.run(windowId, payload, settings.connection, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.analyzeProgress, progress);
    });
    if (result.ok) {
      const { input, discourse, questions, vocab, sentences, exercise, issues, trace, missing, model, source } =
        result.result;
      // 历史写入失败不影响本次解析结果
      await history
        .add({
          id: result.result.requestId,
          createdAt: result.result.completedAt,
          input,
          payload: { discourse, questions, vocab, sentences, exercise: exercise ?? null, issues, trace },
          model,
          source,
          missing,
        })
        .catch(() => undefined);
    }
    return result;
  });

  ipcMain.handle(IPC.practice, async (event, payload: unknown) => {
    const windowId = assertTrusted(event, deps);
    const result = await runner.practice(windowId, payload, settings.connection, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.analyzeProgress, progress);
    });
    return result;
  });

  ipcMain.handle(IPC.cancel, (event, requestId: unknown) => {
    const windowId = assertTrusted(event, deps);
    if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
      return fail('VALIDATION', '取消请求标识无效。');
    }
    runner.cancel(windowId, requestId);
    return done;
  });

  ipcMain.handle(IPC.clipboardWrite, (event, text: unknown) => {
    assertTrusted(event, deps);
    if (typeof text !== 'string' || !text || text.length > MAX_CLIPBOARD_CHARS) {
      return fail('VALIDATION', '复制内容无效。');
    }
    try {
      clipboard.writeText(text);
      return done;
    } catch {
      return fail('INTERNAL', '无法写入剪贴板，请手动选择并复制结果。');
    }
  });

  ipcMain.handle(IPC.historyList, async (event) => {
    assertTrusted(event, deps);
    try {
      return { ok: true, items: await history.summaries() };
    } catch {
      return fail('STORAGE', '读取历史记录失败，请检查磁盘权限。');
    }
  });

  ipcMain.handle(IPC.historyGet, async (event, id: unknown) => {
    assertTrusted(event, deps);
    if (typeof id !== 'string' || !id) return fail('VALIDATION', '记录标识无效。');
    const entry = await history.get(id).catch(() => null);
    if (!entry) return fail('STORAGE', '记录不存在或已被删除。');
    return { ok: true, entry };
  });

  ipcMain.handle(IPC.historyRemove, async (event, id: unknown) => {
    assertTrusted(event, deps);
    if (typeof id !== 'string' || !id) return fail('VALIDATION', '记录标识无效。');
    try {
      return { ok: true, items: await history.remove(id) };
    } catch {
      return fail('STORAGE', '删除记录失败，请重试。');
    }
  });

  ipcMain.handle(IPC.historyClear, async (event) => {
    assertTrusted(event, deps);
    try {
      await history.clear();
      return done;
    } catch {
      return fail('STORAGE', '清空历史记录失败，请重试。');
    }
  });

  ipcMain.handle(IPC.exportLesson, async (event, payload: unknown) => {
    assertTrusted(event, deps);
    const window = BrowserWindow.fromWebContents(event.sender);
    return exportLesson(window, payload);
  });

  ipcMain.handle(IPC.demoExport, (event, payload: unknown) => {
    assertTrusted(event, deps);
    const window = BrowserWindow.fromId(event.sender.id) ?? undefined;
    return exportDemo(payload, window);
  });

  ipcMain.handle(IPC.wordSheetExport, (event, payload: unknown) => {
    assertTrusted(event, deps);
    const window = BrowserWindow.fromId(event.sender.id) ?? undefined;
    return exportWordSheet(payload, window);
  });

  ipcMain.handle(IPC.myVocabList, async (event) => {
    assertTrusted(event, deps);
    return { ok: true as const, items: await myVocab.list() };
  });

  ipcMain.handle(IPC.myVocabAdd, async (event, payload: unknown) => {
    assertTrusted(event, deps);
    if (!payload || typeof payload !== 'object') return fail('VALIDATION', '收藏参数无效。');
    const { items, source } = payload as { items?: unknown; source?: unknown };
    if (!Array.isArray(items) || !items.length) return fail('VALIDATION', '没有要收藏的词汇。');
    if (items.length > 200) return fail('VALIDATION', '一次最多收藏 200 个词汇。');
    const clean = items.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const { term, meaning, phonetic, pos, collocation, origin } = item as Record<string, unknown>;
      if (typeof term !== 'string' || !term.trim()) return [];
      if (typeof meaning !== 'string' || !meaning.trim()) return [];
      return [
        {
          term,
          meaning,
          phonetic: typeof phonetic === 'string' ? phonetic : '',
          pos: typeof pos === 'string' ? pos : '',
          collocation: typeof collocation === 'string' ? collocation : '',
          source: typeof source === 'string' ? source.slice(0, 120) : '',
          origin: (origin === 'textbook' || origin === 'manual' ? origin : 'analysis') as 'analysis' | 'textbook' | 'manual',
        },
      ];
    });
    if (!clean.length) return fail('VALIDATION', '没有有效词汇可收藏。');
    return { ok: true as const, items: await myVocab.add(clean) };
  });

  ipcMain.handle(IPC.myVocabUpdate, async (event, payload: unknown) => {
    assertTrusted(event, deps);
    if (!payload || typeof payload !== 'object') return fail('VALIDATION', '修改参数无效。');
    const { id, patch } = payload as { id?: unknown; patch?: unknown };
    if (typeof id !== 'string' || !id) return fail('VALIDATION', '修改参数无效。');
    if (!patch || typeof patch !== 'object') return fail('VALIDATION', '修改内容无效。');
    const source = patch as Record<string, unknown>;
    const item = await myVocab.update(id, {
      term: typeof source.term === 'string' ? source.term : undefined,
      meaning: typeof source.meaning === 'string' ? source.meaning : undefined,
      phonetic: typeof source.phonetic === 'string' ? source.phonetic : undefined,
      pos: typeof source.pos === 'string' ? source.pos : undefined,
      collocation: typeof source.collocation === 'string' ? source.collocation : undefined,
    });
    if (!item) return fail('VALIDATION', '这个词条已不存在，请刷新后重试。');
    return { ok: true as const, item };
  });

  ipcMain.handle(IPC.myVocabRemove, async (event, ids: unknown) => {
    assertTrusted(event, deps);
    if (!Array.isArray(ids) || !ids.length) return fail('VALIDATION', '请先选择要删除的词条。');
    if (ids.length > MAX_MY_VOCAB) return fail('VALIDATION', '一次删除的词条过多。');
    const clean = ids.filter((id): id is string => typeof id === 'string' && Boolean(id));
    return { ok: true as const, items: await myVocab.remove(clean) };
  });

  ipcMain.handle(IPC.collocationExtract, async (event, payload: unknown) => {
    assertTrusted(event, deps);
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    return extractCollocations({
      raw: payload,
      connection: settings.connection,
      store: collocations,
      window,
      fetch: (url, init) => net.fetch(url, init),
    });
  });

  ipcMain.handle(IPC.collocationList, async (event, unitId: unknown) => {
    assertTrusted(event, deps);
    if (typeof unitId !== 'string' || !unitId) return fail('VALIDATION', '单元标识无效。');
    try {
      return { ok: true as const, unitId, map: await collocations.list(unitId) };
    } catch {
      return fail('STORAGE', '读取固定搭配失败，请检查磁盘权限。');
    }
  });

  ipcMain.handle(IPC.collocationSet, async (event, payload: unknown) => {
    assertTrusted(event, deps);
    if (!payload || typeof payload !== 'object') return fail('VALIDATION', '参数无效。');
    const { unitId, order, text } = payload as { unitId?: unknown; order?: unknown; text?: unknown };
    if (typeof unitId !== 'string' || !unitId) return fail('VALIDATION', '单元标识无效。');
    if (typeof order !== 'number' || !Number.isInteger(order) || order <= 0 || order > 999) {
      return fail('VALIDATION', '词条序号无效。');
    }
    if (typeof text !== 'string' || text.length > MAX_COLLOCATION_CHARS) {
      return fail('VALIDATION', `搭配内容不能超过 ${MAX_COLLOCATION_CHARS} 字。`);
    }
    try {
      return { ok: true as const, unitId, map: await collocations.set(unitId, order, text) };
    } catch {
      return fail('STORAGE', '保存固定搭配失败，请重试。');
    }
  });

  ipcMain.handle(IPC.articleImport, async (event, payload: unknown) => {
    assertTrusted(event, deps);
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    return importArticle({
      raw: payload,
      connection: settings.connection,
      window,
      fetch: (url, init) => net.fetch(url, init),
    });
  });

  ipcMain.handle(IPC.practiceVocabList, async (event, unitId: unknown) => {
    assertTrusted(event, deps);
    if (typeof unitId !== 'string' || !unitId) return fail('VALIDATION', '单元标识无效。');
    try {
      return { ok: true as const, unitId, map: await vocabPractice.list(unitId) };
    } catch {
      return fail('STORAGE', '读取练习失败，请检查磁盘权限。');
    }
  });

  ipcMain.handle(IPC.practiceVocabSave, async (event, payload: unknown) => {
    assertTrusted(event, deps);
    if (!payload || typeof payload !== 'object') return fail('VALIDATION', '参数无效。');
    const { unitId, groups } = payload as { unitId?: unknown; groups?: unknown };
    if (typeof unitId !== 'string' || !unitId) return fail('VALIDATION', '单元标识无效。');
    if (!Array.isArray(groups) || !groups.length) return fail('VALIDATION', '没有要保存的练习。');
    if (groups.length > 120) return fail('VALIDATION', '一次保存的词条过多。');
    const clean = groups.flatMap((group) => {
      if (!group || typeof group !== 'object') return [];
      const { key, exercises } = group as { key?: unknown; exercises?: unknown };
      if (typeof key !== 'string' || !key) return [];
      if (!Array.isArray(exercises)) return [];
      return [{ key, exercises }];
    });
    if (!clean.length) return fail('VALIDATION', '没有要保存的练习。');
    try {
      return { ok: true as const, unitId, map: await vocabPractice.saveMany(unitId, clean) };
    } catch {
      return fail('STORAGE', '保存练习失败，请重试。');
    }
  });

  ipcMain.handle(IPC.practiceVocabReset, async (event, payload: unknown) => {
    assertTrusted(event, deps);
    if (!payload || typeof payload !== 'object') return fail('VALIDATION', '参数无效。');
    const { unitId, key } = payload as { unitId?: unknown; key?: unknown };
    if (typeof unitId !== 'string' || !unitId) return fail('VALIDATION', '单元标识无效。');
    if (typeof key !== 'string' || !key) return fail('VALIDATION', '词条标识无效。');
    try {
      return { ok: true as const, unitId, map: await vocabPractice.reset(unitId, key) };
    } catch {
      return fail('STORAGE', '恢复内置练习失败，请重试。');
    }
  });

  ipcMain.handle(IPC.practiceVocabGenerate, async (event, payload: unknown) => {
    assertTrusted(event, deps);
    if (!settings.connection.apiKey) {
      return fail('NOT_CONFIGURED', '请先在 API 设置中输入并保存密钥。');
    }
    return generateWordPractice({
      raw: payload,
      connection: settings.connection,
      fetch: (url, init) => net.fetch(url, init),
    });
  });

  ipcMain.handle(IPC.appInfo, (event) => {
    assertTrusted(event, deps);
    return {
      version: resolveVersion(),
      electron: process.versions.electron,
      platform: process.platform,
      dataDir: app.getPath('userData'),
    };
  });
}
