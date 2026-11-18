import { reactive } from 'vue';
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_SECONDS,
  DEFAULT_VISION_MODEL,
  type ExerciseDifficulty,
  type ResultTab,
} from '../shared/constants';
import type {
  AnalysisInput,
  AnalysisResult,
  ErrorCode,
  MyVocabEntry,
  SettingsView,
} from '../shared/types';

export type ViewKey = 'analysis' | 'wordbook' | 'history' | 'settings';
export type AnalysisStatus = 'idle' | 'generating' | 'success' | 'cancelled' | 'error';
export type PracticeStatus = 'idle' | 'generating' | 'done' | 'error';

export interface Toast {
  kind: 'ok' | 'error' | 'info';
  text: string;
}

interface Store {
  view: ViewKey;
  ready: boolean;
  /** 浏览器预览（无 Electron 桥）时为 true */
  previewMode: boolean;
  settings: SettingsView;
  form: {
    text: string;
  };
  /** 结果区当前页签，切换视图后仍保留 */
  resultTab: ResultTab;
  /** 专注备课：收起全局导航，把高度还给原文与解析 */
  focus: boolean;
  analysis: {
    status: AnalysisStatus;
    result: AnalysisResult | null;
    error: string;
    /** 失败错误码，用于在界面上给出“是没响应还是格式不合规”的判断依据 */
    errorCode: ErrorCode | '';
    preview: string;
    elapsed: number;
    /** 分步生成时的阶段说明，例如「正在分步生成「重点词汇」（2/4）」 */
    stage: string;
    stageIndex: number;
    stageTotal: number;
  };
  practice: {
    status: PracticeStatus;
    difficulty: ExerciseDifficulty;
    error: string;
    errorCode: ErrorCode | '';
    preview: string;
    /** 分批出题时的进度文案 */
    stage: string;
  };
  /** 我的词汇：跨页面共享，收藏后单词本能立刻看到 */
  myVocab: {
    items: MyVocabEntry[];
    loaded: boolean;
    loading: boolean;
  };
  toast: Toast | null;
}

export const store = reactive<Store>({
  view: 'analysis',
  ready: false,
  previewMode: false,
  settings: {
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    visionModel: DEFAULT_VISION_MODEL,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    hasKey: false,
    keyPersisted: false,
    encryptionAvailable: true,
  },
  form: {
    text: '',
  },
  resultTab: 'discourse',
  focus: false,
  analysis: {
    status: 'idle',
    result: null,
    error: '',
    errorCode: '',
    preview: '',
    elapsed: 0,
    stage: '',
    stageIndex: 0,
    stageTotal: 0,
  },
  practice: {
    status: 'idle',
    difficulty: 'medium',
    error: '',
    errorCode: '',
    preview: '',
    stage: '',
  },
  myVocab: {
    items: [],
    loaded: false,
    loading: false,
  },
  toast: null,
});

let toastTimer: number | undefined;

export function showToast(kind: Toast['kind'], text: string): void {
  store.toast = { kind, text };
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    store.toast = null;
    toastTimer = undefined;
  }, 4200);
}

export function currentInput(): AnalysisInput {
  return { text: store.form.text.trim() };
}

/** 结果与当前输入/设置是否已经对不上（用于"结果已过期"提示）。 */
export function isResultStale(): boolean {
  const result = store.analysis.result;
  if (!result) return false;
  return JSON.stringify(result.input) !== JSON.stringify(currentInput());
}

export function go(view: ViewKey): void {
  store.view = view;
}
