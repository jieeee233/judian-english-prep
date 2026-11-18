/** 提示词出口：解析（分组 / 单板块 / 自纠错）与练习。 */
export {
  ABILITY_TAG_LINE,
  BLOCK_GROUPS,
  BLOCK_SPEC,
  buildBlockMessages,
  buildGroupMessages,
  buildSystemPrompt,
  type ChatMessage,
  type RejectedItem,
} from './analysis';

export { buildPracticeMessages } from './practice';

export { BLOCK_SCHEMA, BLOCK_SHAPE, schemaFor, shapeFor } from './schema';
