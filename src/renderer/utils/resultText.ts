import { formatDateTime } from '../../shared/format';
import { payloadSections } from '../../shared/derive';
import { BLOCK_TITLES } from '../../shared/constants';
import type { AnalysisResult } from '../../shared/types';

/** 复制到剪贴板的文本：永远带上来源标注与依据说明，便于留档。 */
export function buildResultText(result: AnalysisResult): string {
  const missing = result.missing?.length
    ? `未生成板块：${result.missing.map((block) => BLOCK_TITLES[block]).join('、')}`
    : '';
  const header = [
    result.source === 'api' ? '【AI 解析结果 · 待教师审核】' : '【演示结果 · 非 AI 生成】',
    result.source === 'api'
      ? `模型：${result.model}；完成时间：${formatDateTime(result.completedAt)}；依据本次输入文章，未经教师验收。`
      : '内容依据：内置自编文章 A Small Act of Kindness；未经教师验收。',
    ...(missing ? [missing] : []),
    ...(result.issues?.length ? [`校验提示：${result.issues.join('；')}`] : []),
  ];
  return [...header, ...payloadSections(result).map((section) => `\n${section.title}\n${section.text}`)].join('\n');
}
