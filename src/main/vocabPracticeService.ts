import { REQUEST_ID_PATTERN } from '../shared/constants';
import type {
  Result,
  VocabPracticeGenerateRequest,
  VocabPracticeGenerateSuccess,
  VocabPracticeGroup,
  VocabPracticeItem,
  VocabPracticeStyle,
  VocabPracticeWord,
} from '../shared/types';
import { fail, isRecord, mapHttpStatus } from './errors';
import { repairJson, salvageValue } from './parse';

/**
 * 单词练习生成：教师勾选若干词条，模型为每个词写 2 道题。
 * 有固定搭配的词优先考搭配，没有搭配的词考词义/词形。
 * 一次请求只处理一小批，避免模型 JSON 崩一处整批作废。
 */

const BATCH = 8;
const MAX_WORDS = 120;
const MAX_COUNT = 4;

export const PRACTICE_MASK = '[密钥已隐藏]';

export interface WordPracticeConnection {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutSeconds: number;
}

export interface GenerateWordPracticeOptions {
  /** 渲染层传来的原始载荷，内部逐字段校验 */
  raw: unknown;
  connection: WordPracticeConnection;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
}

const SYSTEM_PROMPT = `你是中国高中英语教师，负责为教材词汇编写随堂练习题。用户给出若干词条（单词、词性、释义、固定搭配），你为每个词写题，遵守：
1. 有固定搭配的词，优先考搭配本身（介词、搭配中的动词或名词形式）；没有固定搭配的词考词义辨析、词形变化或常见用法。
2. 题型只能是 choice（四选一）或 grammar（语法填空），按用户要求的题型出题。
3. choice：给 4 个选项，只有一个正确答案；answer 必须与某个选项逐字一致；不要给选项加 A/B/C/D 编号。
4. grammar：题干中空格统一用 ______（六个下划线）表示，且必须带 options: []（空数组），不要给任何选项；若考词形变化，hint 填括号里的提示词（如 curious）。
5. 题干必须是英文，不超过 30 词，语境自然，难度贴合中国高中生；explanation 用中文一句话说明理由。
6. word 字段必须与输入完全一致，原样照抄，不改大小写。
7. 只输出一个合法 JSON 对象，不要 Markdown 围栏、不要解释或思考过程。结构：
{
  "items": [
    {
      "word": "curious",
      "exercises": [
        { "type": "choice", "point": "介词搭配", "stem": "Children are naturally curious ______ the world around them.", "options": ["about", "to", "for", "with"], "answer": "about", "hint": "", "explanation": "be curious about sth 对……好奇。" },
        { "type": "grammar", "point": "词形变化", "stem": "The children looked at the box ______ (curious).", "options": [], "answer": "curiously", "hint": "curious", "explanation": "修饰动词 look 用副词 curiously。" }
      ]
    }
  ]
}`;

function styleText(style: VocabPracticeStyle): string {
  if (style === 'choice') return '全部出选择题（choice）';
  if (style === 'grammar') return '全部出语法填空题（grammar）';
  return '选择题与语法填空题各占一半，交替出现';
}

function wordPayload(words: VocabPracticeWord[]): Array<Record<string, unknown>> {
  return words.map((item) => ({
    word: item.word,
    pos: item.pos,
    meaning: item.meaning,
    collocations: item.collocations.map((c) => (c.meaning ? `${c.pattern}（${c.meaning}）` : c.pattern)),
  }));
}

async function readErrorDetail(response: Response, apiKey: string): Promise<string> {
  try {
    const raw = (await response.text()).replaceAll(apiKey, PRACTICE_MASK).slice(0, 1200);
    try {
      const body = JSON.parse(raw) as unknown;
      if (isRecord(body)) {
        const err = body.error;
        const message =
          (isRecord(err) && typeof err.message === 'string' && err.message) ||
          (typeof body.message === 'string' && body.message) ||
          '';
        if (message) return message.slice(0, 300);
      }
    } catch {
      // 非 JSON 就退回纯文本
    }
    return raw.replace(/\s+/g, ' ').trim().slice(0, 300);
  } catch {
    return '';
  }
}

function looksLikeChoice(value: string): boolean {
  return value === 'choice' || value === 'multiple' || value === 'mc';
}

