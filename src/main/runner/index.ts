/**
 * AnalysisRunner：窗口级的任务簿记（忙/取消/去重）+ 两条流水线的入口。
 *
 * 具体怎么生成在 pipeline.ts / practice.ts，怎么发请求在 transport.ts，
 * 这里只保证「一个窗口同时只有一个任务、取消能真的停下、重复提交会被挡」。
 */
import { MAX_RECENT_REQUESTS } from '../../shared/constants';
import type { AnalyzeProgress, AnalysisSuccess, Failure, PracticeSuccess, Result } from '../../shared/types';
import { fail } from '../errors';
import { analyzePassage } from './pipeline';
import { runPractice } from './practice';
import { validateAnalyze, validatePractice } from './request';
import { ModelClient, toFailure, type ActiveRun, type FetchLike, type RunOptions } from './transport';

export type { RunOptions, FetchLike } from './transport';

export class AnalysisRunner {
  private readonly client: ModelClient;
  private active = new Map<number, ActiveRun>();
  private recent = new Map<number, Set<string>>();

  constructor(options: { fetch: FetchLike; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout }) {
    this.client = new ModelClient(options);
  }

  isBusy(windowId: number): boolean {
    return this.active.has(windowId);
  }

  cancel(windowId: number, requestId?: string): void {
    const current = this.active.get(windowId);
    if (!current) return;
    if (requestId && current.id !== requestId) return;
    current.reason = 'cancel';
    current.aborted = true;
    current.controller.abort();
    this.active.delete(windowId);
  }

  dispose(windowId: number): void {
    this.cancel(windowId);
    this.recent.delete(windowId);
  }

  /** 同一窗口只允许一个任务；同一 requestId 只允许提交一次 */
  private claim(windowId: number, requestId: string): Failure | null {
    if (this.active.has(windowId)) {
      return fail('BUSY', '当前窗口已有正在进行的任务，请等待或取消后再试。');
    }
    if (this.recent.get(windowId)?.has(requestId)) {
      return fail('DUPLICATE', '此请求已提交，请使用生成按钮发起新任务。');
    }
    const seen = this.recent.get(windowId) ?? new Set<string>();
    seen.add(requestId);
    if (seen.size > MAX_RECENT_REQUESTS) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    this.recent.set(windowId, seen);
    return null;
  }

  private reportTo(requestId: string, onProgress?: (progress: AnalyzeProgress) => void) {
    // 进度是「锦上添花」：界面已经关了也不该打断流水线
    return (progress: Omit<AnalyzeProgress, 'requestId'>) => {
      try {
        onProgress?.({ requestId, ...progress });
      } catch {
        // 忽略界面侧异常
      }
    };
  }

  async run(
    windowId: number,
    raw: unknown,
    options: RunOptions,
    onProgress?: (progress: AnalyzeProgress) => void,
  ): Promise<Result<AnalysisSuccess>> {
    const request = validateAnalyze(raw);
    if (!request) {
      return fail('VALIDATION', '文章无效：请粘贴非空文章，且不超过 20,000 字符。');
    }
    const claimed = this.claim(windowId, request.requestId);
    if (claimed) return claimed;
    if (!options.apiKey) {
      return fail('NOT_CONFIGURED', '请先在 API 设置中输入并保存密钥。');
    }

    const active: ActiveRun = { id: request.requestId, controller: new AbortController() };
    this.active.set(windowId, active);

    try {
      return await analyzePassage({
        client: this.client,
        request,
        options,
        active,
        report: this.reportTo(request.requestId, onProgress),
      });
    } catch (error) {
      return toFailure(error, active, options);
    } finally {
      if (this.active.get(windowId) === active) this.active.delete(windowId);
    }
  }

  async practice(
    windowId: number,
    raw: unknown,
    options: RunOptions,
    onProgress?: (progress: AnalyzeProgress) => void,
  ): Promise<Result<PracticeSuccess>> {
    const request = validatePractice(raw);
    if (!request) {
      return fail('VALIDATION', '练习参数无效：请先生成重点词汇与长难句，并选择难度。');
    }
    const claimed = this.claim(windowId, request.requestId);
    if (claimed) return claimed;
    if (!options.apiKey) {
      return fail('NOT_CONFIGURED', '请先在 API 设置中输入并保存密钥。');
    }

    const active: ActiveRun = { id: request.requestId, controller: new AbortController() };
    this.active.set(windowId, active);

    try {
      return await runPractice({
        client: this.client,
        request,
        options,
        active,
        report: this.reportTo(request.requestId, onProgress),
      });
    } catch (error) {
      return toFailure(error, active, options);
    } finally {
      if (this.active.get(windowId) === active) this.active.delete(windowId);
    }
  }
}
