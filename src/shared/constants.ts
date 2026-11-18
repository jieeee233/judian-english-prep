/** 八个课标能力标签：逐题讲解里必须 8 选 1，界面直接按这张表渲染与归一。 */
export const ABILITY_TAGS = [
  '细节理解',
  '主旨大意/最佳标题',
  '词义猜测',
  '推理判断',
  '篇章结构/段落作用',
  '指代与衔接',
  '观点与论据',
  '写作目的/作者态度',
] as const;

export type AbilityTag = (typeof ABILITY_TAGS)[number];

/** 解析结果的四个板块。合并请求一次产出，失败时按板块分步补发。 */
export const ANALYSIS_BLOCKS = ['discourse', 'questions', 'vocab', 'sentences'] as const;
export type AnalysisBlock = (typeof ANALYSIS_BLOCKS)[number];

/** 结果区五个页签（练习不在解析阶段生成，单独按需请求）。 */
export const RESULT_TABS = ['discourse', 'questions', 'vocab', 'sentences', 'exercise'] as const;
export type ResultTab = (typeof RESULT_TABS)[number];

export const BLOCK_TITLES: Record<ResultTab, string> = {
  discourse: '篇章分析',
  questions: '逐题讲解',
  vocab: '重点词汇',
  sentences: '长难句',
  exercise: '搭配与练习',
};

/** 篇章分析的四个字段，顺序即界面与导出顺序。 */
export const DISCOURSE_FIELDS = ['genre', 'gist', 'structure', 'purpose'] as const;

export const DISCOURSE_LABELS: Record<(typeof DISCOURSE_FIELDS)[number], string> = {
  genre: '体裁',
  gist: '主旨',
  structure: '篇章结构',
  purpose: '写作目的',
};

export const EXERCISE_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type ExerciseDifficulty = (typeof EXERCISE_DIFFICULTIES)[number];

export const DIFFICULTY_LABEL: Record<ExerciseDifficulty, string> = {
  easy: '简单',
  medium: '中等',
  hard: '困难',
};

/** 界面上用的三档叫法（设计稿：基础 / 标准 / 提高），提示词与导出仍用 DIFFICULTY_LABEL */
export const DIFFICULTY_UI_LABEL: Record<ExerciseDifficulty, string> = {
  easy: '基础',
  medium: '标准',
  hard: '提高',
};

export const DIFFICULTY_SPEC: Record<ExerciseDifficulty, string> = {
  easy: '简单：答案能在原文直接定位；题型限定为选词填空、单句英译中、原文信息判断，用词不超出目标本身。',
  medium: '中等：需要词形变化或语境补全；题型限定为中译英（给出提示词首字母）、词形变化填空、两句合并，允许一处同义替换。',
  hard: '困难：需要改写或跨句整合；题型限定为长难句仿写、语篇衔接改写、观点表达（用指定目标造句并说明理由），答案允许非唯一但须给出参考表达。',
};

export const DEFAULT_BASE_URL = 'https://api.siliconflow.cn/v1';
/** 主力模型：非思考链路、输出稳定；已显式关闭思考过程。 */
export const DEFAULT_MODEL = 'Qwen/Qwen3.5-4B';
/**
 * 默认超时：本机实测这档模型输出约 20 至 25 token/s，
 * 一组两板块（约 1,000 至 1,500 token）需要 50 至 90 秒，150 秒留出网络抖动余量。
 */
export const DEFAULT_TIMEOUT_SECONDS = 150;

export interface ModelPreset {
  id: string;
  label: string;
  note: string;
}

export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: DEFAULT_MODEL,
    label: 'Qwen3.5-4B（推荐）',
    note: '硅基流动模型，已关闭思考过程；一次解析约 20 至 60 秒，输出为规定的双层 JSON。',
  },
];

/**
 * 视觉模型：只在识别教材词表照片/截图时调用，文本与 Word 材料仍走主力模型。
 * 单独配置是为了不让每次解析课文都背上图片相关的约束与费用。
 */
export const DEFAULT_VISION_MODEL = 'Qwen/Qwen3-VL-8B-Instruct';

export interface VisionPreset {
  id: string;
  label: string;
  note: string;
}

export const VISION_MODEL_PRESETS: VisionPreset[] = [
  {
    id: DEFAULT_VISION_MODEL,
    label: 'Qwen3-VL-8B（推荐）',
    note: '硅基流动视觉模型，已关闭思考；一页词表约 10 至 40 秒，密排小字也认得清。',
  },
  {
    id: 'Qwen/Qwen3-VL-30B-A3B-Instruct',
    label: 'Qwen3-VL-30B-A3B',
    note: '更大参数、激活 3B，速度接近 8B；双栏排版或拍照角度很斜时更稳。',
  },
];

export const MAX_PASSAGE_CHARS = 20_000;

/** 固定搭配：单元格文案上限，超出截断，避免模型复读整页。 */
export const MAX_COLLOCATION_CHARS = 120;
/** 一次参与匹配的单元词数上限（教材单元通常 30 至 70 词）。 */
export const MAX_UNIT_WORDS = 120;
/** 一次最多识别的照片张数。 */
export const MAX_VISION_IMAGES = 6;
/** 粘贴或 Word 提取出来的材料长度上限。 */
export const MAX_SOURCE_TEXT_CHARS = 24_000;
/** 压缩后的单张图片字节上限，超过继续降质。 */
export const MAX_IMAGE_BYTES = 900 * 1024;
/** 单个字段上限，防止模型复读整篇文章把结果撑爆。 */
export const MAX_FIELD_CHARS = 8_000;
export const MAX_RESPONSE_BYTES = 1_048_576;
export const MAX_PREVIEW_CHARS = 60_000;
export const MAX_CLIPBOARD_CHARS = 200_000;
export const MAX_HISTORY_ITEMS = 200;

/** 我的词汇上限：够一个教师存满几轮备课，同时避免文件无限膨胀 */
export const MAX_MY_VOCAB = 2000;
export const MAX_RECENT_REQUESTS = 256;
/** 单板块条目上限：词汇/长难句按 5 项设计，留出余量但不允许无限追加。 */
export const MAX_BLOCK_ITEMS = 24;
/** 练习最多条目数（词汇 + 句子各目标一题）。 */
export const MAX_EXERCISES = 48;

/** 出题批大小：目标多时按批发送，单批越短越不容易被截断或 JSON 崩坏 */
export const PRACTICE_BATCH = 5;

export const REQUEST_ID_PATTERN = /^[a-zA-Z0-9-]{16,80}$/;

/** 各阶段请求的输出预算：分组请求给足两板块之和，单板块与练习按需。 */
export const STAGE_MAX_TOKENS: Record<AnalysisBlock | 'group' | 'exercise', number> = {
  group: 6_000,
  discourse: 1_600,
  questions: 4_000,
  vocab: 3_000,
  sentences: 3_200,
  exercise: 4_000,
};

/**
 * 需要显式关闭思考链的模型。
 * Qwen3 系列默认带思考：推理 token 会单独计入 completion_tokens，
 * 一篇高中课文常见 7,000～25,000 个推理 token，既撞 max_tokens 又极易超过 120 秒超时，
 * 表现为「请求超时、没有返回内容」。
 */
const THINKING_CAPABLE = [/qwen3/i];

export function shouldDisableThinking(model: string): boolean {
  return THINKING_CAPABLE.some((pattern) => pattern.test(model.trim()));
}
