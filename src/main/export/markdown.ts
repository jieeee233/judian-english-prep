import { evidenceNotes, formatDateTime, sourceLabel } from '../../shared/format';
import type { ExportPayload } from '../../shared/types';

const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八'];

export function buildMarkdown(payload: ExportPayload): string {
  const { input, sections } = payload;
  const lines: string[] = [];

  lines.push('# 英语文章解析教案', '');
  lines.push(`- 生成来源：${sourceLabel(payload)}`);
  lines.push(`- 生成时间：${formatDateTime(payload.completedAt)}`, '');

  for (const note of evidenceNotes(payload)) {
    lines.push(`> ${note}`);
  }
  lines.push('');

  sections.forEach((section, index) => {
    lines.push(`## ${CN_NUM[index] ?? index + 1}、${section.title}`, '');
    lines.push(section.text.trim(), '');
  });

  lines.push('---', '', '### 附：文章原文', '');
  for (const line of input.text.split(/\r?\n/)) {
    lines.push(line.trim() ? `> ${line.trim()}` : '>');
  }
  lines.push('');
  return lines.join('\n');
}
