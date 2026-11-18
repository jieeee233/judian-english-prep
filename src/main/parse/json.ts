/**
 * 模型输出的语法层修复与清洗。
 *
 * 只做「让文本变成合法 JSON」的事，不判断内容对错：
 * 思考段落剥离、代码围栏、多余逗号、裸换行、未转义引号、被截断的片段。
 */
import { MAX_PREVIEW_CHARS } from '../../shared/constants';
import { isRecord } from '../errors';

/** 去掉推理模型混进 content 的 <think>…</think> 段落。 */
export function stripThinking(raw: string): string {
  // 只有开头有 <think> 却没有闭合标签：说明推理被截断，正文不可用
  if (/^\s*<think>/i.test(raw) && !/<\/think>/i.test(raw)) return '';
  return raw
    .trim()
    .replace(/^<think>[\s\S]*?<\/think>\s*/i, '')
    .replace(/^<\/think>\s*/i, '')
    .trim();
}

/** JSON 字符串里出现裸换行/制表符时，把它们转义掉再解析（模型常见毛病）。 */
export function escapeControlCharsInStrings(input: string): string {
  let inString = false;
  let escaped = false;
  let out = '';
  for (const ch of input) {
    if (inString && !escaped && ch.charCodeAt(0) < 32) {
      out += JSON.stringify(ch).slice(1, -1);
      continue;
    }
    out += ch;
    if (escaped) {
      escaped = false;
    } else if (inString && ch === '\\') {
      escaped = true;
    } else if (ch === '"') {
      inString = !inString;
    }
  }
  return out;
}

/**
 * 转义字符串内部未转义的英文双引号。
 * 模型在 evidence/answer 里引用原文时经常直接写 "…"，导致 JSON 断裂；
 * 这里按「引号后面是不是结构符号」判断它是收尾还是正文里的引号。
 */
export function repairStrayQuotes(input: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '\\') {
      out += ch + (input[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (ch !== '"') {
      if (inString && (ch === '\n' || ch === '\r' || ch === '\t')) {
        out += JSON.stringify(ch).slice(1, -1);
        continue;
      }
      out += ch;
      continue;
    }
    if (!inString) {
      inString = true;
      out += ch;
      continue;
    }
    let j = i + 1;
    while (j < input.length && /\s/.test(input[j])) j += 1;
    const next = input[j];
    if (next === undefined || next === ',' || next === '}' || next === ']' || next === ':') {
      inString = false;
      out += ch;
    } else {
      out += '\\"';
    }
  }
  return out;
}

/**
 * 模型常见的不合规 JSON 修复：
 * 1) 前后裹着 ```json 围栏或说明文字；2) 对象结尾多一个逗号；
 * 3) 字符串里有裸换行。以上只做语法层清理，不改变语义。
 */
export function repairJson(raw: string): string {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);

  // 去掉结构结尾的多余逗号：,} 或 ,]
  text = text.replace(/,(\s*[}\]])/g, '$1');

  // 模型常把填空写成 \_\_\_，而 \_ 不是合法 JSON 转义，会让整段解析失败。
  // 只保留 JSON 允许的转义，其余反斜杠直接去掉（\_ → _）。
  return text.replace(/\\([^"\\/bfnrtu])/g, '$1');
}

/** 依次尝试几种修复组合，返回第一个能解析成功的结果。 */
export function parseJsonLoose(text: string): unknown {
  const candidates = [
    text,
    repairJson(text),
    escapeControlCharsInStrings(repairJson(text)),
    repairStrayQuotes(escapeControlCharsInStrings(repairJson(text))),
  ];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      return JSON.parse(candidate);
    } catch {
      // 换下一种修复方式
    }
  }
  return null;
}

/** 从被截断/带噪声的原文里，按 "key": 找到平衡的 {...} 或 [...] 片段。 */
export function salvageValue(input: string, aliases: string[]): unknown {
  for (const alias of aliases) {
    const pattern = new RegExp(`"${alias}"\\s*[:：]`, 'i');
    const match = pattern.exec(input);
    if (!match) continue;
    let start = match.index + match[0].length;
    while (start < input.length && /\s/.test(input[start])) start += 1;
    const open = input[start];
    if (open !== '{' && open !== '[') continue;
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < input.length; i += 1) {
      const ch = input[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) {
          const slice = input.slice(start, i + 1);
          const parsed = parseJsonLoose(slice);
          if (parsed !== null) return parsed;
          break;
        }
      }
    }
  }
  return undefined;
}

/**
 * 逐条抢救：整段 JSON 坏掉时（常见于某个字段里的引号没转义），
 * 按 `"键": [ … ]` 定位数组，再把里面的对象一条条单独解析。
 * 坏掉的那条丢掉，其余照常可用——比整块作废、再花一次请求重发划算。
 */
export function salvageArrayItems(input: string, aliases: string[]): Record<string, unknown>[] {
  for (const alias of aliases) {
    const head = new RegExp(`"${alias}"\\s*[:：]\\s*\\[`, 'i').exec(input);
    if (!head) continue;
    let start = head.index + head[0].length;
    // 允许数组前还有换行/空格
    while (start < input.length && /\s/.test(input[start])) start += 1;
    const slice = input.slice(start);
    const parts = slice.split(/}\s*,\s*(?=\{)/);
    const items: Record<string, unknown>[] = [];
    for (const part of parts) {
      const open = part.indexOf('{');
      if (open < 0) continue;
      let body = part.slice(open);
      const lastClose = body.lastIndexOf('}');
      body = lastClose >= 0 ? body.slice(0, lastClose + 1) : `${body}}`;
      const parsed = parseJsonLoose(body);
      if (isRecord(parsed)) items.push(parsed);
    }
    if (items.length) return items;
  }
  return [];
}

/**
 * 兜底：整段 JSON 坏掉时，逐个抠出顶层对象单独解析。
 * 出题结果是「一题一段」的扁平结构，抠出来十有八九能用，
 * 总比因为一处引号没转义就整批作废强。
 */
export function salvageObjects(raw: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const chunk = raw.slice(start, i + 1);
        start = -1;
        try {
          const value = JSON.parse(escapeControlCharsInStrings(repairJson(chunk)));
          if (isRecord(value) && ('prompt' in value || 'answer' in value)) found.push(value);
        } catch {
          // 单个对象坏了就跳过，不影响其它题目
        }
      }
      if (depth < 0) depth = 0;
    }
  }
  return found;
}

/**
 * 先单独取模型原文：解析失败时也要能把原文交给界面，
 * 否则用户只会看到「没有返回内容」，无从判断是没响应还是格式不合规。
 */
export function extractPreview(bodyText: string): string {
  let payload: unknown = null;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return '';
  }
  if (!isRecord(payload)) return '';
  const choices = payload.choices;
  if (!Array.isArray(choices) || !isRecord(choices[0])) return '';
  const message = choices[0].message;
  if (!isRecord(message)) return '';
  const content = typeof message.content === 'string' ? message.content : '';
  const reasoning =
    (typeof message.reasoning_content === 'string' && message.reasoning_content) ||
    (typeof message.reasoning === 'string' && message.reasoning) ||
    '';
  return (stripThinking(content) || reasoning).slice(0, MAX_PREVIEW_CHARS);
}
