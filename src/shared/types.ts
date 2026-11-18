import type { AbilityTag, AnalysisBlock, ExerciseDifficulty } from './constants';

export type {
  AbilityTag,
  AnalysisBlock,
  ExerciseDifficulty,
  ResultTab,
} from './constants';

export interface AnalysisInput {
  text: string;
}

/** 篇章分析：四个固定字段，对应「体裁 / 主旨 / 篇章结构 / 写作目的」。 */
export interface DiscourseNote {
  genre: string;
  gist: string;
  structure: string;
  purpose: string;
}

/** 逐题讲解：题号后紧跟题干，再给答案、证据、考点、命题逻辑与能力标签。 */
export interface QuestionNote {
  no: string;
  question: string;
  answer: string;
  evidence: string;
  point: string;
  logic: string;
  /** 八个课标能力标签之一；模型未给出合法标签时为空串 */
  tag: AbilityTag | '';
  /** 教师核对提示：一句话提醒这道题最容易讲错的地方，可为空 */
  note?: string;
}

/** 重点词汇：唯一 ID 便于练习生成时按目标出题。 */
export interface VocabEntry {
  id: string;
  term: string;
  phonetic: string;
  pos: string;
  meaning: string;
  /** 教学用法：可迁移的搭配或句型，模型没把握时为空 */
  usage?: string;
}

/** 长难句：唯一 ID + 完整原句定位。 */
export interface SentenceNote {
  id: string;
  quote: string;
  structure: string;
  translation: string;
  analysis: string;
}

export interface Exercise {
  id: string;
  /** 对应的目标：V1 / S1 */
  targetId: string;
  target: string;
  kind: string;
  prompt: string;
  answer: string;
  /** 简要说明：为什么这样填，可为空 */
  explain?: string;
}

/** 我的词汇条目：可从解析结果收藏，也可手填；固定搭配为功能三预留。 */
export interface MyVocabEntry {
  id: string;
  term: string;
  phonetic: string;
  pos: string;
  meaning: string;
  collocation: string;
  origin: 'analysis' | 'textbook' | 'manual';
  /** 来源提示，如「必修一 Unit 1」或文章首句 */
  source: string;
  createdAt: string;
  updatedAt: string;
}

export type MyVocabInput = Partial<Pick<MyVocabEntry, 'phonetic' | 'pos' | 'collocation' | 'source' | 'origin'>> & {
  term: string;
  meaning: string;
  collocation?: string;
};

/* --------------------------- 单词练习 --------------------------- */

/**
 * 一条单词练习。教材内置题只有 prep（介词搭配）与 form（词形变化），
 * AI 生成的题用 choice（选择题）与 grammar（语法填空）。
 */
export interface VocabPracticeItem {
  id: string;
  type: string;
  point: string;
  stem: string;
  answer: string;
  hint: string;
  explanation: string;
  /** 选择题选项；非选择题为空数组 */
  options: string[];
}

/** AI 生成练习的出题偏好 */
export type VocabPracticeStyle = 'choice' | 'grammar' | 'mixed';

export interface VocabPracticeWord {
  word: string;
  meaning: string;
  pos: string;
  collocations: DemoCollocation[];
}

export interface VocabPracticeGenerateRequest {
  requestId: string;
  style: VocabPracticeStyle;
  /** 每个词生成几道题，1 至 4，默认 2 */
  count: number;
  words: VocabPracticeWord[];
}

export interface VocabPracticeGroup {
  word: string;
  exercises: VocabPracticeItem[];
}

export interface VocabPracticeGenerateSuccess {
  groups: VocabPracticeGroup[];
  model: string;
  /** 部分批次失败时的说明，全部成功为空数组 */
  issues: string[];
}

/** 演示用词条：教材词汇与我的词汇都会先转成这个结构 */
export interface DemoCollocation {
  pattern: string;
  meaning: string;
}

/**
 * 演示文件里的练习题。
 * type：prep/介词搭配、form/词形变化、choice/选择题、grammar/语法填空
 */
export interface DemoExercise {
  id: string;
  type: string;
  point: string;
  stem: string;
  answer: string;
  hint: string;
  explanation: string;
  /** 选择题选项（含正确答案文本），非选择题为空 */
  options: string[];
}

