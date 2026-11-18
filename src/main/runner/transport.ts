/**
 * 与模型服务的通信层：一次请求 = 一次 callChat。
 *
 * 只负责「发出去、读回来、把错误翻译成用户能懂的话」，
 * 不关心是哪个板块、解析结果怎么用；换服务商时只改这里。
 */
import { MAX_RESPONSE_BYTES, STAGE_MAX_TOKENS, shouldDisableThinking, type AnalysisBlock } from '../../shared/constants';
import type { ErrorCode, Failure } from '../../shared/types';
import { AppError, fail, isRecord, mapHttpStatus, messageOf } from '../errors';
import type { ChatMessage } from '../prompt';

export const MASK = '[密钥已隐藏]';

export interface RunOptions {
  baseUrl: string;
  model: string;
  timeoutSeconds: number;
  apiKey: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ActiveRun {
  id: string;
  /** 当前正在飞的请求；取消时中止它 */
  controller: AbortController;
  reason?: 'timeout' | 'cancel';
  aborted?: boolean;
}

export interface CallResult {
  content: string;
  truncated: boolean;
  /** 模型把内容写在推理字段里（正文为空）时的原文，供排障 */
  reasoning: string;
}

/** 内容类错误：可以靠换分组/分步重发补救，不必直接判失败。 */
export const RECOVERABLE: ReadonlySet<ErrorCode> = new Set(['FORMAT', 'EMPTY', 'TRUNCATED']);

export function errorCodeOf(error: unknown): ErrorCode {
  return error instanceof AppError ? error.code : 'NETWORK';
}

/** 读取服务端错误说明（截断到 300 字），让 4xx 的提示能说清到底哪里不对。 */
async function readErrorDetail(response: Response, apiKey: string): Promise<string> {
  try {
    const text = await response.text();
    const safe = text.replaceAll(apiKey, MASK).slice(0, 1200);
    try {
      const body = JSON.parse(safe) as unknown;
      if (isRecord(body)) {
        const err = body.error;
        const raw =
          (isRecord(err) && (err.message as string)) ||
          (typeof body.message === 'string' && body.message) ||
          (typeof body.detail === 'string' && body.detail) ||
          '';
        if (raw) return String(raw).slice(0, 300);
      }
    } catch {
      // 非 JSON 就退回纯文本
    }
    return safe.replace(/\s+/g, ' ').trim().slice(0, 300);
  } catch {
    return '';
  }
}

/** 手动读流，带上限，避免异常响应把内存吃满。 */
async function readResponseText(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body) {
    throw new AppError('FORMAT', '服务返回空响应，请重试。');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new AppError('FORMAT', '服务返回内容过大，已停止读取；请缩短文章后重试。');
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

/** 把异常统一翻成带 code 的失败结果，界面按 code 给出可执行的建议。 */
export function toFailure(error: unknown, active: ActiveRun, options: RunOptions, preview = ''): Failure {
  if (active.reason === 'cancel') return fail('CANCELLED', '本次请求已取消，输入与上次结果已保留。');
  if (active.reason === 'timeout') {
    return fail(
      'TIMEOUT',
      `请求超过 ${options.timeoutSeconds} 秒仍未完整返回，已中止。可缩短文章、调大超时后重试。`,
    );
  }
  if (error instanceof AppError) {
    const failure = fail(error.code, error.message, error.status);
    if (preview && RECOVERABLE.has(error.code)) failure.preview = preview;
    return failure;
  }
  return fail('NETWORK', '无法连接服务或响应读取中断，请检查网络、代理和基础地址；没有自动重试。');
}

/** 板块或分组的输出预算：取组内各板块之和，再留一点余量 */
export function budgetFor(blocks: readonly AnalysisBlock[]): number {
  const sum = blocks.reduce((total, block) => total + STAGE_MAX_TOKENS[block], 0);
  return Math.min(sum, STAGE_MAX_TOKENS.group);
}

export class ModelClient {
  constructor(
    private readonly options: {
      fetch: FetchLike;
      setTimer?: typeof setTimeout;
      clearTimer?: typeof clearTimeout;
    },
  ) {}

  /** 单次对话请求：独立超时、可被取消、错误统一映射成 AppError。 */
  async callChat(
    messages: ChatMessage[],
    maxTokens: number,
    active: ActiveRun,
    run: RunOptions,
  ): Promise<CallResult> {
    const controller = new AbortController();
    active.controller = controller;
    const setTimer = this.options.setTimer ?? setTimeout;
    const clearTimer = this.options.clearTimer ?? clearTimeout;
    const timer = setTimer(() => {
      if (active.reason === 'cancel') return;
      active.reason = 'timeout';
      controller.abort();
    }, run.timeoutSeconds * 1000);

    try {
      const init = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${run.apiKey}`,
          Accept: 'application/json',
        },
        body: JSON.stringify({
          model: run.model,
          messages,
          stream: false,
          // Qwen3 必须显式关思考：否则推理 token 吃掉时间与输出预算
          ...(shouldDisableThinking(run.model) ? { enable_thinking: false } : {}),
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
        redirect: 'manual',
        credentials: 'omit',
        // Electron net.fetch 支持 cache，Node 的类型定义里没有，这里显式补上
        cache: 'no-store',
      } as RequestInit;

      const response = await this.options.fetch(`${run.baseUrl}/chat/completions`, init);

      if (!response.ok) {
        const detail = await readErrorDetail(response, run.apiKey);
        const mapped = mapHttpStatus(response.status);
        throw detail
          ? new AppError(mapped.code, `${mapped.message} 服务端说明：${detail}`, mapped.status)
          : mapped;
      }

      const raw = (await readResponseText(response, controller.signal)).replaceAll(run.apiKey, MASK);
      let body: unknown = null;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new AppError('FORMAT', '服务返回的不是 JSON，无法读取模型输出。');
      }
      if (!isRecord(body) || !Array.isArray(body.choices) || !isRecord(body.choices[0])) {
        throw new AppError('FORMAT', '响应缺少 choices，无法读取模型输出；请检查接口地址。');
      }
      const choice = body.choices[0];
      const message = isRecord(choice.message) ? choice.message : {};
      const content = typeof message.content === 'string' ? message.content : '';
      const reasoning =
        (typeof message.reasoning_content === 'string' && message.reasoning_content) ||
        (typeof message.reasoning === 'string' && message.reasoning) ||
        '';

      if (choice.finish_reason === 'content_filter') {
        throw new AppError('FILTERED', '服务的内容审核中止了本次输出，请检查文章内容。');
      }
      if (!content.trim() && !reasoning.trim()) {
        throw new AppError('EMPTY', '服务返回了 200，但正文与推理内容都是空的：通常是输出预算被思考过程吃光。');
      }
      if (!content.trim() && reasoning.trim()) {
        throw new AppError('EMPTY', '服务只返回了推理过程，content 为空：这次请求没有关闭思考，或思考用完了输出预算。');
      }

      return {
        content,
        truncated: choice.finish_reason === 'length',
        reasoning: reasoning.slice(0, 1200),
      };
    } catch (error) {
      if (active.reason === 'timeout') {
        throw new AppError(
          'TIMEOUT',
          `本次请求超过 ${run.timeoutSeconds} 秒仍未完整返回，已中止。可在设置中调大超时或缩短文章。`,
        );
      }
      if (active.reason === 'cancel') {
        throw new AppError('CANCELLED', '本次请求已取消。');
      }
      if (error instanceof AppError) throw error;
      const text = messageOf(error);
      if (/CERT|TLS|SSL/i.test(text)) {
        throw new AppError('TLS', '安全连接失败，请检查系统时间、证书或代理配置；不会跳过证书校验。');
      }
      throw new AppError('NETWORK', '无法连接服务或响应读取中断，请检查网络、代理与基础地址。');
    } finally {
      clearTimer(timer);
    }
  }
}
