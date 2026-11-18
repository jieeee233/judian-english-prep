/**
 * 入参校验：只信任主窗口发来的、形状对的数据。
 * 放在通信与解析之前，坏参数不进流水线、也不消耗一次模型调用。
 */
import { EXERCISE_DIFFICULTIES, MAX_BLOCK_ITEMS, MAX_PASSAGE_CHARS, REQUEST_ID_PATTERN, type ExerciseDifficulty } from '../../shared/constants';
import type { AnalysisInput, PracticeInput } from '../../shared/types';
import { isRecord } from '../errors';

export interface ValidatedRequest {
  requestId: string;
  input: AnalysisInput;
}

export interface ValidatedPractice {
  requestId: string;
  input: PracticeInput;
}

function validateRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

export function validateAnalyze(payload: unknown): ValidatedRequest | null {
  if (!isRecord(payload) || !validateRequestId(payload.requestId) || !isRecord(payload.input)) return null;
  const text = payload.input.text;
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_PASSAGE_CHARS) return null;
  return { requestId: payload.requestId, input: { text: text.trim() } };
}

export function validatePractice(payload: unknown): ValidatedPractice | null {
  if (!isRecord(payload) || !validateRequestId(payload.requestId) || !isRecord(payload.input)) return null;
  const input = payload.input;
  if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > MAX_PASSAGE_CHARS) return null;
  if (
    typeof input.difficulty !== 'string' ||
    !(EXERCISE_DIFFICULTIES as readonly string[]).includes(input.difficulty)
  ) {
    return null;
  }
  if (!Array.isArray(input.vocab) || !Array.isArray(input.sentences)) return null;

  const vocab = input.vocab.slice(0, MAX_BLOCK_ITEMS).flatMap((item) => {
    if (!isRecord(item)) return [];
    const { id, term, meaning } = item;
    if (typeof id !== 'string' || !id || typeof term !== 'string' || !term || typeof meaning !== 'string') return [];
    return [
      {
        id,
        term,
        meaning,
        phonetic: typeof item.phonetic === 'string' ? item.phonetic : '',
        pos: typeof item.pos === 'string' ? item.pos : '',
      },
    ];
  });
  const sentences = input.sentences.slice(0, MAX_BLOCK_ITEMS).flatMap((item) => {
    if (!isRecord(item)) return [];
    const { id, quote } = item;
    if (typeof id !== 'string' || !id || typeof quote !== 'string' || !quote) return [];
    return [
      {
        id,
        quote,
        structure: typeof item.structure === 'string' ? item.structure : '',
        translation: typeof item.translation === 'string' ? item.translation : '',
        analysis: typeof item.analysis === 'string' ? item.analysis : '',
      },
    ];
  });

  if (!vocab.length && !sentences.length) return null;
  if (vocab.length + sentences.length > MAX_BLOCK_ITEMS * 2) return null;

  return {
    requestId: payload.requestId,
    input: {
      text: input.text.trim(),
      difficulty: input.difficulty as ExerciseDifficulty,
      vocab,
      sentences,
    },
  };
}
