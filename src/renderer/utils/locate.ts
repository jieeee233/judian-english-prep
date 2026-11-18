/**
 * 在原文里定位单词／短语。
 *
 * 模型给的是词典形式，原文里可能是变形（retire / retired / retiring），
 * 所以先精确匹配整串，找不到再退回词干匹配：取去掉常见词尾后的前 5 个字符做前缀比对。
 */

export interface SourceHit {
  /** 所在句子（已去掉首尾空白） */
  sentence: string;
  /** 段落序号，从 1 开始 */
  paragraph: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 把文章切成段落，段落再切成句子，保留句子与段落的对应关系 */
function splitSentences(source: string): Array<{ text: string; paragraph: number }> {
  const paragraphs = source.split(/\n\s*\n|\n/);
  const sentences: Array<{ text: string; paragraph: number }> = [];
  paragraphs.forEach((paragraph, index) => {
    const trimmed = paragraph.trim();
    if (!trimmed) return;
    const parts = trimmed.split(/(?<=[.!?。！？])\s+/);
    for (const part of parts) {
      const text = part.trim();
      if (text) sentences.push({ text, paragraph: index + 1 });
    }
  });
  return sentences;
}

function stem(term: string): string {
  return term
    .toLowerCase()
    .replace(/(ing|ed|es|s|ly|er|est)$/i, '')
    .replace(/e$/i, '');
}

/**
 * 返回该词在原文中出现的句子（最多 4 处，按出现顺序）。
 * 精确匹配不到时退回词干前缀匹配，仍找不到就返回空数组。
 */
export function locateInSource(source: string, term: string): SourceHit[] {
  const needle = term.trim().replace(/^[^\w]+|[^\w]+$/g, '');
  if (!source || !needle) return [];

  const sentences = splitSentences(source);
  const exact = new RegExp(`\\b${escapeRegExp(needle)}\\b`, 'i');
  const hits: SourceHit[] = [];
  const seen = new Set<string>();

  for (const item of sentences) {
    if (!exact.test(item.text) || seen.has(item.text)) continue;
    seen.add(item.text);
    hits.push({ sentence: item.text, paragraph: item.paragraph });
    if (hits.length >= 4) return hits;
  }
  if (hits.length) return hits;

  // 词干兜底：处理 retired / retiring / retires 这类变形
  const base = stem(needle);
  if (base.length < 3) return [];
  const loose = new RegExp(`\\b${escapeRegExp(base)}\\w*`, 'i');
  for (const item of sentences) {
    if (!loose.test(item.text) || seen.has(item.text)) continue;
    seen.add(item.text);
    hits.push({ sentence: item.text, paragraph: item.paragraph });
    if (hits.length >= 4) break;
  }
  return hits;
}

/** 把句子里的命中词包成高亮片段，供模板渲染 */
export function markTerm(sentence: string, term: string): Array<{ text: string; hit: boolean }> {
  const needle = term.trim().replace(/^[^\w]+|[^\w]+$/g, '');
  if (!needle) return [{ text: sentence, hit: false }];
  const base = stem(needle);
  const pattern = new RegExp(
    `\\b(?:${escapeRegExp(needle)}|${base.length >= 3 ? `${escapeRegExp(base)}\\w*` : escapeRegExp(needle)})`,
    'gi',
  );
  const chunks: Array<{ text: string; hit: boolean }> = [];
  let last = 0;
  for (const match of sentence.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) chunks.push({ text: sentence.slice(last, start), hit: false });
    chunks.push({ text: match[0], hit: true });
    last = start + match[0].length;
  }
  if (last < sentence.length) chunks.push({ text: sentence.slice(last), hit: false });
  return chunks.length ? chunks : [{ text: sentence, hit: false }];
}

/* --------------------- 全文偏移区间（左侧原文高亮用） --------------------- */

/** 在原文中的字符区间，左闭右开 */
export interface SourceRange {
  start: number;
  end: number;
}

function collect(pattern: RegExp, source: string, limit = 30): SourceRange[] {
  const ranges: SourceRange[] = [];
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    ranges.push({ start, end: start + match[0].length });
    if (ranges.length >= limit) break;
  }
  return ranges;
}

/** 词边界：前后不能紧邻字母数字，避免 art 命中 start */
const LEFT = '(?<![\\w-])';
const RIGHT = '(?![\\w-])';

/**
 * 单词/短语在原文里的全部出现位置。
 * 先按整串精确匹配（忽略大小写），一条都没命中再退回词干（retire → retired）。
 */
export function locateRanges(source: string, term: string): SourceRange[] {
  const needle = term.trim().replace(/^[^\w]+|[^\w]+$/g, '');
  if (!source || !needle) return [];

  const exact = new RegExp(`${LEFT}${escapeRegExp(needle)}${RIGHT}`, 'gi');
  const exactHits = collect(exact, source);
  if (exactHits.length) return exactHits;

  const base = stem(needle);
  if (base.length < 3 || base === needle.toLowerCase()) return [];
  return collect(new RegExp(`${LEFT}${escapeRegExp(base)}\\w*`, 'gi'), source);
}

/** 从命中处向后扩到句末标点，模型改了句中一两个词时也能整句高亮 */
function extendToSentenceEnd(source: string, range: SourceRange): SourceRange {
  const tail = source.slice(range.start, Math.min(source.length, range.start + 400));
  const match = tail.match(/^[^.!?]*[.!?]+["'”’]?/);
  if (!match) return range;
  return { start: range.start, end: range.start + match[0].length };
}

/**
 * 长难句定位：整句按「词 + 任意空白」拼成正则（跨行也能匹配），
 * 整句对不上时取前 8 个词再试一次，命中后自动扩到句末，
 * 避免模型微调标点或个别措辞导致完全找不到。
 */
export function locateQuoteRanges(source: string, quote: string): SourceRange[] {
  const clean = quote.trim().replace(/\s+/g, ' ');
  if (!source || !clean) return [];

  const full = clean.split(' ').map(escapeRegExp).join('\\s+');
  const hits = collect(new RegExp(full, 'gi'), source, 4);
  if (hits.length) return hits;

  const words = clean.split(' ').filter(Boolean);
  if (words.length < 3) return [];
  const head = words.slice(0, 8).map(escapeRegExp).join('\\s+');
  return collect(new RegExp(head, 'gi'), source, 4).map((range) => extendToSentenceEnd(source, range));
}
