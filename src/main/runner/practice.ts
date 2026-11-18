/**
 * 练习流水线：目标来自已通过校验的词汇与句子，按批顺序出题。
 *
 * 每批单独成败：一批 JSON 崩了只影响那一批，前面的题照常保留。
 */
import { MAX_EXERCISES, PRACTICE_BATCH, STAGE_MAX_TOKENS } from '../../shared/constants';
import type { AnalyzeProgress, Exercise, PracticeSuccess, Result } from '../../shared/types';
import { fail } from '../errors';
import { parseExercises } from '../parse';
import { buildPracticeMessages } from '../prompt';
import type { ValidatedPractice } from './request';
import { type ActiveRun, type ModelClient, type RunOptions, toFailure } from './transport';

export interface PracticeContext {
  client: ModelClient;
  request: ValidatedPractice;
  options: RunOptions;
  active: ActiveRun;
  report: (progress: Omit<AnalyzeProgress, 'requestId'>) => void;
}

export async function runPractice(ctx: PracticeContext): Promise<Result<PracticeSuccess>> {
  const { client, request, options, active, report } = ctx;
  const { vocab, sentences, difficulty, text } = request.input;

  const order: Array<{ kind: 'vocab' | 'sentence'; id: string }> = [
    ...vocab.map((item) => ({ kind: 'vocab' as const, id: item.id })),
    ...sentences.map((item) => ({ kind: 'sentence' as const, id: item.id })),
  ];
  const batches: Array<{ vocab: typeof vocab; sentences: typeof sentences }> = [];
  for (let i = 0; i < order.length; i += PRACTICE_BATCH) {
    const slice = order.slice(i, i + PRACTICE_BATCH);
    batches.push({
      vocab: vocab.filter((item) => slice.some((one) => one.kind === 'vocab' && one.id === item.id)),
      sentences: sentences.filter((item) => slice.some((one) => one.kind === 'sentence' && one.id === item.id)),
    });
  }

  const items: Exercise[] = [];
  const seen = new Set<string>();
  const issues: string[] = [];
  let preview = '';
  let lastReason = '';

  try {
    for (const [index, batch] of batches.entries()) {
      report({
        phase: 'exercise',
        index: index + 1,
        total: batches.length,
        text:
          batches.length > 1
            ? `正在出题（第 ${index + 1}/${batches.length} 批，共 ${order.length} 个目标）…`
            : '正在按目标清单出题…',
      });

      let parsed: ReturnType<typeof parseExercises> | null = null;

      // 同一批最多试两次：第一次多半是 JSON 崩了，重发一次通常就正常
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const call = await client.callChat(
          buildPracticeMessages(text, batch.vocab, batch.sentences, difficulty),
          STAGE_MAX_TOKENS.exercise,
          active,
          options,
        );
        preview = call.content;
        parsed = parseExercises(call.content, batch.vocab, batch.sentences);
        if (parsed.items.length) break;
      }

      if (!parsed || !parsed.items.length) {
        const why = parsed?.issues[0] ?? '返回内容不含 exercises 数组';
        lastReason = why;
        issues.push(batches.length > 1 ? `第 ${index + 1} 批没有出题（${why}）` : `没有出题（${why}）`);
        continue;
      }

      for (const item of parsed.items) {
        if (seen.has(item.targetId)) continue;
        seen.add(item.targetId);
        items.push({ ...item, id: `E${items.length + 1}` });
      }
      issues.push(...parsed.issues);
    }

    if (!items.length) {
      const failure = fail('FORMAT', lastReason || '模型没有按目标清单出题。');
      if (preview) failure.preview = preview;
      return failure;
    }

    report({
      phase: 'exercise',
      index: batches.length,
      total: batches.length,
      text: `已生成 ${items.length} 道练习。`,
    });

    return {
      ok: true,
      exercise: {
        difficulty,
        items: items.slice(0, MAX_EXERCISES),
        completedAt: new Date().toISOString(),
        model: options.model,
        issues: issues.length ? [...new Set(issues)] : undefined,
      },
    };
  } catch (error) {
    if (active.reason === 'cancel') return fail('CANCELLED', '练习生成已取消。');
    if (active.reason === 'timeout') {
      return fail('TIMEOUT', `练习生成超过 ${options.timeoutSeconds} 秒仍未完整返回，已中止。`);
    }
    return toFailure(error, active, options, preview);
  }
}
