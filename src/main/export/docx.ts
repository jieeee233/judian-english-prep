import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { formatDateTime, sourceLabel } from '../../shared/format';
import type { ExportPayload } from '../../shared/types';

const INK = '24343A';
const DEEP = '193D3A';
const MUTED = '6B7F86';
const LINE = 'DDE3E6';
const SOFT = 'F3F6F5';

const FONT = {
  ascii: 'Microsoft YaHei',
  hAnsi: 'Microsoft YaHei',
  eastAsia: '微软雅黑',
  cs: 'Microsoft YaHei',
};

const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八'];

function thinBorders(color = LINE) {
  const edge = { style: BorderStyle.SINGLE, size: 4, color };
  return { top: edge, bottom: edge, left: edge, right: edge, insideHorizontal: edge, insideVertical: edge };
}

function metaTable(rows: Array<[string, string]>): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: thinBorders(),
    rows: rows.map(
      ([label, value]) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 22, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, fill: SOFT, color: 'auto' },
              margins: { top: 90, bottom: 90, left: 140, right: 140 },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: label, bold: true, size: 20, color: '2F4F4A', font: FONT })],
                }),
              ],
            }),
            new TableCell({
              width: { size: 78, type: WidthType.PERCENTAGE },
              margins: { top: 90, bottom: 90, left: 140, right: 140 },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: value, size: 20, color: INK, font: FONT })],
                }),
              ],
            }),
          ],
        }),
    ),
  });
}

/** 正文按行拆段：识别行首标签加粗、识别项目符号并做悬挂缩进。 */
function bodyParagraphs(text: string): Paragraph[] {
  const out: Paragraph[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      out.push(new Paragraph({ spacing: { after: 40 }, children: [] }));
      continue;
    }

    const bulletMatch = /^([-*·•]|\d+[.、)）])\s*/.exec(line);
    const bullet = bulletMatch?.[1];
    const content = bullet ? line.slice(bulletMatch[0].length).trim() : line;

    // 形如 “abandon（v.）：放弃” / “原文句：…” 的行首标签，加粗以提升可读性
    const labelMatch = /^(.{1,26}?)[：:]\s*(.+)$/.exec(content);
    const runs: TextRun[] = [];
    if (labelMatch) {
      runs.push(new TextRun({ text: `${labelMatch[1]}：`, bold: true, size: 21, color: '2F4F4A', font: FONT }));
      runs.push(new TextRun({ text: labelMatch[2], size: 21, color: INK, font: FONT }));
    } else {
      if (bullet) {
        runs.push(new TextRun({ text: /^\d/.test(bullet) ? `${bullet} ` : '· ', size: 21, color: DEEP, font: FONT }));
      }
      runs.push(new TextRun({ text: content, size: 21, color: INK, font: FONT }));
    }

    out.push(
      new Paragraph({
        children: runs,
        spacing: { after: 110, line: 320 },
        indent: bullet ? { left: 340, hanging: 240 } : undefined,
      }),
    );
  }
  return out;
}

export async function buildDocxBuffer(payload: ExportPayload): Promise<Buffer> {
  const { input, sections } = payload;

  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: '英语文章解析教案', bold: true, size: 36, color: DEEP, font: FONT })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 260 },
      children: [
        new TextRun({
          text: 'AI 辅助备课 · 内容待教师核对',
          size: 18,
          color: MUTED,
          font: FONT,
          characterSpacing: 40,
        }),
      ],
    }),
    metaTable([
      ['解析板块', `${sections.length} 个`],
      ['生成来源', sourceLabel(payload)],
      ['生成时间', formatDateTime(payload.completedAt)],
      ['文章长度', `${input.text.length} 字符`],
    ]),
    new Paragraph({
      spacing: { before: 300, after: 120 },
      children: [
        new TextRun({
          text: '教材依据：未提供出版社、版本、册次、单元或可靠参考资料，本教案未进行教材匹配，也未推定官方词表或课标等级。',
          size: 18,
          color: MUTED,
          font: FONT,
          italics: true,
        }),
      ],
    }),
  ];

  sections.forEach((section, index) => {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 320, after: 160 },
        children: [
          new TextRun({
            text: `${CN_NUM[index] ?? index + 1}、${section.title}`,
            bold: true,
            size: 26,
            color: DEEP,
            font: FONT,
          }),
        ],
      }),
    );
    children.push(...bodyParagraphs(section.text));
  });

  children.push(
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 120, after: 160 },
      children: [new TextRun({ text: '附：文章原文', bold: true, size: 26, color: DEEP, font: FONT })],
    }),
    ...input.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(
        (line) =>
          new Paragraph({
            spacing: { after: 100, line: 320 },
            indent: { left: 300 },
            children: [new TextRun({ text: line, size: 20, color: '3C4E54', font: FONT })],
          }),
      ),
  );

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { size: 21, color: INK, font: FONT },
          paragraph: { spacing: { line: 320 } },
        },
      },
      paragraphStyles: [
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 26, bold: true, color: DEEP, font: FONT },
          paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 1 },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: '句点英语备课 · 第 ', size: 18, color: MUTED, font: FONT }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 18, color: MUTED, font: FONT }),
                  new TextRun({ text: ' 页', size: 18, color: MUTED, font: FONT }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
