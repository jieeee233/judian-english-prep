import { app, dialog, type BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  DemoCollocation,
  DemoExercise,
  DemoExportResult,
  ExportPayload,
  ExportSuccess,
  Result,
  WordSheetItem,
  WordSheetMode,
  WordSheetPayload,
} from '../../shared/types';
import { fail, isRecord } from '../errors';
import { buildDemoHtml } from './demoHtml';
import { buildDocxBuffer } from './docx';
import { buildMarkdown } from './markdown';
import { buildWordSheetBuffer } from './wordsheet';

/** 渲染层传来的搭配/练习一律当不可信数据，逐字段裁剪后再用。 */
function readCollocations(raw: unknown, fallbackText: string): DemoCollocation[] {
  const list = Array.isArray(raw) ? raw : [];
  const cleaned = list.slice(0, 6).flatMap((item) => {
    if (!isRecord(item)) return [];
    const pattern = typeof item.pattern === 'string' ? item.pattern.trim().slice(0, 120) : '';
    if (!pattern) return [];
    const meaning = typeof item.meaning === 'string' ? item.meaning.trim().slice(0, 120) : '';
    return [{ pattern, meaning }];
  });
  if (cleaned.length) return cleaned;
  return fallbackText ? [{ pattern: fallbackText.slice(0, 160), meaning: '' }] : [];
}

function readExercises(raw: unknown): DemoExercise[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.slice(0, 8).flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const stem = typeof item.stem === 'string' ? item.stem.trim().slice(0, 600) : '';
    if (!stem) return [];
    const answer = typeof item.answer === 'string' ? item.answer.trim().slice(0, 200) : '';
    if (!answer) return [];
    const options = Array.isArray(item.options)
      ? item.options.filter((opt): opt is string => typeof opt === 'string' && Boolean(opt.trim()))
          .slice(0, 6)
          .map((opt) => opt.trim().slice(0, 160))
      : [];
    return [
      {
        id: typeof item.id === 'string' && item.id ? item.id.slice(0, 60) : `ex-${index + 1}`,
        type: typeof item.type === 'string' ? item.type.slice(0, 20) : 'prep',
        point: typeof item.point === 'string' ? item.point.slice(0, 40) : '',
        stem,
        answer,
        hint: typeof item.hint === 'string' ? item.hint.slice(0, 80) : '',
        explanation: typeof item.explanation === 'string' ? item.explanation.slice(0, 400) : '',
        options,
      },
    ];
  });
}

function validatePayload(raw: unknown): ExportPayload | string {
  if (!isRecord(raw)) return '导出参数无效。';
  const { format, sections, input, model, completedAt, source, isSample, title } = raw;

  if (format !== 'docx' && format !== 'md') return '导出格式无效。';
  if (!Array.isArray(sections) || !sections.length || sections.length > 8) {
    return '导出内容不完整，缺少解析板块。';
  }
  for (const section of sections) {
    if (!isRecord(section) || typeof section.text !== 'string' || !section.text.trim()) {
      return '导出内容不完整，缺少解析板块。';
    }
  }
  if (!isRecord(input)) return '导出参数无效。';
  if (typeof input.text !== 'string' || !input.text.trim()) return '导出参数无效。';
  if (typeof completedAt !== 'string') return '导出参数无效。';
  if (source !== 'api' && source !== 'demo') return '导出参数无效。';
  if (typeof isSample !== 'boolean') return '导出参数无效。';
  if (typeof model !== 'string') return '导出参数无效。';
  if (title !== undefined && (typeof title !== 'string' || title.length > 120)) return '导出标题无效。';

  return {
    format,
    sections: sections.map((section, index) => ({
      id: typeof section.id === 'string' && section.id ? section.id : `part-${index + 1}`,
      title: String(section.title ?? ''),
      text: String(section.text),
    })),
    input: { text: input.text },
    model,
    completedAt,
    source,
    isSample,
    title,
  };
}