/** 逐题清洗：题干/答案必填，选择题答案必须落在选项里。 */
function cleanItem(raw: unknown, index: number, style: VocabPracticeStyle): VocabPracticeItem | null {
  if (!isRecord(raw)) return null;
  const stem = typeof raw.stem === 'string' ? raw.stem.trim().slice(0, 600) : '';
  const answer = typeof raw.answer === 'string' ? raw.answer.trim().slice(0, 200) : '';
  if (!stem || !answer) return null;

  const rawOptions = Array.isArray(raw.options)
    ? raw.options
        .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
        .slice(0, 6)
        .map((item) => item.trim().slice(0, 160))
    : [];
  const options = [...new Set(rawOptions)];
  // 教师选了「语法填空」就别被模型顺手塞的选项带偏；选了「选择题」则必须有选项
  const isChoice = style === 'grammar' ? false : looksLikeChoice(String(raw.type ?? '')) || options.length >= 3;

  if (isChoice) {
    if (options.length < 3) return null;
    const matched = options.find((opt) => opt.toLowerCase() === answer.toLowerCase());
    if (!matched) return null;
    return {
      id: `ai-${Date.now().toString(36)}-${index + 1}`,
      type: 'choice',
      point: typeof raw.point === 'string' ? raw.point.trim().slice(0, 40) : '',
      stem,
      answer: matched,
      hint: '',
      explanation: typeof raw.explanation === 'string' ? raw.explanation.trim().slice(0, 400) : '',
      options,
    };
  }

  if (style === 'choice') return null;
  // 语法填空必须有空格，否则这题没法做
  if (!/_{3,}/.test(stem)) return null;

  return {
    id: `ai-${Date.now().toString(36)}-${index + 1}`,
    type: 'grammar',
    point: typeof raw.point === 'string' ? raw.point.trim().slice(0, 40) : '',
    stem,
    answer,
    hint: typeof raw.hint === 'string' ? raw.hint.trim().slice(0, 80) : '',
    explanation: typeof raw.explanation === 'string' ? raw.explanation.trim().slice(0, 400) : '',
    options: [],
  };
}

/** 从模型输出里取出 items，按 word 归组，只保留本次请求过的词。 */
function parseGroups(
  content: string,
  words: VocabPracticeWord[],
  count: number,
  style: VocabPracticeStyle,
): VocabPracticeGroup[] {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(repairJson(content));
  } catch {
    parsed = salvageValue(content, ['items', 'exercises', 'data']);
  }

  const list =
    Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.items)
        ? parsed.items
        : [];

  const index = new Map(words.map((item) => [item.word.toLowerCase().trim(), item.word]));
  const buckets = new Map<string, VocabPracticeItem[]>();

  for (const group of list) {
    if (!isRecord(group)) continue;
    const word = typeof group.word === 'string' ? index.get(group.word.toLowerCase().trim()) : undefined;
    if (!word) continue;
    const rawExercises = Array.isArray(group.exercises) ? group.exercises : [];
    const bucket = buckets.get(word) ?? [];
    for (const item of rawExercises) {
      if (bucket.length >= count) break;
      const cleaned = cleanItem(item, bucket.length, style);
      if (cleaned) bucket.push(cleaned);
    }
    if (bucket.length) buckets.set(word, bucket);
  }

  return [...buckets.entries()].map(([word, exercises]) => ({ word, exercises }));
}

function validate(raw: unknown): VocabPracticeGenerateRequest | string {
  if (!isRecord(raw)) return '参数无效。';
  if (typeof raw.requestId !== 'string' || !REQUEST_ID_PATTERN.test(raw.requestId)) {
    return '请求标识无效，请重新点击生成。';
  }
  const style: VocabPracticeStyle =
    raw.style === 'choice' || raw.style === 'grammar' || raw.style === 'mixed' ? raw.style : 'mixed';
  const count = Math.min(MAX_COUNT, Math.max(1, Math.round(Number(raw.count) || 2)));
  if (!Array.isArray(raw.words) || !raw.words.length) return '请先勾选要生成练习的单词。';
  if (raw.words.length > MAX_WORDS) return `一次最多生成 ${MAX_WORDS} 个词的练习。`;

  const words: VocabPracticeWord[] = [];
  for (const item of raw.words) {
    if (!isRecord(item)) continue;
    const word = typeof item.word === 'string' ? item.word.trim().slice(0, 80) : '';
    if (!word) continue;
    const collocations = Array.isArray(item.collocations)
      ? item.collocations.slice(0, 4).flatMap((c) => {
          if (!isRecord(c)) return [];
          const pattern = typeof c.pattern === 'string' ? c.pattern.trim().slice(0, 120) : '';
          if (!pattern) return [];
          return [{ pattern, meaning: typeof c.meaning === 'string' ? c.meaning.trim().slice(0, 120) : '' }];
        })
      : [];
    words.push({
      word,
      meaning: typeof item.meaning === 'string' ? item.meaning.slice(0, 160) : '',
      pos: typeof item.pos === 'string' ? item.pos.slice(0, 40) : '',
      collocations,
    });
  }
  if (!words.length) return '请先勾选要生成练习的单词。';
  return { requestId: raw.requestId, style, count, words };
}

