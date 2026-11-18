import type {
  AnalysisInput,
  AnalysisSuccess,
  AnalyzeProgress,
  ArticleImportRequest,
  ArticleImportSuccess,
  CollocationRequest,
  CollocationSuccess,
  DemoExportPayload,
  DemoExportResult,
  WordSheetPayload,
  ExportPayload,
  ExportSuccess,
  HistoryEntry,
  MyVocabEntry,
  MyVocabInput,
  HistorySummary,
  PracticeInput,
  PracticeSuccess,
  Result,
  SaveSettingsPayload,
  SettingsView,
  VocabPracticeGenerateRequest,
  VocabPracticeGenerateSuccess,
  VocabPracticeItem,
} from './types';

export const IPC = {
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  settingsClear: 'settings:clear',
  analyze: 'analysis:generate',
  analyzeProgress: 'analysis:progress',
  cancel: 'analysis:cancel',
  practice: 'practice:generate',
  clipboardWrite: 'clipboard:write',
  historyList: 'history:list',
  historyGet: 'history:get',
  historyRemove: 'history:remove',
  historyClear: 'history:clear',
  exportLesson: 'export:lesson',
  demoExport: 'demo:export',
  wordSheetExport: 'wordsheet:export',
  myVocabList: 'myvocab:list',
  myVocabAdd: 'myvocab:add',
  myVocabUpdate: 'myvocab:update',
  myVocabRemove: 'myvocab:remove',
  collocationExtract: 'collocation:extract',
  collocationList: 'collocation:list',
  collocationSet: 'collocation:set',
  articleImport: 'article:import',
  practiceVocabList: 'practice:vocab:list',
  practiceVocabSave: 'practice:vocab:save',
  practiceVocabReset: 'practice:vocab:reset',
  practiceVocabGenerate: 'practice:vocab:generate',
  appInfo: 'app:info',
} as const;

export interface AppInfo {
  version: string;
  electron: string;
  platform: string;
  dataDir: string;
}

type Empty = object;

/** preload 通过 contextBridge 暴露到 window.desktop 的全部能力。 */
export interface DesktopApi {
  getSettings(): Promise<SettingsView>;
  saveSettings(payload: SaveSettingsPayload): Promise<Result<{ persisted: boolean }>>;
  clearSettings(): Promise<Result<Empty>>;
  analyze(payload: { requestId: string; input: AnalysisInput }): Promise<Result<AnalysisSuccess>>;
  /** 把拖入的 File 还原成本机绝对路径（Electron 32 起 File.path 已移除） */
  pathForFile(file: unknown): string;
  /** 订阅解析阶段进度，返回取消订阅函数 */
  onAnalyzeProgress(handler: (progress: AnalyzeProgress) => void): () => void;
  cancelAnalysis(requestId: string): Promise<Result<Empty>>;
  generatePractice(payload: { requestId: string; input: PracticeInput }): Promise<Result<PracticeSuccess>>;
  copyText(text: string): Promise<Result<Empty>>;
  listHistory(): Promise<Result<{ items: HistorySummary[] }>>;
  getHistory(id: string): Promise<Result<{ entry: HistoryEntry }>>;
  removeHistory(id: string): Promise<Result<{ items: HistorySummary[] }>>;
  clearHistory(): Promise<Result<Empty>>;
  exportLesson(payload: ExportPayload): Promise<Result<ExportSuccess>>;
  exportDemo(payload: DemoExportPayload): Promise<Result<DemoExportResult>>;
  exportWordSheet(payload: WordSheetPayload): Promise<Result<ExportSuccess>>;
  listMyVocab(): Promise<Result<{ items: MyVocabEntry[] }>>;
  addMyVocab(payload: { items: MyVocabInput[]; source?: string }): Promise<Result<{ items: MyVocabEntry[] }>>;
  updateMyVocab(payload: { id: string; patch: MyVocabInput }): Promise<Result<{ item: MyVocabEntry }>>;
  removeMyVocab(ids: string[]): Promise<Result<{ items: MyVocabEntry[] }>>;
  /** 识别照片/Word/粘贴文本，补全教材词汇的固定搭配 */
  extractCollocations(payload: CollocationRequest): Promise<Result<CollocationSuccess>>;
  listCollocations(unitId: string): Promise<Result<{ unitId: string; map: Record<string, string> }>>;
  setCollocation(payload: {
    unitId: string;
    order: number;
    text: string;
  }): Promise<Result<{ unitId: string; map: Record<string, string> }>>;
  /** 导入文章：照片走视觉识别，文件读取正文，粘贴直接用 */
  importArticle(payload: ArticleImportRequest): Promise<Result<ArticleImportSuccess>>;
  /** 某个单元的练习覆盖（键为序号，值覆盖内置练习） */
  listVocabPractice(unitId: string): Promise<Result<{ unitId: string; map: Record<string, VocabPracticeItem[]> }>>;
  saveVocabPractice(payload: {
    unitId: string;
    groups: { key: string; exercises: VocabPracticeItem[] }[];
  }): Promise<Result<{ unitId: string; map: Record<string, VocabPracticeItem[]> }>>;
  resetVocabPractice(payload: {
    unitId: string;
    key: string;
  }): Promise<Result<{ unitId: string; map: Record<string, VocabPracticeItem[]> }>>;
  /** 让模型为勾选的词生成练习 */
  generateVocabPractice(
    payload: VocabPracticeGenerateRequest,
  ): Promise<Result<VocabPracticeGenerateSuccess>>;
  appInfo(): Promise<AppInfo>;
}