function defaultFileName(payload: ExportPayload): string {
  const date = new Date(payload.completedAt);
  const stamp = Number.isNaN(date.getTime())
    ? ''
    : `-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const safeTitle = payload.title?.trim();
  const base = safeTitle || `英语文章解析教案${stamp}`;
  return `${base.replace(/[\\/:*?"<>|]/g, '_')}.${payload.format}`;
}

export async function exportLesson(
  window: BrowserWindow | null,
  raw: unknown,
): Promise<Result<ExportSuccess>> {
  const validated = validatePayload(raw);
  if (typeof validated === 'string') return fail('VALIDATION', validated);
  const payload = validated;

  try {
    const result = window
      ? await dialog.showSaveDialog(window, {
          title: payload.format === 'docx' ? '导出 Word 教案' : '导出 Markdown 教案',
          defaultPath: path.join(app.getPath('documents'), defaultFileName(payload)),
          buttonLabel: '导出',
          filters:
            payload.format === 'docx'
              ? [{ name: 'Word 文档', extensions: ['docx'] }]
              : [{ name: 'Markdown', extensions: ['md'] }],
        })
      : await dialog.showSaveDialog({
          title: '导出教案',
          defaultPath: path.join(app.getPath('documents'), defaultFileName(payload)),
        });

    if (result.canceled || !result.filePath) {
      return { ok: true, filePath: '', canceled: true };
    }

    if (payload.format === 'docx') {
      const buffer = await buildDocxBuffer(payload);
      await fs.writeFile(result.filePath, buffer);
    } else {
      await fs.writeFile(result.filePath, buildMarkdown(payload), 'utf8');
    }
    return { ok: true, filePath: result.filePath };
  } catch (error) {
    const detail = error instanceof Error ? error.message : '';
    return fail('EXPORT', `导出失败，请检查目标文件是否被占用或换个位置重试。${detail ? `（${detail}）` : ''}`);
  }
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '单词演示';
}

const SHEET_MODES: WordSheetMode[] = ['en2zh', 'zh2en', 'both'];

/** 词单/默写单：只有段落和编号，不做表格。 */
export async function exportWordSheet(
  payload: unknown,
  window?: BrowserWindow,
): Promise<Result<ExportSuccess>> {
  if (!isRecord(payload)) return fail('VALIDATION', '导出参数无效。');
  const mode = payload.mode as WordSheetMode;
  if (!SHEET_MODES.includes(mode)) return fail('VALIDATION', '导出方式无效。');

  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const items: WordSheetItem[] = rawItems.slice(0, 400).flatMap((item) => {
    if (!isRecord(item)) return [];
    const word = typeof item.word === 'string' ? item.word.trim().slice(0, 60) : '';
    if (!word) return [];
    return [
      {
        word,
        ipa: typeof item.ipa === 'string' ? item.ipa.trim().slice(0, 60) : '',
        pos: typeof item.pos === 'string' ? item.pos.trim().slice(0, 20) : '',
        meaning: typeof item.meaning === 'string' ? item.meaning.trim().slice(0, 120) : '',
      },
    ];
  });
  if (!items.length) return fail('VALIDATION', '请先勾选要导出的单词。');

  const title = typeof payload.title === 'string' ? payload.title.slice(0, 80) : '';
  const label = mode === 'both' ? '词汇单' : mode === 'en2zh' ? '默写单-英译汉' : '默写单-汉译英';
  const options = {
    title: `导出${label}`,
    defaultPath: path.join(app.getPath('documents'), `${safeFileName(title || label)}.docx`),
    buttonLabel: '导出',
    filters: [{ name: 'Word 文档', extensions: ['docx'] }],
  };

  try {
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { ok: true, filePath: '', canceled: true };
    const buffer = await buildWordSheetBuffer({ mode, title, items } as WordSheetPayload);
    await fs.writeFile(result.filePath, buffer);
    return { ok: true, filePath: result.filePath };
  } catch (error) {
    const detail = error instanceof Error ? error.message : '';
    return fail('EXPORT', `导出失败，请检查目标文件是否被占用或换个位置重试。${detail ? `（${detail}）` : ''}`);
  }
}

/** 演示文件：单个自包含 HTML，双击即可在浏览器/一体机上打开。 */
export async function exportDemo(
  payload: unknown,
  window?: BrowserWindow,
): Promise<Result<DemoExportResult>> {
  if (!isRecord(payload)) return fail('VALIDATION', '演示参数无效。');
  const title = typeof payload.title === 'string' ? payload.title.slice(0, 80) : '单词演示';
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  if (!rawItems.length) return fail('VALIDATION', '请先选择要演示的词条。');

  const items = rawItems.slice(0, 400).flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const word = typeof item.word === 'string' ? item.word.trim() : '';
    if (!word) return [];
    const collocation = typeof item.collocation === 'string' ? item.collocation : '';
    return [
      {
        order: typeof item.order === 'number' && item.order > 0 ? item.order : index + 1,
        word,
        ipa: typeof item.ipa === 'string' ? item.ipa : '',
        pos: typeof item.pos === 'string' ? item.pos : '',
        meaning: typeof item.meaning === 'string' ? item.meaning : '',
        collocation,
        collocations: readCollocations(item.collocations, collocation),
        exercises: readExercises(item.exercises),
      },
    ];
  });
  if (!items.length) return fail('VALIDATION', '没有有效的词条可演示。');

  const options = {
    title: '导出单词演示文件',
    defaultPath: path.join(app.getPath('documents'), `${safeFileName(title)}.html`),
    buttonLabel: '导出',
    filters: [{ name: 'HTML 演示文件', extensions: ['html'] }],
  };
  try {
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { ok: true, filePath: '', canceled: true };
    await fs.writeFile(result.filePath, buildDemoHtml(title, items), 'utf8');
    return { ok: true, filePath: result.filePath };
  } catch (error) {
    const detail = error instanceof Error ? error.message : '';
    return fail('EXPORT', `导出失败，请检查目标文件是否被占用或换个位置重试。${detail ? `（${detail}）` : ''}`);
  }
}
