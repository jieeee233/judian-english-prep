/**
 * 字段读取的通用工具：模型经常换同义词、给数组、给数字，
 * 这里统一收成「能放进界面的字符串」。
 */
import { MAX_FIELD_CHARS } from '../../shared/constants';
import { isRecord } from '../errors';

/** 键名归一：下划线、连字符、空格都去掉再比，`main_idea` 与 `mainIdea` 等价 */
export function normalizeKey(key: string): string {
  return key.replace(/[\s_\-]/g, '').toLowerCase();
}

/** 按别名列表取第一个命中的字段 */
export function pick(record: Record<string, unknown>, aliases: string[]): unknown {
  const normalized = aliases.map(normalizeKey);
  for (const [key, value] of Object.entries(record)) {
    if (normalized.includes(normalizeKey(key))) return value;
  }
  return undefined;
}

/** 任意值 → 受长度限制的字符串；数组按「；」拼起来 */
export function text(value: unknown): string {
  if (typeof value === 'string') return value.trim().slice(0, MAX_FIELD_CHARS);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('；').slice(0, MAX_FIELD_CHARS);
  return '';
}

/** 把数组、或「以序号为键的对象」都当成条目列表 */
export function asItems(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.filter(isRecord);
  if (isRecord(raw)) return Object.values(raw).filter(isRecord);
  return [];
}

/** 字段里出现"文中未出现""虚构示例"这类自述，说明是凑数条目，直接判无效。 */
const SELF_NARRATION: RegExp[] = [
  /文中(未|没有|并未)(直接)?出现/,
  /虚构/,
  /为(了)?(符合|满足)(要求|提示|数量|格式)/,
  /(依据|按)提示词/,
  /此处(为|是|系)(虚构|示例|假设|占位)/,
  /占位符/,
];

export function isSelfNarration(value: string): boolean {
  return SELF_NARRATION.some((pattern) => pattern.test(value));
}

export function failed(reason: string, issues: string[] = []): { value: null; issues: string[]; reason: string } {
  return { value: null, issues: [reason, ...issues], reason };
}

/** 短引用，用于问题提示里定位是哪一条 */
export function brief(value: string, length = 16): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > length ? `${clean.slice(0, length)}…` : clean;
}
