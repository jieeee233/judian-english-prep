/**
 * 解析流水线：分组并发 → 板块补发（含自纠错）→ 词汇二次筛选 → 汇总。
 *
 * 设计原则：板块之间不共享状态，任何一组失败都不影响另一组的结果；
 * 每次调用都留一条 trace，事后能看清是哪一步、为什么没做成。
 */
import {
  ANALYSIS_BLOCKS,
  BLOCK_TITLES,
  MAX_BLOCK_ITEMS,
  type AnalysisBlock,
} from '../../shared/constants';
import type {
  AnalysisPayload,
  AnalysisResult,
  AnalysisSuccess,
  AnalyzeProgress,
  Result,
  StageTrace,
} from '../../shared/types';
import { AppError, fail, messageOf } from '../errors';
import { parseBlocks, parseSingleBlock, type Rejected } from '../parse';
import { BLOCK_GROUPS, buildBlockMessages, buildGroupMessages } from '../prompt';
import { extractCandidates, refineVocab } from '../wordSelection';
import { RECOVERABLE, budgetFor, errorCodeOf, type ActiveRun, type ModelClient, type RunOptions } from './transport';
import type { ValidatedRequest } from './request';

const MAX_TRACE = 12;
const MAX_ISSUES = 16;
/** 单个板块最多试几次（含自纠错）；超过就认缺，避免无限重试 */
const BLOCK_ATTEMPTS = 2;
/** 补发并发：板块之间互不依赖，3 条足以跑满又不至于把限流叠起来 */
const REPAIR_LANES = 3;

export interface AnalyzeContext {
  client: ModelClient;
  request: ValidatedRequest;
  options: RunOptions;
  active: ActiveRun;
  report: (progress: Omit<AnalyzeProgress, 'requestId'>) => void;
}

