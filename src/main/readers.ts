import { nativeImage, type NativeImage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MAX_IMAGE_BYTES } from '../shared/constants';

/** 单张源图上限：再大也没必要解析，先拦下来避免读进内存。 */
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp'];
export const DOCUMENT_EXTENSIONS = ['docx', 'txt', 'md', 'csv', 'markdown'];

export interface ImagePayload {
  dataUrl: string;
  fileName: string;
  bytes: number;
}

function fit(image: NativeImage, maxWidth: number): NativeImage {
  const { width, height } = image.getSize();
  if (!width || !height || width <= maxWidth) return image;
  const ratio = maxWidth / width;
  return image.resize({
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
    quality: 'good',
  });
}

/**
 * 把照片压成 base64 data URL。
 * 手机拍的一页书常见 3～8MB，直接发会把请求体撑爆，也让模型变慢；
 * 1600px 宽 + JPEG 82 对纸质书足够看清小字。
 */
export async function readImageFiles(
  filePaths: string[],
): Promise<{ images: ImagePayload[]; skipped: string[]; bytes: number }> {
  const images: ImagePayload[] = [];
  const skipped: string[] = [];
  let bytes = 0;

  for (const filePath of filePaths) {
    const name = path.basename(filePath);
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_SOURCE_BYTES) {
        skipped.push(name);
        continue;
      }
      const image = nativeImage.createFromPath(filePath);
      if (image.isEmpty()) {
        skipped.push(name);
        continue;
      }
      let buffer = fit(image, 1600).toJPEG(82);
      if (buffer.byteLength > MAX_IMAGE_BYTES) {
        buffer = fit(image, 1200).toJPEG(70);
      }
      if (buffer.byteLength > MAX_IMAGE_BYTES * 1.5) {
        skipped.push(name);
        continue;
      }
      bytes += buffer.byteLength;
      images.push({
        dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
        fileName: name,
        bytes: buffer.byteLength,
      });
    } catch {
      skipped.push(name);
    }
  }

  return { images, skipped, bytes };
}

/* ------------------------------- zip / docx ------------------------------- */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

function findEndOfCentralDirectory(buffer: Buffer): number {
  const floor = Math.max(0, buffer.length - 66_000);
  for (let i = buffer.length - 22; i >= floor; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

/**
 * 最小 zip 读取：只认 stored / deflate 两种方式，够读 Word 生成的 docx。
 * 不引第三方依赖，打包后不会缺模块。
 */
export function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) throw new Error('不是有效的 docx 文件（找不到 zip 目录）');

  const count = buffer.readUInt16LE(eocd + 10);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (cdOffset >= buffer.length) throw new Error('docx 目录位置异常');

  const entries = new Map<string, Buffer>();
  let cursor = cdOffset;

  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > buffer.length) break;
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) break;

    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;

    // zip64 的占位值，docx 正文不会用到
    if (compressedSize === 0xffffffff || localOffset >= buffer.length) continue;

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);

    try {
      if (method === 0) entries.set(name, Buffer.from(raw));
      else if (method === 8) entries.set(name, zlib.inflateRawSync(raw));
    } catch {
      // 单个条目损坏不影响其它条目
    }
  }

  return entries;
}

/** Word 正文转纯文本：段落换行，制表符保留，其余标签剥掉。 */
export function docxXmlToText(xml: string): string {
  return xml
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_all, code: string) => String.fromCodePoint(Number(code) || 32))
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function docxToText(buffer: Buffer): string {
  const entries = readZipEntries(buffer);
  const document = entries.get('word/document.xml');
  if (!document) throw new Error('docx 里找不到正文（word/document.xml）');
  const text = docxXmlToText(document.toString('utf8'));
  if (!text) throw new Error('docx 正文是空的');
  return text;
}

/** 文本文件编码兜底：先按 UTF-8 读，出现大量替换字符时再试 GBK。 */
export function decodeText(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8');
  const broken = (utf8.match(/\uFFFD/g) ?? []).length;
  if (broken && broken / Math.max(1, utf8.length) > 0.005) {
    try {
      return new TextDecoder('gbk').decode(buffer);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

export interface DocumentPayload {
  text: string;
  fileName: string;
}

/** 读取 Word / 纯文本材料。 */
export async function readDocumentFiles(filePaths: string[]): Promise<{
  documents: DocumentPayload[];
  skipped: string[];
}> {
  const documents: DocumentPayload[] = [];
  const skipped: string[] = [];

  for (const filePath of filePaths) {
    const name = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_DOCUMENT_BYTES) {
        skipped.push(name);
        continue;
      }
      const buffer = await fs.readFile(filePath);
      if (ext === 'docx') {
        documents.push({ text: docxToText(buffer), fileName: name });
      } else if (['txt', 'md', 'markdown', 'csv'].includes(ext)) {
        documents.push({ text: decodeText(buffer).trim(), fileName: name });
      } else {
        skipped.push(name);
      }
    } catch {
      skipped.push(name);
    }
  }

  return { documents, skipped };
}
