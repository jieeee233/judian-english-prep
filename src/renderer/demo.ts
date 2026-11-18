import type { AnalysisInput, AnalysisResult, ExerciseSet } from '../shared/types';

/** 内置自编文章（原创，用于演示与自检，不含任何教材内容）。 */
export const SAMPLE_PASSAGE = `My first day at the new school was harder than I had expected. The corridors were full of students who already knew each other, and I spent the morning pretending to read a notice board so that no one would notice I had nowhere to go.

At lunch I found a quiet corner of the library. A girl was sitting there alone, turning the pages of a book about volcanoes. I wanted to sit down, but my legs seemed to disagree with me. Finally I asked whether the seat opposite her was free.

Her name was Mia. She told me she had moved here two years before and that the first month had been the loneliest of her life. We talked about books, about teachers, and about the strange comfort of a rainy afternoon.

That afternoon, I realized that a small act of kindness could make a big difference. Starting a conversation was not easy, but it helped both of us feel less alone.`;

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

export function isSamplePassage(text: string): boolean {
  return normalize(text) === normalize(SAMPLE_PASSAGE);
}

const SAMPLE_EXERCISE: ExerciseSet = {
  difficulty: 'medium',
  completedAt: new Date().toISOString(),
  model: '演示内容（未调用模型）',
  items: [
    {
      id: 'E1',
      targetId: 'V1',
      target: 'notice board',
      kind: '中译英',
      prompt: '用 notice board 翻译：她把通知贴在了公告栏上。',
      answer: '参考答案：She put the notice on the notice board. 也可用 posted the notice。',
    },
    {
      id: 'E2',
      targetId: 'V3',
      target: 'lonely',
      kind: '词形变化',
      prompt: 'Fill in the blank with the correct form of lonely: The first month was the ____ of her life.',
      answer: 'loneliest（最高级，与 the 连用）',
    },
    {
      id: 'E3',
      targetId: 'S1',
      target: 'I spent the morning pretending to read a notice board so that no one would notice I had nowhere to go.',
      kind: '长难句仿写',
      prompt: '仿写：用 spend time doing sth. 与 so that 写一句你刚到新环境的经历。',
      answer: '参考表达：I spent the first week hiding in the library so that nobody would ask where I was from.（答案不唯一，须包含两个结构）',
    },
  ],
};

