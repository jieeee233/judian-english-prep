import { ABILITY_TAGS, type AbilityTag } from './constants';

/**
 * 把模型写出的能力标签归一到八个课标标签。
 * 常见偏差：全角斜杠、加空格、写成「主旨大意题」「推理判断题」、只写前半截。
 * 归一失败返回空串，由界面显式标注「未归类」，不硬塞一个错误标签。
 */
const RULES: Array<{ test: RegExp; tag: AbilityTag }> = [
  { test: /细节/, tag: '细节理解' },
  { test: /主旨|大意|标题|main idea/i, tag: '主旨大意/最佳标题' },
  { test: /词义|猜词|词汇猜测|词义猜测/, tag: '词义猜测' },
  { test: /推理|推断|判断/, tag: '推理判断' },
  { test: /结构|段落作用|篇章结构/, tag: '篇章结构/段落作用' },
  { test: /指代|衔接|代词/, tag: '指代与衔接' },
  { test: /观点|论据|论证/, tag: '观点与论据' },
  { test: /目的|态度|意图|语气/, tag: '写作目的/作者态度' },
];

export function normalizeAbilityTag(raw: unknown): AbilityTag | '' {
  if (typeof raw !== 'string') return '';
  const text = raw.replace(/／/g, '/').replace(/\s+/g, '').replace(/[、，,。.]$/, '');
  if (!text) return '';

  const exact = ABILITY_TAGS.find(
    (tag) => tag.replace(/／/g, '/').replace(/\s+/g, '') === text,
  );
  if (exact) return exact;

  const hit = RULES.find((rule) => rule.test.test(text));
  return hit ? hit.tag : '';
}

/** 给界面与导出用的短标签：未归类时返回空串，调用方决定如何提示。 */
export function abilityTagLabel(tag: AbilityTag | '' | undefined): string {
  return tag || '';
}
