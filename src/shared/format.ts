import type { AnalysisResult } from './types';

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function formatRelative(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diff = Date.now() - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return formatDateTime(iso);
}

type SourceLike = Pick<AnalysisResult, 'source' | 'isSample' | 'model'>;

export function sourceLabel(payload: SourceLike): string {
  if (payload.source === 'demo') {
    return payload.isSample ? '演示内容（内置自编文章）' : '演示流程占位（非 AI 生成）';
  }
  return payload.model ? `AI 解析 · ${payload.model}` : 'AI 解析';
}

/** 四种来源/状态统一的免责与依据说明，导出的每一种格式都带这段。 */
export function evidenceNotes(payload: SourceLike): string[] {
  return [
    '教材依据：未提供出版社、版本、册次、单元或可靠参考资料，未进行教材匹配。',
    payload.source === 'demo'
      ? '声明：本次为演示内容，不是 AI 解析结果，不可直接用于课堂。'
      : '声明：本教案由 AI 辅助生成，未经教师验收，请核对原文依据后再用于课堂。',
  ];
}