export function buildDemoResult(input: AnalysisInput): AnalysisResult {
  const sample = isSamplePassage(input.text);

  if (!sample) {
    return {
      input,
      discourse: {
        genre: '待真实 AI 判断（当前为界面占位）',
        gist: '这里将呈现文章主旨。当前是演示流程，未概括你输入文章的主题或情节。',
        structure: '这里将呈现逐段功能与段间关系，并附原文衔接词证据。',
        purpose: '这里将呈现写作目的及其依据。',
      },
      questions: [],
      vocab: [],
      sentences: [],
      exercise: null,
      source: 'demo',
      isSample: false,
      model: '演示内容（未调用模型）',
      completedAt: new Date().toISOString(),
      requestId: crypto.randomUUID(),
    };
  }

  return {
    input,
    discourse: {
      genre: '记叙文',
      gist: '叙述者转学第一天处处不适应：上午靠假装看公告栏掩饰“无处可去”，午餐时躲进图书馆角落，鼓起勇气问对面座位是否有人，由此认识了两年前搬来、同样经历过孤独的 Mia。结尾点题：主动开口很难，但一个小小的善意让双方都不再那么孤单。',
      structure:
        '第 1 段铺陈处境（证据：pretending to read a notice board）；第 2 段转折，从旁观到行动（but my legs seemed to disagree with me、Finally）；第 3 段用 Mia 的自述呼应主题（the first month had been the loneliest of her life）；第 4 段以 realized that 引出议论收束。四段为“处境—转折—共鸣—点题”，非因果推进。',
      purpose: '通过一次主动搭话的经历说明“小小的善意能改变一整天”，引导读者理解共情与行动的价值；依据是结尾 realized that 与 helped both of us feel less alone。',
    },
    questions: [
      {
        no: '1',
        question: 'Why did the narrator pretend to read the notice board?',
        answer: '为了不被别人注意到自己无处可去，用“看公告栏”掩饰尴尬。',
        evidence: 'I spent the morning pretending to read a notice board so that no one would notice I had nowhere to go.',
        point: '目的状语 so that 的语义理解 + 人物心理推断。',
        logic: '用“动作—动机”设问，选项常把 pretending 误解为真的在阅读；需回看 so that 从句。',
        tag: '推理判断',
      },
      {
        no: '2',
        question: 'What can be inferred from "my legs seemed to disagree with me"?',
        answer: '她想坐下却紧张得迈不开步，身体反应与意愿相反。',
        evidence: 'I wanted to sit down, but my legs seemed to disagree with me.',
        point: '拟人化表达的语境义，而不是字面的“不同意某人观点”。',
        logic: '考查 but 前后的语义对立；干扰项常照字面理解 disagree with。',
        tag: '词义猜测',
      },
      {
        no: '3',
        question: 'What is the main idea of the passage?',
        answer: '一次主动的善意举动能让彼此都不再孤单。',
        evidence: 'Starting a conversation was not easy, but it helped both of us feel less alone.',
        point: '由叙事到议论的升华，识别结尾主旨句。',
        logic: '主旨题需覆盖全文；干扰项常只概括某一段的细节（如“图书馆很安静”）。',
        tag: '主旨大意/最佳标题',
      },
    ],
    vocab: [
      { id: 'V1', term: 'notice board', phonetic: 'ˈnəʊtɪs bɔːd', pos: 'n.', meaning: '公告栏；原文 pretending to read a notice board 指假装看公告栏掩饰尴尬。搭配：put up a notice on the notice board。' },
      { id: 'V2', term: 'corridor', phonetic: 'ˈkɒrɪdɔː', pos: 'n.', meaning: '走廊；原文 The corridors were full of students，强调人多拥挤。搭配：walk along the corridor。' },
      { id: 'V3', term: 'lonely', phonetic: 'ˈləʊnli', pos: 'adj.', meaning: '孤独的；原文 the first month had been the loneliest of her life，用最高级强调程度。名词形式 loneliness。' },
      { id: 'V4', term: 'comfort', phonetic: 'ˈkʌmfət', pos: 'n.', meaning: '慰藉、安稳感；原文 the strange comfort of a rainy afternoon 指雨天带来的莫名安心。不可数。' },
      { id: 'V5', term: 'act of kindness', phonetic: '', pos: 'n. phr.', meaning: '善举；原文 a small act of kindness could make a big difference。搭配：perform an act of kindness。' },
    ],
    sentences: [
      {
        id: 'S1',
        quote: 'I spent the morning pretending to read a notice board so that no one would notice I had nowhere to go.',
        structure: '主语 I + 谓语 spent + 宾语 the morning + 现在分词 pretending 作状语；so that 引导目的状语从句；notice 后接省略 that 的宾语从句 I had nowhere to go。',
        translation: '我一上午都在假装看公告栏，好让别人看不出我无处可去。',
        analysis: 'spend time doing sth. 是高频结构；so that 在此表目的而非结果；nowhere to go 为不定式作后置定语。',
      },
      {
        id: 'S2',
        quote: 'She told me she had moved here two years before and that the first month had been the loneliest of her life.',
        structure: '主句 She told me 后接两个并列宾语从句：she had moved here… 与 that the first month had been…；两处均用过去完成时表示更早的过去。',
        translation: '她告诉我她两年前搬到这里，而头一个月是她一生中最孤独的日子。',
        analysis: '并列宾语从句第二个 that 不能省略；two years before 与过去完成时呼应，易误用 ago。',
      },
      {
        id: 'S3',
        quote: 'Starting a conversation was not easy, but it helped both of us feel less alone.',
        structure: '动名词短语 Starting a conversation 作主语，谓语用单数 was；but 连接并列分句；help sb. (to) do sth. 中 feel 为不带 to 的不定式。',
        translation: '主动搭话并不容易，但它让我们俩都不那么孤单了。',
        analysis: '动名词作主语易误用复数谓语；help 后接不定式常省略 to，改为 helps us felt 是典型错误。',
      },
    ],
    exercise: SAMPLE_EXERCISE,
    source: 'demo',
    isSample: true,
    model: '演示内容（未调用模型）',
    completedAt: new Date().toISOString(),
    requestId: crypto.randomUUID(),
  };
}