export async function analyzePassage(ctx: AnalyzeContext): Promise<Result<AnalysisSuccess>> {
  const { client, request, options, active, report } = ctx;
  const text = request.input.text;
  const candidates = extractCandidates(text);

  const payload: AnalysisPayload = {};
  const issues: string[] = [];
  const trace: StageTrace[] = [];
  const hints = new Map<AnalysisBlock, Rejected[]>();
  const missing: AnalysisBlock[] = [];
  let preview = '';
  let hardFailure: AppError | null = null;
  let stopped = false;

  const note = (entry: StageTrace) => {
    trace.push(entry);
    if (trace.length > MAX_TRACE) trace.shift();
  };

  report({
    phase: 'combined',
    index: 0,
    total: BLOCK_GROUPS.length,
    text: '正在并发生成四个板块（每组两个）…',
  });

  /* ------------------------- 第一阶段：两组并发 ------------------------- */

  const runGroup = async (group: readonly AnalysisBlock[]) => {
    if (stopped) return;
    const started = Date.now();
    const label = group.map((block) => BLOCK_TITLES[block]).join(' + ');
    try {
      const call = await client.callChat(
        buildGroupMessages(group, text, candidates),
        budgetFor(group),
        active,
        options,
      );
      preview = call.content;
      const parsed = parseBlocks(call.content, { blocks: group, passage: text });
      issues.push(...parsed.issues);
      if (parsed.rejected.length) {
        for (const block of parsed.missing) hints.set(block, parsed.rejected);
      }
      Object.assign(payload, parsed.blocks);
      missing.push(...parsed.missing);

      const accepted = group.length - parsed.missing.length;
      note({
        label,
        ms: Date.now() - started,
        finish: call.truncated ? 'length' : 'stop',
        chars: call.content.length,
        ok: parsed.missing.length === 0,
        note: parsed.missing.length
          ? `${accepted}/${group.length} 个板块通过：${parsed.missing.map((block) => BLOCK_TITLES[block]).join('、')} 需补发`
          : `${accepted} 个板块全部通过`,
      });
      if (call.truncated) issues.push(`「${label}」输出被长度上限截断，已改为分板块补发。`);
    } catch (error) {
      if (active.reason === 'cancel') throw error;
      const message = error instanceof AppError ? error.message : messageOf(error);
      note({
        label,
        ms: Date.now() - started,
        finish: '',
        chars: 0,
        ok: false,
        note: `请求未成功：${message}`,
      });
      const code = errorCodeOf(error);
      // 超时只是这一组跑不完：另一组的结果照常保留，缺的板块改分步补发
      if (code === 'TIMEOUT') {
        issues.push(`「${label}」超时，改为分板块补发。`);
        missing.push(...group);
        return;
      }
      if (!RECOVERABLE.has(code)) {
        hardFailure = error instanceof AppError ? error : new AppError('NETWORK', message);
        stopped = true;
        return;
      }
      issues.push(`「${label}」需要重新生成：${message}`);
      missing.push(...group);
    }
  };

  await Promise.all(BLOCK_GROUPS.map((group) => runGroup(group)));

  /* --------------------- 第二阶段：缺失板块逐条补发 --------------------- */

  const queue = [...new Set(missing)];
  let cursor = 0;
  // 总预算：服务商偶发变慢时，不能靠无限重试把用户按在等 10 分钟
  const deadline = Date.now() + options.timeoutSeconds * 2200;

  const repairBlock = async (block: AnalysisBlock, index: number) => {
    for (let attempt = 1; attempt <= BLOCK_ATTEMPTS; attempt += 1) {
      if (stopped || active.aborted) return;
      if (Date.now() > deadline) {
        issues.push(`「${BLOCK_TITLES[block]}」超过本次总时限，先留空，可单独重试。`);
        return;
      }
      report({
        phase: 'staged',
        block,
        index: index + 1,
        total: queue.length,
        text: `正在补发「${BLOCK_TITLES[block]}」（${index + 1}/${queue.length}）…`,
      });
      const started = Date.now();
      const label = attempt === 1 ? BLOCK_TITLES[block] : `${BLOCK_TITLES[block]}（自纠错）`;
      try {
        const call = await client.callChat(
          buildBlockMessages(block, text, candidates, hints.get(block) ?? []),
          budgetFor([block]),
          active,
          options,
        );
        preview = call.content;
        const single = parseSingleBlock(block, call.content, text);
        issues.push(...single.issues);
        if (single.value !== null) {
          (payload as Record<string, unknown>)[block] = single.value;
          note({
            label,
            block,
            ms: Date.now() - started,
            finish: call.truncated ? 'length' : 'stop',
            chars: call.content.length,
            ok: true,
            note: '通过校验',
          });
          return;
        }
        note({
          label,
          block,
          ms: Date.now() - started,
          finish: call.truncated ? 'length' : 'stop',
          chars: call.content.length,
          ok: false,
          note: single.reason ?? '内容未通过校验',
        });
        // 用这一轮的具体原因再试一次
        if (single.rejected.length) hints.set(block, single.rejected);
        else hints.set(block, [{ value: '上一轮输出', reason: single.reason ?? '格式不符' }]);
      } catch (error) {
        if (active.reason === 'cancel') throw error;
        const message = error instanceof AppError ? error.message : messageOf(error);
        note({
          label,
          block,
          ms: Date.now() - started,
          finish: '',
          chars: 0,
          ok: false,
          note: `请求未成功：${message}`,
        });
        const code = errorCodeOf(error);
        if (!RECOVERABLE.has(code)) {
          hardFailure = error instanceof AppError ? error : new AppError('NETWORK', message);
          stopped = true;
          return;
        }
        // 超时说明这次输出量本身跑不完，重发同一板块只会再等一轮
        if (code === 'TIMEOUT') return;
      }
    }
    issues.push(`「${BLOCK_TITLES[block]}」补发 ${BLOCK_ATTEMPTS} 次仍未通过校验，本次先留空。`);
  };

  const worker = async () => {
    while (!stopped) {
      const index = cursor;
      if (index >= queue.length) return;
      cursor += 1;
      await repairBlock(queue[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(REPAIR_LANES, queue.length) }, () => worker()));

  /* --------------------------- 收尾与汇总 --------------------------- */

  // 重点词汇按课标规则再过一遍：去掉编造、过于简单与非课标的超额表达
  if (Array.isArray(payload.vocab) && payload.vocab.length) {
    const refined = refineVocab(payload.vocab, text);
    if (refined.dropped.length) {
      issues.push(`重点词汇按课标规则筛掉 ${refined.dropped.length} 项：${refined.dropped.join('、')}。`);
    }
    payload.vocab = refined.items.slice(0, MAX_BLOCK_ITEMS);
  }

  const produced = ANALYSIS_BLOCKS.filter(
    (block) => (payload as Record<string, unknown>)[block] !== undefined,
  );
  if (!produced.length) {
    if (active.reason === 'cancel') throw new AppError('CANCELLED', '本次请求已取消。');
    const failure =
      hardFailure ??
      new AppError(
        'FORMAT',
        '四个板块都没有通过校验：模型返回的内容不是规定的 JSON，或不满足内容规则。可重试，或先缩短文章再解析。',
      );
    const result = fail(failure.code, failure.message, failure.status);
    if (preview) result.preview = preview;
    return result;
  }

  report({ phase: 'done', index: produced.length, total: ANALYSIS_BLOCKS.length, text: '四个板块已生成完毕。' });

  const stillMissing = ANALYSIS_BLOCKS.filter(
    (block) => (payload as Record<string, unknown>)[block] === undefined,
  );
  const result: AnalysisResult = {
    input: request.input,
    ...payload,
    source: 'api',
    isSample: false,
    model: options.model,
    completedAt: new Date().toISOString(),
    requestId: request.requestId,
    ...(stillMissing.length ? { missing: stillMissing } : {}),
    ...(issues.length ? { issues: [...new Set(issues)].slice(0, MAX_ISSUES) } : {}),
    ...(trace.length ? { trace } : {}),
  };
  return { ok: true, result };
}
