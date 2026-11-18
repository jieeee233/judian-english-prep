import { dialog, type BrowserWindow } from 'electron';
import path from 'node:path';
import { MAX_PASSAGE_CHARS, REQUEST_ID_PATTERN } from '../shared/constants';
import type { ArticleImportRequest, ArticleImportSuccess, Result } from '../shared/types';
import { fail, isRecord, mapHttpStatus } from './errors';
import { DOCUMENT_EXTENSIONS, IMAGE_EXTENSIONS, readDocumentFiles, readImageFiles } from './readers';

/**
 * 首页「准备文章」的导入：
 * - 照片：视觉模型整篇 OCR（正文 + 题目一起出来）
 * - 文件：docx / txt / md 直接读正文
 * - 粘贴：前端已拿到文本，这里只做清洗
 *
 * 与补搭配的区别：这里要的是**完整原文**，所以提示词禁止改写、翻译、总结。
 */

const MAX_IMAGES = 6;
const MASK = '[密钥已隐藏]';

export interface ArticleImportConnection {
  baseUrl: string;
  model: string;
  visionModel: string;
  apiKey: string;
  timeoutSeconds: number;
}

export interface ImportArticleOptions {
  raw: unknown;
  connection: ArticleImportConnection;
  window?: BrowserWindow;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
}

const SYSTEM_PROMPT = `你是英语试卷与课文的数字化助手。用户会给你一页或多页扫描件/照片，请把它们完整转成纯文本，遵守：
1. 逐字转录，保留原文的大小写、标点、数字和段落顺序；不要翻译、不要改写、不要总结、不要补充。
2. 文章正文按原段落分段，段与段之间空一行。
3. 如果图片里有题目：先输出题干，再按原样输出选项（每行一个，如 A. xxx），阅读理解的题号与文章对应关系保持不变。
4. 页眉、页脚、页码、水印、装订线、广告一律忽略；模糊到无法辨认的词用 [?] 代替，不要猜。
5. 不要输出任何说明文字、标题标注（如「以下是识别结果」）、Markdown 围栏或思考过程，只输出干净的正文。`;

function timeoutFor(seconds: number): number {
  // 视觉模型读整页文字较慢，给足时间
  return Math.min(300, Math.max(180, seconds * 3)) * 1000;
}

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
      // 非 JSON 退回纯文本
    }
    return raw.replace(/\s+/g, ' ').trim().slice(0, 300);
  } catch {
    return '';
  }
}

/** 首行像「以下是xx内容」这类说明的白名单句式 */
const META_LINE = /^(以下|下面|这是|以下为|以下内容|下面内容|如下)[^\n]{0,58}(内容|原文|识别|转录|提取|结果|文字)[^\n]{0,10}$/;

/** 去掉开头最多两行客套说明（模型/用户复制时常带），避免混进正文。 */
function stripLeadingMeta(text: string): string {
  const lines = text.split('\n');
  let start = 0;
  while (start < lines.length && !lines[start].trim()) start += 1;
  let dropped = 0;
  while (start + dropped < lines.length && dropped < 2) {
    const line = lines[start + dropped].trim();
    if (!line) {
      dropped += 1;
      continue;
    }
    if (META_LINE.test(line) && !/[。！？!?]$/.test(line)) {
      dropped += 1;
      continue;
    }
    break;
  }
  return dropped ? lines.slice(start + dropped).join('\n') : text;
}

/** 清掉模型爱加的外壳：围栏、说明前缀、多余空行。 */
export function cleanArticleText(raw: string): string {
  let text = raw.replace(/\r\n?/g, '\n').trim();
  text = text.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '');
  text = text.replace(/^(以下是|下面是|这是)[^\n]{0,30}(识别|转录|提取)[^\n]{0,20}[：:]\s*/i, '');
  text = stripLeadingMeta(text);
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim().slice(0, MAX_PASSAGE_CHARS);
}

