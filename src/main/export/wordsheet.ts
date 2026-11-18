import { AlignmentType, Document, Packer, Paragraph, TextRun } from 'docx';
import type { WordSheetItem, WordSheetMode, WordSheetPayload } from '../../shared/types';

const INK = '1F2A33';
const MUTED = '6B7A8C';

const FONT = {
  ascii: 'Times New Roman',
  hAnsi: 'Times New Roman',
  eastAsia: '宋体',
  cs: 'Times New Roman',
};

/** 留白长度：够学生手写一个单词/一条释义，又不至于把行撑满 */
const BLANK = '＿'.repeat(16);
const BLANK_CN = '＿'.repeat(14);

interface SheetCopy {
  title: string;
  instruction: string;
}

function copyFor(mode: WordSheetMode): SheetCopy {
  if (mode === 'en2zh') {
    return { title: '词汇默写单', instruction: '根据英文单词和词性，写出对应的中文释义。' };
  }
  if (mode === 'zh2en') {
    return { title: '词汇默写单', instruction: '根据词性和中文释义，写出对应的英文单词。' };
  }
  return { title: '词汇单', instruction: '英文单词、音标、词性与释义对照。' };
}

function cleanWord(item: WordSheetItem): string {
  return item.word.trim();
}

/** 一行词条：编号统一两位对齐，正文按模式取舍。 */
function itemParagraph(index: number, item: WordSheetItem, mode: WordSheetMode): Paragraph {
  const no = `${index + 1}.`;
  const pos = item.pos.trim();
  const meaning = item.meaning.trim();
  const ipa = item.ipa.trim();

  const runs: TextRun[] = [];
  const num = `${no} `;
  const bodySize = 24; // 12pt：足够大，手写留白也够

  if (mode === 'en2zh') {
    runs.push(new TextRun({ text: num, size: bodySize, color: MUTED, font: FONT }));
    runs.push(new TextRun({ text: cleanWord(item), size: bodySize, bold: true, color: INK, font: FONT }));
    if (pos) runs.push(new TextRun({ text: ` ${pos}`, size: bodySize, color: MUTED, font: FONT }));
    runs.push(new TextRun({ text: `   ${BLANK_CN}`, size: bodySize, color: INK, font: FONT }));
  } else if (mode === 'zh2en') {
    runs.push(new TextRun({ text: num, size: bodySize, color: MUTED, font: FONT }));
    if (pos) runs.push(new TextRun({ text: `${pos} `, size: bodySize, color: MUTED, font: FONT }));
    runs.push(new TextRun({ text: meaning, size: bodySize, color: INK, font: FONT }));
    runs.push(new TextRun({ text: `   ${BLANK}`, size: bodySize, color: INK, font: FONT }));
  } else {
    runs.push(new TextRun({ text: num, size: bodySize, color: MUTED, font: FONT }));
    runs.push(new TextRun({ text: cleanWord(item), size: bodySize, bold: true, color: INK, font: FONT }));
    if (ipa) runs.push(new TextRun({ text: `  /${ipa.replace(/^\/|\/$/g, '')}/`, size: 21, color: MUTED, font: FONT }));
    if (pos) runs.push(new TextRun({ text: `  ${pos}`, size: 21, color: MUTED, font: FONT }));
    runs.push(new TextRun({ text: `  ${meaning}`, size: bodySize, color: INK, font: FONT }));
  }

  return new Paragraph({
    children: runs,
    spacing: { before: mode === 'both' ? 60 : 130, after: mode === 'both' ? 60 : 130, line: 320 },
    indent: { left: 220, hanging: 220 },
  });
}

export async function buildWordSheetBuffer(payload: WordSheetPayload): Promise<Buffer> {
  const { mode, items } = payload;
  const copy = copyFor(mode);
  const heading = payload.title?.trim() || copy.title;

  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({ text: heading, bold: true, size: 36, color: INK, font: FONT })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: mode === 'both' ? 260 : 180 },
      children: [new TextRun({ text: copy.instruction, size: 21, color: MUTED, font: FONT })],
    }),
  ];

  if (mode !== 'both') {
    children.push(
      new Paragraph({
        spacing: { after: 220 },
        children: [
          new TextRun({ text: '班级：____________', size: 21, color: INK, font: FONT }),
          new TextRun({ text: '      ', size: 21, color: INK, font: FONT }),
          new TextRun({ text: '姓名：____________', size: 21, color: INK, font: FONT }),
          new TextRun({ text: '      ', size: 21, color: INK, font: FONT }),
          new TextRun({ text: '得分：__________', size: 21, color: INK, font: FONT }),
        ],
      }),
    );
  }

  items.forEach((item, index) => children.push(itemParagraph(index, item, mode)));

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { size: 24, color: INK, font: FONT },
          paragraph: { spacing: { line: 320 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