async function callModel(
  options: GenerateWordPracticeOptions,
  batch: VocabPracticeWord[],
  style: VocabPracticeStyle,
  count: number,
): Promise<string> {
  const { connection } = options;
  const controller = new AbortController();
  const timeout = Math.max(60, connection.timeoutSeconds) * 1000;
  const timer = setTimeout(() => controller.abort(), timeout);

  const body: Record<string, unknown> = {
    model: connection.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          task: `为下面每个词各写 ${count} 道题，题型：${styleText(style)}。`,
          count,
          words: wordPayload(batch),
        }),
      },
    ],
    stream: false,
    temperature: 0.4,
    max_tokens: 4000,
  };
  if (/qwen3/i.test(connection.model)) body.enable_thinking = false;

  try {
    const response = await options.fetch(`${connection.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${connection.apiKey}`,
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: 'manual',
      credentials: 'omit',
      cache: 'no-store',
    } as RequestInit);

    if (!response.ok) {
      const detail = await readErrorDetail(response, connection.apiKey);
      const mapped = mapHttpStatus(response.status);
      throw Object.assign(new Error(detail ? `${mapped.message} ${detail}` : mapped.message), {
        code: mapped.code,
      });
    }

    const raw = await response.json() as unknown;
    const content =
      isRecord(raw) && Array.isArray(raw.choices) && isRecord(raw.choices[0])
        ? isRecord(raw.choices[0].message) && typeof raw.choices[0].message.content === 'string'
          ? raw.choices[0].message.content
          : ''
        : '';
    if (!content.trim()) throw new Error('模型返回了空内容，请重试。');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

export async function generateWordPractice(
  options: GenerateWordPracticeOptions,
): Promise<Result<VocabPracticeGenerateSuccess>> {
  const validated = validate(options.raw);
  if (typeof validated === 'string') return fail('VALIDATION', validated);

  const { words, style, count } = validated;
  const groups: VocabPracticeGroup[] = [];
  const issues: string[] = [];

  for (let start = 0; start < words.length; start += BATCH) {
    const batch = words.slice(start, start + BATCH);
    const label = `第 ${Math.floor(start / BATCH) + 1} 批`;
    let content = '';
    let lastError = '';

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        content = await callModel(options, batch, style, count);
        lastError = '';
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        lastError = message;
        const code = (error as { code?: string }).code;
        // 密钥/连接类错误不重试，直接返回
        if (code && code !== 'TIMEOUT' && code !== 'NETWORK' && code !== 'HTTP') {
          return fail(code as never, message);
        }
      }
    }

    if (!content) {
      issues.push(`${label}生成失败：${lastError || '模型没有返回内容'}`);
      continue;
    }

    const parsed = parseGroups(content, batch, count, style);
    if (!parsed.length) {
      issues.push(`${label}返回的题目都对不上词条，已跳过。`);
      continue;
    }
    groups.push(...parsed);

    const missing = batch.filter(
      (word) => !parsed.some((group) => group.word.toLowerCase() === word.word.toLowerCase()),
    );
    if (missing.length) {
      issues.push(`${label}缺少 ${missing.map((item) => item.word).join('、')} 的题目。`);
    }
  }

  if (!groups.length) {
    return fail('FORMAT', issues[0] ?? '模型没有生成可用的题目，请重试。');
  }

  return {
    ok: true,
    groups,
    model: options.connection.model,
    issues,
  };
}
