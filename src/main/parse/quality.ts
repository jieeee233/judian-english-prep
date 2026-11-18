/**
 * 长难句的「内容质量」规则。
 *
 * 解析器的职责是「格式对不对」，这里负责「东西是不是句子」：
 * 小模型很容易把选项、介词短语、从句片段当成完整原句交上来
 * （例如 `B. Amused.`、`Just 30 miles north of Manhattan`），
 * 这类条目讲不了结构、也没法出题，必须在入库前挡掉。
 *
 * 全部是纯函数，不依赖模型与文件，便于单测与复用。
 */

/** 多选题选项行：`A.` `B、` `(C)` 等 */
const OPTION_MARK = /^\s*[（(]?\s*[A-Da-d]\s*[.、)）]\s*/;

/** 从句/状语片段常见开头：只有从属部分，没有主句 */
const FRAGMENT_START =
  /^\s*(because|although|though|while|whereas|which|that|who|whom|whose|if|unless|since|when|where|after|before|until|once|than|so that|in order that|even if|even though|as if|as though)\b/i;

/** 以标点开头说明是从原句中间截出来的 */
const OPEN_PUNCT = /^\s*[(\[,;:—–]/;

/** 句末标点（允许后面跟引号或括号） */
const TERMINATOR_END = /[.!?…]["'”’)\]]*\s*$/;

/** 句内出现「句末标点 + 空格 + 大写/引号」说明塞了两句以上 */
const INNER_BREAK = /[.!?…]["'”’)\]]?\s+["“'‘]?[A-Z]/g;

/** 助动词、情态动词与系动词：出现即证明有谓语 */
const AUX = new Set([
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'done',
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must', 'ought',
]);

/** 高频实义动词（含常见不规则过去式）：高中语篇里覆盖足够 */
const VERBS = new Set([
  'say', 'said', 'tell', 'told', 'make', 'made', 'take', 'took', 'taken', 'give', 'gave', 'given',
  'get', 'got', 'go', 'went', 'gone', 'come', 'came', 'see', 'saw', 'seen', 'know', 'knew', 'known',
  'think', 'thought', 'find', 'found', 'feel', 'felt', 'leave', 'left', 'put', 'keep', 'kept',
  'let', 'begin', 'began', 'begun', 'seem', 'help', 'talk', 'turn', 'start', 'show', 'shown',
  'hear', 'heard', 'play', 'run', 'ran', 'move', 'live', 'lived', 'believe', 'hold', 'held',
  'bring', 'brought', 'happen', 'write', 'wrote', 'written', 'sit', 'sat', 'stand', 'stood',
  'lose', 'lost', 'pay', 'paid', 'meet', 'met', 'include', 'continue', 'set', 'learn', 'change',
  'lead', 'led', 'understand', 'understood', 'watch', 'follow', 'stop', 'create', 'speak', 'spoke',
  'read', 'spend', 'spent', 'grow', 'grew', 'grown', 'open', 'walk', 'win', 'won', 'offer',
  'remember', 'love', 'consider', 'appear', 'buy', 'bought', 'wait', 'serve', 'die', 'send', 'sent',
  'expect', 'build', 'built', 'stay', 'fall', 'fell', 'fallen', 'cut', 'reach', 'kill', 'raise',
  'pass', 'sell', 'sold', 'decide', 'return', 'explain', 'hope', 'develop', 'carry', 'break',
  'broke', 'broken', 'receive', 'agree', 'support', 'hit', 'produce', 'eat', 'ate', 'eaten',
  'cover', 'catch', 'caught', 'draw', 'drew', 'drawn', 'choose', 'chose', 'chosen', 'cause',
  'point', 'listen', 'realize', 'plan', 'drive', 'drove', 'driven', 'fly', 'flew', 'flown',
  'wear', 'wore', 'worn', 'treat', 'apply', 'retire', 'greet', 'establish', 'design', 'locate',
  'join', 'preserve', 'engage', 'list', 'try', 'need', 'want', 'use', 'work', 'call', 'ask',
  'answer', 'become', 'became', 'appear', 'remain', 'remind', 'allow', 'suggest', 'describe',
  'prefer', 'arrive', 'enter', 'spread', 'divide', 'connect', 'improve', 'increase', 'reduce',
  'protect', 'collect', 'manage', 'prepare', 'express', 'discuss', 'discover', 'invent', 'travel',
  'visit', 'attend', 'graduate', 'serve', 'share', 'notice', 'accept', 'refuse', 'avoid', 'enjoy',
  'finish', 'practise', 'practice', 'wonder', 'imagine', 'suppose', 'doubt', 'promise', 'warn',
]);

/** 以 -ed 结尾但不是动词的常见词，避免 "100 years old" 类误判 */
const ED_NOUNS = new Set(['hundred', 'red', 'bed', 'need', 'feed', 'speed', 'seed', 'deed', 'shed']);

export interface QuoteCheck {
  ok: boolean;
  /** 不合格原因，直接写进校验提示 */
  reason?: string;
  /** 按原文校正后的原句（合格时给出） */
  text?: string;
  /** 是否做过校正 */
  corrected?: boolean;
}

const PASS = { ok: true } as const;

function tokensOf(value: string): string[] {
  return value.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
}

/** 有谓语：助动词、常见动词、-ed 结尾（少数名词除外）、缩写形式 */
export function hasFiniteVerb(value: string): boolean {
  return tokensOf(value).some((token) => {
    const base = token.replace(/'(s|re|ve|d|m|ll)$/, '');
    if (AUX.has(base) || VERBS.has(base)) return true;
    return /^[a-z]{3,}ed$/.test(base) && !ED_NOUNS.has(base);
  });
}

/** 比对用的归一化：小写、弯引号拉直、去标点、压空格 */
export function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 原文里是否逐字出现（容忍标点与空白差异） */
export function quoteInPassage(quote: string, passage: string): boolean {
  const needle = normalizeForMatch(quote);
  if (!needle) return false;
  return ` ${normalizeForMatch(passage)} `.includes(` ${needle} `);
}

/** 按句末标点切句，保留原标点与大小写 */
function splitSentences(passage: string): string[] {
  return passage
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…]["'”’)\]]?)\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** 最长公共子序列长度：用来判断「模型这句是不是原文那句」 */
function lcsLength(a: string[], b: string[]): number {
  const width = b.length + 1;
  let prev = new Array<number>(width).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const row = new Array<number>(width).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
    }
    prev = row;
  }
  return prev[b.length];
}

export interface ResolvedQuote {
  /** 原文里的那一句（标点、大小写都按原文） */
  text: string;
  /** 模型给的原句与原文不完全一致，已按原文校正 */
  corrected: boolean;
}

/**
 * 把模型给的原句对回原文。
 *
 * 模型常会顺手改掉原文的小毛病（拼写、代词、标点），直接丢弃很可惜，
 * 所以逐字对不上时按「逐词相似度」找原文那一句：够像就换成原文的写法，
 * 差太多才判为改写或拼接。
 */
export function resolveQuote(quote: string, passage: string): ResolvedQuote | null {
  const needle = normalizeForMatch(quote);
  if (!needle) return null;
  if (` ${normalizeForMatch(passage)} `.includes(` ${needle} `)) return { text: quote.trim(), corrected: false };

  const tokens = needle.split(' ');
  let best: { text: string; score: number } | null = null;
  for (const sentence of splitSentences(passage)) {
    const candidate = normalizeForMatch(sentence);
    if (!candidate) continue;
    const target = candidate.split(' ');
    const score = lcsLength(tokens, target) / Math.max(tokens.length, target.length, 1);
    if (!best || score > best.score) best = { text: sentence, score };
  }
  if (best && best.score >= 0.85) return { text: best.text, corrected: true };
  return null;
}

/**
 * 判断一条 quote 是否能作为「长难句」：
 * 1) 必须是原文里逐字出现的片段；2) 必须是完整句子（有谓语、句末标点、不是从句或选项）；
 * 3) 只能是一句，不能把相邻两句拼起来。
 */
export function checkSentenceQuote(quote: string, passage?: string): QuoteCheck {
  const value = quote.trim();
  if (!value) return { ok: false, reason: '原句为空' };

  if (OPTION_MARK.test(value)) return { ok: false, reason: '这是题目选项，不是原文句子' };
  const words = tokensOf(value);
  // 长难句的下限：8 个词（"The house has signature features." 这类简单句撑不起结构讲解）
  if (value.length < 32 || words.length < 8) {
    return { ok: false, reason: '太短，属于简单句而非长难句' };
  }
  if (OPEN_PUNCT.test(value)) return { ok: false, reason: '从句子中间截断，开头是标点' };
  if (FRAGMENT_START.test(value)) return { ok: false, reason: '只是从句或状语片段，没有主句' };
  if (!TERMINATOR_END.test(value)) return { ok: false, reason: '没有句末标点，句子不完整' };
  if (value.length > 420) return { ok: false, reason: '超过 420 字，请只取单句' };

  const inner = value.replace(TERMINATOR_END, '').match(INNER_BREAK);
  if (inner && inner.length) return { ok: false, reason: `拼接了 ${inner.length + 1} 句，请只取一句` };

  if (!hasFiniteVerb(value)) return { ok: false, reason: '找不到谓语动词，不像完整句子' };

  if (passage) {
    const resolved = resolveQuote(value, passage);
    if (!resolved) return { ok: false, reason: '原文里找不到这句（被改写或拼接了）' };
    return { ok: true, text: resolved.text, corrected: resolved.corrected };
  }
  return PASS;
}

/**
 * 译文必须是中文；夹带成串的英文（原句里没有的）判为崩坏。
 * 单个英文词多半是人名或缩写，放行；连续两个以上且原句没有，才算残句。
 */
export function checkTranslation(translation: string, quote: string): QuoteCheck {
  const value = translation.trim();
  if (!value) return { ok: false, reason: '译文为空' };
  if (!/[\u4e00-\u9fa5]/.test(value)) return { ok: false, reason: '译文没有中文' };
  const quoteWords = new Set(tokensOf(quote));
  const runs = value.match(/[A-Za-z]{2,}(?:[\s,、]+\s*[A-Za-z]{2,})+/g) ?? [];
  for (const run of runs) {
    const foreign = tokensOf(run).filter((word) => !quoteWords.has(word));
    if (foreign.length >= 2) {
      return { ok: false, reason: `译文夹带原句没有的英文：${foreign.slice(0, 3).join(', ')}` };
    }
  }
  return PASS;
}
