/**
 * 原文分段与段落定位。
 *
 * 解析页左栏、结果面板的「P2 · 定位原文」都按同一套规则算段号，
 * 否则同一句话在两处会显示成不同段落。
 */

export interface Paragraph {
  index: number;
  label: string;
  start: number;
  end: number;
  text: string;
}

/**
 * 按空行切段；整篇只有一段但行数很多时按行切（试卷常见一行一段）。
 */
export function splitParagraphs(text: string): Paragraph[] {
  if (!text.trim()) return [];
  const parts: Paragraph[] = [];
  const push = (start: number, end: number) => {
    const raw = text.slice(start, end);
    if (!raw.trim()) return;
    const lead = raw.length - raw.trimStart().length;
    const begin = start + lead;
    const stop = start + raw.trimEnd().length;
    parts.push({
      index: parts.length + 1,
      label: `P${parts.length + 1}`,
      start: begin,
      end: stop,
      text: text.slice(begin, stop),
    });
  };

  const splitter = /\n[ \t]*\n+/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = splitter.exec(text))) {
    push(cursor, match.index);
    cursor = match.index + match[0].length;
  }
  push(cursor, text.length);

  if (parts.length <= 1) {
    const lines = text.split('\n').filter((line) => line.trim());
    if (lines.length > 3) {
      const rebuilt: Paragraph[] = [];
      let offset = 0;
      for (const line of text.split('\n')) {
        if (line.trim()) {
          const begin = offset + (line.length - line.trimStart().length);
          rebuilt.push({
            index: rebuilt.length + 1,
            label: `P${rebuilt.length + 1}`,
            start: begin,
            end: begin + line.trim().length,
            text: line.trim(),
          });
        }
        offset += line.length + 1;
      }
      return rebuilt;
    }
  }
  return parts;
}

/** 字符偏移落在第几段，找不到返回 null */
export function paragraphAtOffset(paragraphs: Paragraph[], offset: number): Paragraph | null {
  return paragraphs.find((item) => offset >= item.start && offset < item.end) ?? null;
}