export interface DemoItem {
  order: number;
  word: string;
  ipa: string;
  pos: string;
  meaning: string;
  /** 兼容字段：把搭配拼成一行的文本 */
  collocation: string;
  /** 结构化搭配，演示文件按条展示 */
  collocations: DemoCollocation[];
  exercises: DemoExercise[];
}

export interface DemoExportPayload {
  title: string;
  items: DemoItem[];
}

export interface DemoExportResult {
  filePath: string;
  canceled?: boolean;
}

/**
 * 词单导出的三种版式：
 * - en2zh 给英文单词与词性，留白默写中文
 * - zh2en 给词性与中文释义，留白默写英文
 * - both 中英对照，完整词条列表
 */
export type WordSheetMode = 'en2zh' | 'zh2en' | 'both';

export interface WordSheetItem {
  word: string;
  ipa: string;
  pos: string;
  meaning: string;
}

export interface WordSheetPayload {
  mode: WordSheetMode;
  title?: string;
  items: WordSheetItem[];
}

/** 补充固定搭配的材料来源：照片/截图走视觉模型，Word 与粘贴走主力模型。 */
export type CollocationAim = 'photo' | 'file' | 'paste';

export interface CollocationUnit {
  /** 单元唯一标识，如 bx1u3，用于把搭配存回本机 */
  id: string;
  /** 界面上显示的单元名，如「必修一 · Unit 3」 */
  label: string;
}

/** 参与匹配的单元词条，字段与教材词表一致。 */
export interface CollocationWord {
  order: number;
  word: string;
  ipa: string;
  pos: string;
  meaning: string;
}

export interface CollocationRequest {
  requestId: string;
  aim: CollocationAim;
  /** aim 为 paste 时的文本 */
  text?: string;
  unit: CollocationUnit;
  words: CollocationWord[];
}

export interface CollocationPair {
  order: number;
  word: string;
  collocation: string;
}

export interface CollocationSuccess {
  pairs: CollocationPair[];
  model: string;
  /** 本次材料是图片还是文本 */
  via: 'vision' | 'text';
  /** 材料文件名或「粘贴文本」 */
  sourceLabel: string;
  /** 本次新写入的条数（已有值不会被覆盖） */
  applied?: number;
  /** 用户在选文件对话框里取消时为 true，其余字段为占位值 */
  canceled?: boolean;
}

export interface ExerciseSet {  difficulty: ExerciseDifficulty;
  items: Exercise[];
  completedAt: string;
  model: string;
  /** 分批出题时的缺题说明（哪些目标没出题、是第几批失败） */
  issues?: string[];
}

/** 一次模型调用的留档：用于事后判断「为什么这次没做成」 */
export interface StageTrace {
  /** 阶段名：分组或板块 */
  label: string;
  block?: AnalysisBlock;
  /** 耗时（毫秒） */
  ms: number;
  /** stop / length / 空 */
  finish: string;
  /** 返回正文字符数 */
  chars: number;
  ok: boolean;
  /** 结论：通过几条、被谁挡下、为什么 */
  note: string;
}

/**
 * 解析结果的内容本体。
 * 板块可缺失：某个板块不合格且补发仍失败时，其余板块照常呈现并标出缺口。
 */
export interface AnalysisPayload {
  discourse?: DiscourseNote;
  questions?: QuestionNote[];
  vocab?: VocabEntry[];
  sentences?: SentenceNote[];
  exercise?: ExerciseSet | null;
  /** 旧版（四段文本）历史记录，仅只读展示 */
  legacy?: Section[];
  /** 校验过程中发现的问题（缺字段、句子不合格等），逐条说明 */
  issues?: string[];
  /** 每个模型的调用留档，最多保留 12 条 */
  trace?: StageTrace[];
}

export interface Section {
  id: string;
  title: string;
  text: string;
}

export type ResultSource = 'api' | 'demo';

export interface AnalysisResult extends AnalysisPayload {
  input: AnalysisInput;
  source: ResultSource;
  isSample: boolean;
  model: string;
  completedAt: string;
  requestId: string;
  /** 本次没有拿到的板块，用于界面明确提示缺了什么 */
  missing?: AnalysisBlock[];
}

