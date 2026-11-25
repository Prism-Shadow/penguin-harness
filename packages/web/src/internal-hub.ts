/**
 * The Web App's feature modules' names the session domain's web half consumes, one surface beside
 * the leaf hub (`@prismshadow/penguin-web/internal`): these forwards come from the app's feature
 * modules, whose pages import the moved halves' face, so this file's graph reaches into the moved
 * code and may not be loaded by it — the moved halves take their feature names from here only
 * where the name is read after loading (a render, a call), never while a module body runs.
 *
 * Deliberately a re-export hub and nothing more: no logic, no defaults.
 */

export {
  AgentSelect,
  dropsEmployeeGroup,
  employeesLast,
  employmentsOf,
  isEmployee,
} from "./features/agents/index";

export { pickDefaultAgent } from "./features/ai-create/index";

export { TileIcon, systemShortcutsOf } from "./features/app-center/index";

export { useWorkbenchActions } from "./features/workbenches/index";

export {
  PathCapsulesProvider,
  parseOrgKey,
  switchDeskModel,
  useCompany,
} from "./features/company/index";

export { retryStatus } from "./features/machines/index";

export { readMachine, retryReading } from "./features/machines/machines-view";

export type { RetryReading } from "./features/machines/machines-view";

export { MessagingBindingModal } from "./features/messaging/index";

export {
  ModelCatalogSelect,
  ModelPickerModal,
  SELECTABLE_THINKING_LEVELS,
  ThinkingLevelSelect,
  compactionTally,
  effectiveThinkingLevel,
  heldThinkingSwitch,
  modelLabel,
  needsThinkingSwitchConfirm,
  sessionThinkingLevel,
  thinkingLevelLabel,
  trailingCompaction,
} from "./features/model-picker/index";

export type { StagedThinkingSwitch, ThinkingSwitchItem } from "./features/model-picker/index";

export { groupShape } from "./features/models/connection";

export {
  defaultChatModel,
  hasConfiguredKey,
  sameModelRef,
  turnPricing,
} from "./features/models/index";

export { noteScheduleEvent } from "./features/schedules/index";

export { SettingsDialog } from "./features/settings/index";

export { SkillIcon, SkillPickList, toggleSkillName } from "./features/skills/index";

export {
  HttpStatusError,
  fetchJson,
  liveTerminals,
  noteTerminalCreated,
  noteTerminalReowned,
  refreshTerminals,
  subscribeTerminals,
  terminalApiSupported,
  terminalsOf,
  watchTerminals,
} from "./features/terminal/index";

export type { TerminalInfo } from "./features/terminal/index";

export { WorkspaceLinksProvider, WorkspaceSelect } from "./features/workspace/index";
