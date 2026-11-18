import { dialog, type BrowserWindow } from 'electron';
import {
  DEFAULT_VISION_MODEL,
  MAX_COLLOCATION_CHARS,
  MAX_SOURCE_TEXT_CHARS,
  MAX_UNIT_WORDS,
  MAX_VISION_IMAGES,
  REQUEST_ID_PATTERN,
  shouldDisableThinking,
} from '../shared/constants';
import type {
  CollocationPair,
  CollocationRequest,
  CollocationSuccess,
  CollocationWord,
  Result,
} from '../shared/types';
import type { CollocationStore } from './collocations';
import { unitKeyOf } from './collocations';
import { AppError, fail, isRecord, mapHttpStatus, messageOf } from './errors';
import { repairJson, stripThinking } from './parse';
import { DOCUMENT_EXTENSIONS, IMAGE_EXTENSIONS, readDocumentFiles, readImageFiles } from './readers';

export const MASK = '[密钥已隐藏]';

export interface CollocationConnection {
  baseUrl: string;
  model: string;
  visionModel: string;
  timeoutSeconds: number;
  apiKey: string;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface ChatMessage {
  role: 'system' | 'user';
  content: string | ContentPart[];
}

/** 视觉模型慢，给它比文本链路更宽的时间窗，但不无限等。 */
function timeoutFor(via: 'vision' | 'text', seconds: number): number {
  return via === 'vision' ? Math.min(300, Math.max(120, seconds)) : seconds;
}

const SYSTEM_PROMPT = `你是中国高中英语教材的词表整理助手。用户给出一个单元的词汇表（序号、单词、音标、词性、释义），以及一份包含该单元《Words and expressions》词表页的材料（照片或文本）。请从材料里找出词表中每个词的固定搭配，遵守：
1. 只处理词表里列出的词：不要新增单词、不要改序号；词表之外的词一律忽略。词表每一行都要看，包括 senior high 这类复合词条。
2. 搭配必须来自材料原文，英文部分逐字照抄，不要自己造句，也不要补充材料里没有的常见搭配。
3. 搭配里必须出现该词本身或它的词形变化（如 facility → sports facilities）。只是把中文释义抄过来、或翻成中文的，一律跳过。
4. 材料里某个词没有英文搭配就跳过它，不要为了凑数编造；看不清的词宁可不给。
5. collocation 字段写成「英文搭配 + 一个空格 + 中文释义」，例如 "take up 开始从事；占用"。不要写词性、序号、引号，也不要加"搭配："这类前缀。
6. 一个词最多两条搭配，用中文分号「；」隔开，总长不超过 40 个字。
7. 只输出一个合法 JSON 对象，不要 Markdown 围栏、解释文字或思考过程，结构如下：
{
  "collocations": [
    { "order": 3, "word": "abandon", "collocation": "abandon oneself to 沉溺于" }
  ]
}`;

/** 词表按顺序压成简洁数组，省 token 也更不容易被模型看错行。 */
function wordLines(words: CollocationWord[]): Array<Record<string, unknown>> {
  return words.map((word) => ({
    order: word.order,
    word: word.word,
    ...(word.ipa ? { ipa: word.ipa } : {}),
    ...(word.pos ? { pos: word.pos } : {}),
    ...(word.meaning ? { meaning: word.meaning } : {}),
  }));
}

function buildMessages(
  unitLabel: string,
  words: CollocationWord[],
  material: { text?: string; images: string[] },
): ChatMessage[] {
  const base = {
    task: '从材料里找出这些词在教材词表中给出的固定搭配，按 schema 输出 JSON。',
    unit: unitLabel,
    words: wordLines(words),
  };

  if (material.images.length) {
    const parts: ContentPart[] = [
      {
        type: 'text',
        text: JSON.stringify({
          ...base,
          material: `材料是 ${material.images.length} 张词表页照片，见下方图片。请辨认每一行：英文词条与搭配在左，中文释义在右，只取英文搭配部分。`,
        }),
      },
      ...material.images.map<ContentPart>((url) => ({ type: 'image_url', image_url: { url } })),
    ];
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: parts },
    ];
  }

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        ...base,
        material: (material.text ?? '').slice(0, MAX_SOURCE_TEXT_CHARS),
      }),
    },
  ];
}

/* ------------------------------- 解析 ------------------------------- */

