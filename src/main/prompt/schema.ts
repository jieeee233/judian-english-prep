/**
 * 输出结构：模型要照着填的 JSON 骨架。
 * 分组请求只给该组的键，避免它顺手多写别的板块把输出拉长。
 */
import type { AnalysisBlock } from '../../shared/constants';

/** 单个板块的 schema 片段（带字段说明，供系统提示词使用） */
export const BLOCK_SCHEMA: Record<AnalysisBlock, string> = {
  discourse: `  "discourse": {
    "genre": "体裁，只写一个类别词：记叙文／说明文／议论文／应用文，不加理由",
    "gist": "主旨：80 至 120 字，区分原文事实与主题推断",
    "structure": "篇章结构：原文每段一行，行首写 P1、P2…，格式为「P1｜4 至 8 字段落功能（如 背景介绍/定居经过/建筑特点）：这一段写了什么、与上一段什么关系（附衔接词）」，不能只写一段",
    "purpose": "写作目的：一句话，并给出依据"
  }`,
  questions: `  "questions": [
    {
      "no": "原题号，如 1",
      "question": "题干原文（含选项要点时保留关键选项）",
      "answer": "参考答案",
      "evidence": "支撑答案的原文证据，逐字引用",
      "point": "教学考点：这道题实际考什么",
      "logic": "可能的命题逻辑：为什么这样设问、干扰项如何构造",
      "tag": "八个课标能力标签之一，见下方清单",
      "note": "教师核对提示：一句话点出这道题最容易讲错或需要回原文核对的地方，40 字内，没把握就留空"
    }
  ]`,
  vocab: `  "vocab": [
    { "id": "V1", "term": "单词或短语的原文形式", "phonetic": "/ˈfəʊnɪm/ 形式的国际音标", "pos": "词性缩写", "meaning": "文中含义（可附简短说明）", "usage": "教学用法：一个可迁移的搭配或句型，40 字内，没把握就留空" }
  ]`,
  sentences: `  "sentences": [
    { "id": "S1", "quote": "完整原句，逐字引用", "structure": "逐行写成分，每行「成分名：内容」，如 主干：They were greeted. 定语从句：who…（修饰 families）", "translation": "通顺的语境译文", "analysis": "分析：易错点与考点" }
  ]`,
};

/** 空值骨架：分组/分步请求里告诉模型「只要长这样」 */
export const BLOCK_SHAPE: Record<AnalysisBlock, string> = {
  discourse: '"discourse": { "genre": "", "gist": "", "structure": "", "purpose": "" }',
  questions: '"questions": [ { "no": "", "question": "", "answer": "", "evidence": "", "point": "", "logic": "", "tag": "", "note": "" } ]',
  vocab: '"vocab": [ { "id": "V1", "term": "", "phonetic": "", "pos": "", "meaning": "", "usage": "" } ]',
  sentences: '"sentences": [ { "id": "S1", "quote": "", "structure": "", "translation": "", "analysis": "" } ]',
};

/** 按板块拼出完整 schema，顺序与传入顺序一致 */
export function schemaFor(blocks: readonly AnalysisBlock[]): string {
  return `{\n${blocks.map((block) => BLOCK_SCHEMA[block]).join(',\n')}\n}`;
}

export function shapeFor(blocks: readonly AnalysisBlock[]): string {
  return `{ ${blocks.map((block) => BLOCK_SHAPE[block]).join(', ')} }`;
}