export type ErrorCode =
  | 'VALIDATION'
  | 'BUSY'
  | 'DUPLICATE'
  | 'NOT_CONFIGURED'
  | 'AUTH'
  | 'BALANCE'
  | 'FORBIDDEN'
  | 'MODEL'
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'SERVER'
  | 'HTTP'
  | 'TLS'
  | 'NETWORK'
  | 'FORMAT'
  | 'EMPTY'
  | 'TRUNCATED'
  | 'FILTERED'
  | 'CANCELLED'
  | 'EXPORT'
  | 'STORAGE'
  | 'INTERNAL';

export interface Failure {
  ok: false;
  code: ErrorCode;
  message: string;
  status?: number;
  /** 解析失败时回传的模型原文，供人工核对（已脱敏） */
  preview?: string;
}

export type Result<T = object> = ({ ok: true } & T) | Failure;

export interface AnalysisSuccess {
  result: AnalysisResult;
}

/** 解析进度：合并尝试与分步补发都会推一条，界面据此显示当前阶段。 */
export interface AnalyzeProgress {
  requestId: string;
  phase: 'combined' | 'staged' | 'exercise' | 'done';
  block?: AnalysisBlock;
  /** 已完成板块数 / 需要生成的板块总数 */
  index?: number;
  total?: number;
  text: string;
}

export interface PracticeInput {
  text: string;
  vocab: VocabEntry[];
  sentences: SentenceNote[];
  difficulty: ExerciseDifficulty;
}

export interface PracticeSuccess {
  exercise: ExerciseSet;
}

export interface SettingsView {
  baseUrl: string;
  model: string;
  /** 识别教材词表照片时使用的视觉模型 */
  visionModel: string;
  timeoutSeconds: number;
  hasKey: boolean;
  /** 密钥是否已加密落盘（下次启动自动恢复） */
  keyPersisted: boolean;
  /** 当前系统是否支持 safeStorage 加密 */
  encryptionAvailable: boolean;
}

export interface SaveSettingsPayload {
  baseUrl: string;
  model: string;
  visionModel?: string;
  timeoutSeconds: number;
  apiKey: string;
}

export interface HistoryEntry {
  id: string;
  createdAt: string;
  input: AnalysisInput;
  payload: AnalysisPayload;
  model: string;
  source: ResultSource;
  /** 生成时的板块缺口，便于回看时说明 */
  missing?: AnalysisBlock[];
}
export interface HistorySummary {
  id: string;
  createdAt: string;
  model: string;
  source: ResultSource;
  /** 文章开头，用于列表识别 */
  excerpt: string;
  charCount: number;
  /** 各板块条目数，列表上给出内容规模 */
  counts: {
    questions: number;
    vocab: number;
    sentences: number;
    hasExercise: boolean;
  };
  /** 旧版留档标记 */
  legacy?: boolean;
}

export type ExportFormat = 'docx' | 'md';

export interface ExportPayload {
  format: ExportFormat;
  /** 导出标题，缺省时由主进程按日期生成 */
  title?: string;
  /** 由结构化结果派生的五个板块文本 */
  sections: Section[];
  input: AnalysisInput;
  model: string;
  completedAt: string;
  source: ResultSource;
  isSample: boolean;
}

export interface ExportSuccess {
  filePath: string;
  canceled?: boolean;
}

/* --------------------------- 文章导入 --------------------------- */

/** 导入文章的材料类型：照片走视觉模型，文件直接读正文。 */
export type ArticleImportAim = 'photo' | 'file';

export interface ArticleImportRequest {
  requestId: string;
  aim: ArticleImportAim;
  /** 拖入文件时直接给出本机路径；缺省则弹系统对话框 */
  paths?: string[];
}

export interface ArticleImportSuccess {
  /** 识别/读取出的整篇原文，含文章与题目 */
  text: string;
  /** 来源标签，如文件名或「照片识别」 */
  sourceLabel: string;
  via: 'vision' | 'text';
  imageCount: number;
  /** 用户在选文件对话框里取消 */
  canceled?: boolean;
}