function extensionOf(filePath: string): string {
  return path.extname(filePath).replace(/^\./, '').toLowerCase();
}

function validate(raw: unknown): ArticleImportRequest | string {
  if (!isRecord(raw)) return '参数无效。';
  if (typeof raw.requestId !== 'string' || !REQUEST_ID_PATTERN.test(raw.requestId)) {
    return '请求标识无效，请重新点击导入。';
  }
  if (raw.aim !== 'photo' && raw.aim !== 'file') return '导入方式无效。';
  let paths: string[] = [];
  if (raw.paths !== undefined) {
    if (!Array.isArray(raw.paths)) return '文件参数无效。';
    paths = raw.paths.filter((item): item is string => typeof item === 'string' && item.length > 0);
    if (paths.length !== raw.paths.length) return '文件参数无效。';
    if (paths.length > MAX_IMAGES) return `一次最多拖入 ${MAX_IMAGES} 个文件。`;
    // 只接受本机绝对路径，且扩展名必须在白名单里
    for (const item of paths) {
      if (!path.isAbsolute(item)) return '文件路径无效。';
      const ext = extensionOf(item);
      if (!DOCUMENT_EXTENSIONS.includes(ext) && !IMAGE_EXTENSIONS.includes(ext)) {
        return `不支持的文件类型「.${ext || '未知'}」，请拖入图片、.docx、.txt、.md。`;
      }
    }
  }
  return { requestId: raw.requestId, aim: raw.aim, ...(paths.length ? { paths } : {}) };
}

type ImportResult = Result<ArticleImportSuccess>;

/** 读 Word / 文本：只取第一个能读出正文的文件。 */
async function importDocuments(filePaths: string[]): Promise<ImportResult> {
  const { documents, skipped } = await readDocumentFiles(filePaths.slice(0, 1));
  const text = documents[0] ? cleanArticleText(documents[0].text) : '';
  if (!text) {
    return fail(
      'VALIDATION',
      `这个文件读不出文字${skipped.length ? `（${skipped.join('、')}）` : ''}；支持 .docx/.txt/.md，旧版 .doc 请先另存为 .docx。`,
    );
  }
  return {
    ok: true,
    text,
    sourceLabel: documents[0].fileName,
    via: 'text',
    imageCount: 0,
  };
}

