import { app, safeStorage } from 'electron';
import path from 'node:path';
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_SECONDS,
  DEFAULT_VISION_MODEL,
} from '../shared/constants';
import type { SaveSettingsPayload, SettingsView } from '../shared/types';
import { isRecord } from './errors';
import { readJsonFile, removeFile, writeJsonAtomic } from './storage/jsonFile';

interface SettingsState {
  baseUrl: string;
  model: string;
  visionModel: string;
  timeoutSeconds: number;
  apiKey: string;
}

interface PersistedShape {
  v: 1;
  baseUrl: string;
  model: string;
  /** 缺省时按 DEFAULT_VISION_MODEL 处理（旧版本存档没有这个字段） */
  visionModel?: string;
  timeoutSeconds: number;
  /** safeStorage 加密后的 base64；为空表示未保存密钥 */
  key?: string;
}

export type ValidationResult = { ok: true; value: SettingsState } | { ok: false; message: string };

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/**
 * 设置存储：baseUrl / model / timeout 落盘，API Key 用系统凭据加密（Windows DPAPI）后落盘。
 * 系统不支持加密时降级为仅内存，界面上明确告知用户。
 */
export class SettingsStore {
  private state: SettingsState = {
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    visionModel: DEFAULT_VISION_MODEL,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    apiKey: '',
  };

  private keyPersisted = false;
  private file = '';

  init(): void {
    this.file = path.join(app.getPath('userData'), 'settings.json');
  }

  get encryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  get apiKey(): string {
    return this.state.apiKey;
  }

  get connection(): Required<SettingsState> {
    return { ...this.state };
  }

  view(): SettingsView {
    return {
      baseUrl: this.state.baseUrl,
      model: this.state.model,
      visionModel: this.state.visionModel,
      timeoutSeconds: this.state.timeoutSeconds,
      hasKey: Boolean(this.state.apiKey),
      keyPersisted: this.keyPersisted && Boolean(this.state.apiKey),
      encryptionAvailable: this.encryptionAvailable,
    };
  }

  async load(): Promise<void> {
    const data = await readJsonFile(this.file);
    if (!isRecord(data) || data.v !== 1) return;

    if (typeof data.baseUrl === 'string' && data.baseUrl) this.state.baseUrl = data.baseUrl;
    if (typeof data.model === 'string' && data.model) this.state.model = data.model;
    if (typeof data.visionModel === 'string' && data.visionModel) {
      this.state.visionModel = data.visionModel;
    }
    if (typeof data.timeoutSeconds === 'number' && Number.isFinite(data.timeoutSeconds)) {
      const stored = Math.min(300, Math.max(30, Math.round(data.timeoutSeconds)));
      // 120 是 0.8.5 及更早版本的出厂值：那档设置跑不完一次四板块输出，
      // 迁移到新的默认值，用户自己改过的其它值原样保留。
      this.state.timeoutSeconds = stored === 120 ? DEFAULT_TIMEOUT_SECONDS : stored;
    }

    if (typeof data.key === 'string' && data.key && this.encryptionAvailable) {
      try {
        this.state.apiKey = safeStorage.decryptString(Buffer.from(data.key, 'base64'));
        this.keyPersisted = Boolean(this.state.apiKey);
      } catch {
        // 换了机器或凭据失效：忽略旧密钥，让用户重新填
        this.state.apiKey = '';
        this.keyPersisted = false;
      }
    }
  }

  validate(payload: unknown): ValidationResult {
    if (!isRecord(payload)) return { ok: false, message: '设置格式无效。' };

    const { baseUrl, model, apiKey, timeoutSeconds, visionModel } = payload as Partial<SaveSettingsPayload>;
    if (typeof baseUrl !== 'string' || typeof model !== 'string' || typeof apiKey !== 'string') {
      return { ok: false, message: '请完整填写 API 设置。' };
    }
    if (
      typeof timeoutSeconds !== 'number' ||
      !Number.isInteger(timeoutSeconds) ||
      timeoutSeconds < 30 ||
      timeoutSeconds > 300
    ) {
      return { ok: false, message: '超时须为 30 至 300 秒的整数。' };
    }

    let url: URL;
    try {
      url = new URL(baseUrl.trim());
    } catch {
      return { ok: false, message: '服务地址格式不正确，请填写完整 URL。' };
    }

    const isLocal = LOCAL_HOSTS.includes(url.hostname);
    const protocolOk = url.protocol === 'https:' || (url.protocol === 'http:' && isLocal);
    if (!protocolOk || url.username || url.password || url.search || url.hash) {
      return {
        ok: false,
        message: '请使用 HTTPS 地址（本机服务可用 HTTP），地址中不能包含凭据、查询参数或片段。',
      };
    }
    if (/\/chat\/completions\/?$/.test(url.pathname)) {
      return {
        ok: false,
        message: '请填写 API 基础地址（通常以 /v1 结尾），不要包含 /chat/completions。',
      };
    }
    if (url.href.length > 2048 || !model.trim() || model.length > 200) {
      return { ok: false, message: '请检查服务地址和模型名称的长度。' };
    }

    const nextKey = apiKey.trim() || this.state.apiKey;
    if (!nextKey || nextKey.length > 4096 || !/^[\x21-\x7e]+$/.test(nextKey)) {
      return { ok: false, message: '请填写有效的 API 密钥，不包含空白或非 ASCII 字符。' };
    }

    const normalizedUrl = url.href.replace(/\/$/, '');
    if (!apiKey.trim() && normalizedUrl !== this.state.baseUrl) {
      return { ok: false, message: '更换服务地址后，请重新填写该服务的 API 密钥。' };
    }

    // 视觉模型：留空沿用现有值；填了就校验长度与字符，避免把说明文字当成模型名
    let nextVision = this.state.visionModel || DEFAULT_VISION_MODEL;
    if (typeof visionModel === 'string' && visionModel.trim()) {
      const value = visionModel.trim();
      if (value.length > 200 || /\s{2,}/.test(value)) {
        return { ok: false, message: '视觉模型名称过长或含有连续空格，请检查后重填。' };
      }
      nextVision = value;
    }

    return {
      ok: true,
      value: {
        baseUrl: normalizedUrl,
        model: model.trim(),
        visionModel: nextVision,
        timeoutSeconds,
        apiKey: nextKey,
      },
    };
  }

  async save(value: SettingsState): Promise<{ persisted: boolean }> {
    this.state = { ...value };

    const canPersist = this.encryptionAvailable;
    const payload: PersistedShape = {
      v: 1,
      baseUrl: value.baseUrl,
      model: value.model,
      visionModel: value.visionModel,
      timeoutSeconds: value.timeoutSeconds,
    };
    if (canPersist) {
      try {
        payload.key = safeStorage.encryptString(value.apiKey).toString('base64');
      } catch {
        // 加密失败就退化为不落盘密钥
      }
    }
    await writeJsonAtomic(this.file, payload);
    this.keyPersisted = canPersist && Boolean(payload.key);
    return { persisted: this.keyPersisted };
  }

  async clear(): Promise<void> {
    this.state = {
      baseUrl: DEFAULT_BASE_URL,
      model: DEFAULT_MODEL,
      visionModel: DEFAULT_VISION_MODEL,
      timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
      apiKey: '',
    };
    this.keyPersisted = false;
    await removeFile(this.file);
  }
}
