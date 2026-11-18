/**
 * 结果面板的文本切分。
 *
 * 模型给的是整段字符串，界面要按设计稿拆成「段落卡」和「成分行」，
 * 这里只做字符串处理，不依赖组件状态，篇章分析与长难句共用。
 */

/** 篇章结构的一行：P1 ｜ 小标题：说明 */
export interface StructureLine {
  /** 段号标记，没有则留空 */
  tag: string;
  /** 小标题，没有则留空 */
  title: string;
  /** 说明正文 */
  body: string;
}

const PARA_TAG = /^(?:P|para|paragraph|段)\s*(\d+)\s*[｜|:：.、-]?\s*/i;
const LEAD_TAG = /^[①②③④⑤⑥⑦⑧⑨⑩]\s*/;

const CN_DIGIT: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

/**
 * 旧版提示词下模型常写成「第一段…第二段…第三段…」的一整段散文，
 * 这里按「第X段」切成逐段，让段落卡也能出来。
 */
function splitByParagraphWord(raw: string): StructureLine[] | null {
  const hits = [...raw.matchAll(/第\s*([一二三四五六七八九十\d]+)\s*段/g)];
  if (hits.length < 2) return null;
  const out: StructureLine[] = [];
  hits.forEach((hit, index) => {
    const start = (hit.index ?? 0) + hit[0].length;
    const end = index + 1 < hits.length ? hits[index + 1].index ?? raw.length : raw.length;
    const body = raw
      .slice(start, end)
      .replace(/^[\s，,。；;、:：]+|[\s，,；;、]+$/g, '')
      .trim();
    if (!body) return;
    const num = CN_DIGIT[hit[1]] ?? Number(hit[1]) ?? out.length + 1;
    out.push({ tag: `P${num}`, title: '', body });
  });
  return out.length >= 2 ? out : null;
}


/**
 * 把 structure 拆成逐段卡片。
 * 模型写法不统一（P1｜标题：正文 / P1: 正文 / ①②③ 分行），
 * 认不出段号时按句号切句兜底，至少不会堆成一坨。
 */
export function parseStructure(value: string): StructureLine[] {
  const raw = value.replace(/\r/g, '').trim();
  if (!raw) return [];

  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  // 整段散文（旧版结果）先按「第X段」切，切不出来再往下走
  if (lines.length === 1 && lines[0].length > 60 && !/P\s*\d+\s*[｜|:：]/i.test(lines[0])) {
    const byWord = splitByParagraphWord(lines[0]);
    if (byWord) return byWord;
  }

  // 模型常把几段写在同一行：按「P数字」再切一次
  const parts = lines
    .flatMap((line) =>
      /P\s*\d+\s*[｜|:：]/i.test(line) ? line.split(/(?=P\s*\d+\s*[｜|:：])/i) : [line],
    )
    .map((line) => line.trim())
    .filter(Boolean);

  const out: StructureLine[] = [];
  for (const line of parts) {
    const withoutMark = line.replace(LEAD_TAG, '');
    const tagMatch = withoutMark.match(PARA_TAG);
    let rest = withoutMark;
    let tag = '';
    if (tagMatch) {
      tag = `P${tagMatch[1]}`;
      rest = withoutMark.slice(tagMatch[0].length).trim();
    } else if (LEAD_TAG.test(line)) {
      tag = `P${out.length + 1}`;
    }
    const colon = rest.search(/[：:]/);
    if (colon > 0 && colon <= 16) {
      out.push({ tag, title: rest.slice(0, colon).trim(), body: rest.slice(colon + 1).trim() });
    } else {
      out.push({ tag, title: '', body: rest });
    }
  }
  return out.slice(0, 12);
}

/** 句式结构里可识别的成分名，按长词优先匹配，避免「从句」吃掉「定语从句」 */
const CLAUSE_LABELS = [
  '主干',
  '主句',
  '主语',
  '谓语',
  '宾语',
  '表语',
  '定语从句',
  '状语从句',
  '结果状语从句',
  '原因状语从句',
  '宾语从句',
  '主语从句',
  '同位语从句',
  '表语从句',
  '非谓语',
  '不定式',
  '分词',
  '动名词',
  '并列句',
  '并列结构',
  '并列谓语',
  '插入语',
  '时间状语',
  '地点状语',
  '条件状语',
  '让步状语',
  '方式状语',
  '状语',
  '定语',
  '补语',
  '宾语补足语',
  '从句',
  '修饰成分',
];

/**
 * 成分行：一句里可能写成「主干：…；定语从句：…」也可能换行或斜杠分隔，
 * 这里把常见的分隔符都算上，仍以「成分名 + 冒号/括号」为准，避免误伤正文。
 */
const LABEL_PATTERN = new RegExp(
  `(?:^|[；;，,、/+｜|。.！!？?）)\\n])\\s*(${CLAUSE_LABELS.slice()
    .sort((a, b) => b.length - a.length)
    .join('|')})\\s*[:：（(]`,
  'g',
);

export interface ClauseLine {
  label: string;
  body: string;
}

/**
 * 把 structure 拆成「主干 / 定语从句 / 结果状语从句」这样的成分行。
 * 少于两行就返回空数组，界面退回整段显示，不强拆。
 */
export function parseClauses(value: string): ClauseLine[] {
  const raw = value.replace(/\r/g, '').trim();
  if (!raw) return [];
  const hits = [...raw.matchAll(LABEL_PATTERN)];
  if (hits.length < 2) return [];

  const out: ClauseLine[] = [];
  hits.forEach((hit, index) => {
    const start = (hit.index ?? 0) + hit[0].length;
    const end = index + 1 < hits.length ? hits[index + 1].index ?? raw.length : raw.length;
    const body = raw
      .slice(start, end)
      .replace(/[）)]\s*$/, '')
      .replace(/^[\s；;，,。]+|[\s；;，,。]+$/g, '')
      .trim();
    if (body) out.push({ label: hit[1], body });
  });
  return out.slice(0, 6);
}

/** 题干里拆出选项：A. xxx  B. xxx —— 题干与选项通常被模型写在一个字段里 */
export interface StemParts {
  stem: string;
  options: Array<{ mark: string; text: string }>;
}

export function splitOptions(question: string): StemParts {
  const raw = (question || '').replace(/\r/g, '').trim();
  if (!raw) return { stem: '', options: [] };

  const matches = [...raw.matchAll(/(?:^|[\s（(])([A-D])[.．、)]\s*/g)];
  const usable = matches.filter((match) => (match.index ?? 0) > 0 || match[1] === 'A');
  if (!usable.length) return { stem: raw, options: [] };

  const first = usable[0];
  const firstIndex = (first.index ?? 0) + (first[0].length - first[0].trimStart().length);
  // 题干里以字母开头（例如 "A. ..." 本身就是完整题干）时不拆
  if (firstIndex <= 2) return { stem: raw, options: [] };

  const options: Array<{ mark: string; text: string }> = [];
  usable.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < usable.length ? usable[index + 1].index ?? raw.length : raw.length;
    const body = raw.slice(start, end).trim();
    if (body) options.push({ mark: match[1], text: body });
  });
  if (options.length < 2) return { stem: raw, options: [] };

  return { stem: raw.slice(0, firstIndex).trim().replace(/[\s(（]$/, ''), options };
}
