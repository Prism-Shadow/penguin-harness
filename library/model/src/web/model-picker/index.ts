/**
 * The model picker's public face: the catalog select and its dialog, a model's display label, and
 * the thinking-level vocabulary every picker and the chat page's switch guard share.
 */
export { ModelCatalogSelect, modelLabel } from "./model-select";
export { ModelPickerModal } from "./model-picker-modal";
export {
  SELECTABLE_THINKING_LEVELS,
  compactionTally,
  effectiveThinkingLevel,
  heldThinkingSwitch,
  needsThinkingSwitchConfirm,
  sessionThinkingLevel,
  thinkingLevelLabel,
  trailingCompaction,
} from "./thinking-level";
export type { StagedThinkingSwitch, ThinkingSwitchItem } from "./thinking-level";

export { ThinkingLevelSelect } from "./thinking-level-select";