function normalizeWord(value: unknown): string {
  return typeof value === 'string'
    ? value
        .toLowerCase()
        .replace(/[’‘`]/g, "'")
        .replace(/[^a-z0-9' -]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}

const LATIN = /[a-z]{2,}/i;

/** 搭配里必须出现词本身或它的词形变化，避免把别的词条、或中文释义当搭配。 */
function mentionsHeadword(text: string, word: string): boolean {
  const hay = normalizeWord(text);
  const target = normalizeWord(word);
  if (!target) return false;
  if (hay.includes(target)) return true;
  const head = target.split(' ')[0];
  const stem = head.length > 5 ? head.slice(0, head.length - 1) : head;
  return stem.length >= 4 && hay.includes(stem);
}

function cleanCollocation(value: unknown, word: string): string {
  if (typeof value !== 'string') return '';
  let text = value
    .replace(/^[「“"'《\s]+|[」”"'》\s]+$/g, '')
    .replace(/^(搭配|collocation)\s*[:：]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  // 纯中文（模型把释义栏抄了过来）、或只是重复了单词本身：都不算搭配
  if (!LATIN.test(text)) return '';
  if (!mentionsHeadword(text, word)) return '';
  if (normalizeWord(text) === normalizeWord(word) && !/[\u4e00-\u9fa5]/.test(text)) return '';
  return text.slice(0, MAX_COLLOCATION_CHARS);
}

/** 从任意形状的返回里捞出 {order, word, collocation} 三元组。 */
function collectRawPairs(parsed: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(parsed)) {
    return parsed.filter(isRecord) as Array<Record<string, unknown>>;
  }
  if (!isRecord(parsed)) return [];

  const keys = ['collocations', 'items', 'pairs', 'result', 'data', 'list'];
  for (const key of keys) {
    const value = parsed[key];
    if (Array.isArray(value)) return value.filter(isRecord) as Array<Record<string, unknown>>;
    if (isRecord(value)) {
      const nested = collectRawPairs(value);
      if (nested.length) return nested;
    }
  }
  // 直接以序号为键的对象：{"3": "take up 开始从事"}
  const entries = Object.entries(parsed).filter(([key]) => /^\d{1,4}$/.test(key));
  return entries.map(([key, value]) => ({ order: Number(key), collocation: value }));
}

function salvageObjects(text: string): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  for (const match of text.matchAll(/\{[^{}]*\}/g)) {
    try {
      const value = JSON.parse(match[0]) as unknown;
      if (isRecord(value)) found.push(value);
    } catch {
      // 单个对象坏了就跳过
    }
  }
  return found;
}

/** 把模型给的搭配对回词表：序号优先，序号不可信时按单词匹配。 */
export function matchCollocations(
  raw: string,
  words: CollocationWord[],
): { pairs: CollocationPair[]; note: string } {
  const text = stripThinking(raw);
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(repairJson(text)) as unknown;
  } catch {
    parsed = null;
  }

  let items = collectRawPairs(parsed);
  if (!items.length) items = salvageObjects(repairJson(text));
  if (!items.length) return { pairs: [], note: '返回内容里没有找到 collocations 数组。' };

  const orderMap = new Map<number, CollocationWord>();
  const wordMap = new Map<string, CollocationWord>();
  for (const word of words) {
    orderMap.set(word.order, word);
    const key = normalizeWord(word.word);
    if (key && !wordMap.has(key)) wordMap.set(key, word);
  }

  const pairs = new Map<number, CollocationPair>();
  let unmatched = 0;

  for (const item of items) {
    const rawOrder = Number(item.order ?? item.no ?? item.index ?? item.id);
    const rawWord = item.word ?? item.term ?? item.entry ?? item.target;
    const forced = typeof rawWord === 'string' ? wordMap.get(normalizeWord(rawWord)) : undefined;
    const byOrder = Number.isFinite(rawOrder) ? orderMap.get(Math.trunc(rawOrder)) : undefined;
    const target = forced ?? byOrder;
    if (!target) {
      unmatched += 1;
      continue;
    }

    const collocation = cleanCollocation(
      item.collocation ?? item.collocations ?? item.phrase ?? item.pair ?? item['固定搭配'],
      target.word,
    );
    if (!collocation) continue;
    if (pairs.has(target.order)) continue;
    pairs.set(target.order, { order: target.order, word: target.word, collocation });
  }

  const list = [...pairs.values()].sort((a, b) => a.order - b.order);
  const note = list.length
    ? ''
    : unmatched
      ? `模型给了 ${unmatched} 条搭配，但序号或单词都对不上本单元词表。`
      : '模型返回的搭配都是空的，可能材料里没有这一页词表。';
  return { pairs: list, note };
}

/* ------------------------------- 请求 ------------------------------- */

async function readErrorDetail(response: Response, apiKey: string): Promise<string> {
  try {
    const raw = (await response.text()).replaceAll(apiKey, MASK).slice(0, 1200);
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

function validate(raw: unknown): CollocationRequest | string {
  if (!isRecord(raw)) return '参数无效。';
  if (typeof raw.requestId !== 'string' || !REQUEST_ID_PATTERN.test(raw.requestId)) {
    return '请求标识无效，请重新点击识别。';
  }
  if (raw.aim !== 'photo' && raw.aim !== 'file' && raw.aim !== 'paste') return '材料类型无效。';

  const unit = isRecord(raw.unit) ? raw.unit : {};
  const unitId = unitKeyOf(unit.id);
  if (!unitId) return '单元标识无效，请重新选择单元。';
  const unitLabel = typeof unit.label === 'string' ? unit.label.trim().slice(0, 60) : '';

  if (!Array.isArray(raw.words) || !raw.words.length) return '本单元没有可匹配的词条。';
  if (raw.words.length > MAX_UNIT_WORDS) return `一次最多匹配 ${MAX_UNIT_WORDS} 个词条。`;

  const words: CollocationWord[] = [];
  for (const item of raw.words) {
    if (!isRecord(item)) continue;
    const word = typeof item.word === 'string' ? item.word.trim().slice(0, 80) : '';
    const order = Number(item.order);
    if (!word || !Number.isInteger(order) || order <= 0 || order > 999) continue;
    words.push({
      order,
      word,
      ipa: typeof item.ipa === 'string' ? item.ipa.slice(0, 80) : '',
      pos: typeof item.pos === 'string' ? item.pos.slice(0, 40) : '',
      meaning: typeof item.meaning === 'string' ? item.meaning.slice(0, 160) : '',
    });
  }
  if (!words.length) return '词条缺少单词或序号，请刷新后重试。';

  let text = '';
  if (raw.aim === 'paste') {
    text = typeof raw.text === 'string' ? raw.text.trim() : '';
    if (!text) return '请先粘贴词表内容。';
    if (text.length > MAX_SOURCE_TEXT_CHARS) return `粘贴内容过长，请控制在 ${MAX_SOURCE_TEXT_CHARS} 字以内。`;
  }

  return {
    requestId: raw.requestId,
    aim: raw.aim,
    text,
    unit: { id: unitId, label: unitLabel || unitId },
    words,
  };
}

export interface ExtractOptions {
  raw: unknown;
  connection: CollocationConnection;
  store: CollocationStore;
  window?: BrowserWindow;
  fetch: FetchLike;
}

/**
 * 补全一个单元的固定搭配：
 * 照片 → 视觉模型（image_url，最多 6 张，压到 1600px）；
 * Word / 纯文本 / 粘贴 → 主力模型（纯文本更快也更省钱）。
 */
export async function extractCollocations(options: ExtractOptions): Promise<Result<CollocationSuccess>> {
  const request = validate(options.raw);
  if (typeof request === 'string') return fail('VALIDATION', request);
  if (!options.connection.apiKey) return fail('NOT_CONFIGURED', '请先在 API 设置中输入并保存密钥。');

  const { connection, store, window } = options;
  const via: 'vision' | 'text' = request.aim === 'photo' ? 'vision' : 'text';
  const model = via === 'vision' ? connection.visionModel || DEFAULT_VISION_MODEL : connection.model;
  let sourceLabel = '粘贴文本';
  let materialText = '';
  const imageUrls: string[] = [];

  try {
    if (request.aim === 'photo') {
      const picked = window
        ? await dialog.showOpenDialog(window, {
            title: '选择词表照片（最多 6 张）',
            buttonLabel: '识别',
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: '图片', extensions: IMAGE_EXTENSIONS }],
          })
        : await dialog.showOpenDialog({
            title: '选择词表照片',
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: '图片', extensions: IMAGE_EXTENSIONS }],
          });
      if (picked.canceled || !picked.filePaths.length) {
        return { ok: true, pairs: [], model, via, sourceLabel: '', canceled: true };
      }

      const { images, skipped } = await readImageFiles(picked.filePaths.slice(0, MAX_VISION_IMAGES));
      if (!images.length) {
        return fail('VALIDATION', `选中的图片无法读取${skipped.length ? `（${skipped.join('、')}）` : ''}，请换 JPG/PNG 再试。`);
      }
      imageUrls.push(...images.map((image) => image.dataUrl));
      sourceLabel = images.map((image) => image.fileName).join('、').slice(0, 80);
    } else if (request.aim === 'file') {
      const picked = window
        ? await dialog.showOpenDialog(window, {
            title: '导入词表文件',
            buttonLabel: '导入',
            properties: ['openFile'],
            filters: [{ name: 'Word 或文本', extensions: DOCUMENT_EXTENSIONS }],
          })
        : await dialog.showOpenDialog({
            title: '导入词表文件',
            properties: ['openFile'],
            filters: [{ name: 'Word 或文本', extensions: DOCUMENT_EXTENSIONS }],
          });
      if (picked.canceled || !picked.filePaths.length) {
        return { ok: true, pairs: [], model, via, sourceLabel: '', canceled: true };
      }

      const { documents, skipped } = await readDocumentFiles(picked.filePaths.slice(0, 1));
      if (!documents.length || !documents[0].text.trim()) {
        return fail(
          'VALIDATION',
          `这个文件读不出文字${skipped.length ? `（${skipped.join('、')}）` : ''}；支持 .docx/.txt/.md，旧版 .doc 请先另存为 .docx。`,
        );
      }
      materialText = documents[0].text;
      sourceLabel = documents[0].fileName;
    } else {
      materialText = request.text ?? '';
      sourceLabel = '粘贴文本';
    }
  } catch (error) {
    return fail('VALIDATION', `读取材料失败：${messageOf(error)}`);
  }

  if (via === 'vision' && !imageUrls.length) return fail('VALIDATION', '没有可识别的图片。');
  if (via === 'text' && !materialText.trim()) return fail('VALIDATION', '材料里没有文字可识别。');

  const messages = buildMessages(request.unit.label, request.words, {
    text: materialText,
    images: imageUrls,
  });

  const controller = new AbortController();
  let timedOut = false;
  const seconds = timeoutFor(via, connection.timeoutSeconds);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, seconds * 1000);

  try {
    const requestBody: Record<string, unknown> = {
      model,
      messages,
      stream: false,
      temperature: 0,
      // 视觉模型多为 instruct 版，不接受 enable_thinking；只有文本链路需要显式关思考
      ...(via === 'text' && shouldDisableThinking(model) ? { enable_thinking: false } : {}),
      max_tokens: 3000,
    };

    const send = (payload: Record<string, unknown>) =>
      options.fetch(`${connection.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${connection.apiKey}`,
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
      } as RequestInit);

    let response = await send(requestBody);

    if (!response.ok) {
      const detail = await readErrorDetail(response, connection.apiKey);
      // 个别模型会拒绝 enable_thinking 这类可选参数：去掉后重试一次
      if (
        response.status === 400 &&
        'enable_thinking' in requestBody &&
        /parameter|enable_thinking/i.test(detail)
      ) {
        delete requestBody.enable_thinking;
        response = await send(requestBody);
      } else {
        const mapped = mapHttpStatus(response.status);
        return fail(mapped.code, detail ? `${mapped.message} 服务端说明：${detail}` : mapped.message, mapped.status);
      }
    }

    if (!response.ok) {
      const mapped = mapHttpStatus(response.status);
      return fail(mapped.code, mapped.message, mapped.status);
    }

    const raw = (await response.text()).replaceAll(connection.apiKey, MASK);
    let body: unknown = null;
    try {
      body = JSON.parse(raw) as unknown;
    } catch {
      return fail('FORMAT', '服务返回的不是 JSON，无法读取识别结果。');
    }
    if (!isRecord(body) || !Array.isArray(body.choices) || !isRecord(body.choices[0])) {
      return fail('FORMAT', '响应缺少 choices，请检查接口地址是否支持该视觉模型。');
    }

    const choice = body.choices[0];
    const message = isRecord(choice.message) ? choice.message : {};
    const content = typeof message.content === 'string' ? message.content : '';
    if (!content.trim()) {
      return fail('EMPTY', '模型返回了空内容：照片可能太模糊，或该模型不支持图片输入。换个模型或换张清晰的照片再试。');
    }

    if (process.env.ETE_DEBUG_COLLOC) console.log('[colloc raw]', content);
    const { pairs, note } = matchCollocations(content, request.words);
    if (!pairs.length) {
      const failure = fail('FORMAT', note || '没有识别出可用的搭配。');
      failure.preview = content.slice(0, 2000);
      return failure;
    }

    let applied = pairs.length;
    try {
      const merged = await store.merge(request.unit.id, pairs);
      applied = merged.applied;
    } catch {
      // 落盘失败不影响本次结果，界面上仍能看到搭配
    }

    return { ok: true, pairs, model, via, sourceLabel, applied };
  } catch (error) {
    if (timedOut) {
      return fail(
        'TIMEOUT',
        `识别超过 ${seconds} 秒仍未返回，已中止。可换更小的照片、改用粘贴文本，或把视觉模型换成更快的型号。`,
      );
    }
    if (error instanceof AppError) return fail(error.code, error.message, error.status);
    const text = messageOf(error);
    if (/CERT|TLS|SSL/i.test(text)) {
      return fail('TLS', '安全连接失败，请检查系统时间、证书或代理配置。');
    }
    return fail('NETWORK', '无法连接服务或响应中断，请检查网络与基础地址。');
  } finally {
    clearTimeout(timer);
  }
}