/** 照片：视觉模型整篇 OCR（正文 + 题目一起出来）。 */
async function importImages(
  filePaths: string[],
  connection: ArticleImportConnection,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
): Promise<ImportResult> {
  if (!connection.apiKey) return fail('NOT_CONFIGURED', '请先在 API 设置中输入并保存密钥。');

  const { images, skipped } = await readImageFiles(filePaths.slice(0, MAX_IMAGES));
  if (!images.length) {
    return fail(
      'VALIDATION',
      `选中的图片无法读取${skipped.length ? `（${skipped.join('、')}）` : ''}，请换 JPG/PNG 再试。`,
    );
  }

  const model = connection.visionModel || connection.model;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutFor(connection.timeoutSeconds));

  const parts: Array<Record<string, unknown>> = [
    {
      type: 'text',
      text: `共 ${images.length} 页图片，按顺序转录成一份完整文本（正文 + 题目）。只输出正文。`,
    },
    ...images.map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl } })),
  ];

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: parts },
    ],
    stream: false,
    temperature: 0,
    max_tokens: 6000,
  };
  // 视觉模型（Qwen3-VL 等）是 instruct 版，传 enable_thinking 会被服务端 400 拒掉；
  // 这条链路固定走视觉模型，所以一律不传思考开关。
  if (!/vl/i.test(model) && /qwen3/i.test(model)) body.enable_thinking = false;

  try {
    const send = (requestBody: Record<string, unknown>) =>
      fetchImpl(`${connection.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${connection.apiKey}`,
          Accept: 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
      } as RequestInit);

    let response = await send(body);
    // 个别模型仍会拒绝 enable_thinking 这类可选参数：去掉后重试一次
    if (!response.ok && 'enable_thinking' in body) {
      const detail = await readErrorDetail(response, connection.apiKey);
      if (/enable_thinking|parameter/i.test(detail)) {
        delete body.enable_thinking;
        response = await send(body);
      }
    }

    if (!response.ok) {
      const detail = await readErrorDetail(response, connection.apiKey);
      const mapped = mapHttpStatus(response.status);
      return fail(mapped.code, detail ? `${mapped.message} 服务端说明：${detail}` : mapped.message);
    }

    const payload = (await response.json()) as unknown;
    const content =
      isRecord(payload) && Array.isArray(payload.choices) && isRecord(payload.choices[0])
        ? isRecord(payload.choices[0].message) && typeof payload.choices[0].message.content === 'string'
          ? payload.choices[0].message.content
          : ''
        : '';
    if (!content.trim()) return fail('EMPTY', '模型没有返回文字，换一张更清晰的照片再试。');

    const text = cleanArticleText(content);
    if (!text) return fail('EMPTY', '识别结果为空，换一张更清晰的照片再试。');

    return {
      ok: true,
      text,
      sourceLabel: images.map((image) => image.fileName).join('、').slice(0, 80),
      via: 'vision',
      imageCount: images.length,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return fail('TIMEOUT', '识别超时，照片多时可以分两次导入。');
    }
    const message = error instanceof Error ? error.message : '';
    return fail('NETWORK', `识别请求失败，请检查网络后重试。${message ? `（${message}）` : ''}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 入口。两条来源：
 * - 工具栏「导入文件」：弹系统对话框挑文件
 * - 把文件拖到编辑区：渲染进程给出本机路径，跳过对话框
 * 拖入时按扩展名分流：有文档读文档，只有图片才走视觉识别。
 */
export async function importArticle(options: ImportArticleOptions): Promise<Result<ArticleImportSuccess>> {
  const request = validate(options.raw);
  if (typeof request === 'string') return fail('VALIDATION', request);
  const { connection, window } = options;

  const dropped = request.paths ?? [];
  if (dropped.length) {
    const documents = dropped.filter((item) => DOCUMENT_EXTENSIONS.includes(extensionOf(item)));
    const images = dropped.filter((item) => IMAGE_EXTENSIONS.includes(extensionOf(item)));
    if (documents.length) {
      const result = await importDocuments(documents);
      if (result.ok || !images.length) return result;
    }
    return importImages(images, connection, options.fetch);
  }

  if (request.aim === 'file') {
    const picked = window
      ? await dialog.showOpenDialog(window, {
          title: '导入文章文件',
          buttonLabel: '导入',
          properties: ['openFile'],
          filters: [{ name: 'Word 或文本', extensions: DOCUMENT_EXTENSIONS }],
        })
      : await dialog.showOpenDialog({
          title: '导入文章文件',
          properties: ['openFile'],
          filters: [{ name: 'Word 或文本', extensions: DOCUMENT_EXTENSIONS }],
        });
    if (picked.canceled || !picked.filePaths.length) {
      return { ok: true, text: '', sourceLabel: '', via: 'text', imageCount: 0, canceled: true };
    }
    return importDocuments(picked.filePaths);
  }

  const picked = window
    ? await dialog.showOpenDialog(window, {
        title: `选择文章照片（最多 ${MAX_IMAGES} 张）`,
        buttonLabel: '识别',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '图片', extensions: IMAGE_EXTENSIONS }],
      })
    : await dialog.showOpenDialog({
        title: '选择文章照片',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '图片', extensions: IMAGE_EXTENSIONS }],
      });
  if (picked.canceled || !picked.filePaths.length) {
    return { ok: true, text: '', sourceLabel: '', via: 'vision', imageCount: 0, canceled: true };
  }
  return importImages(picked.filePaths, connection, options.fetch);
}
