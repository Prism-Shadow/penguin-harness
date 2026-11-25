/**
 * The Web App's internals the session domain's web half compiles against, one surface: the
 * half under library/session/src/web consumes the web host through this subpath
 * (`@prismshadow/penguin-web/internal`), so its imports name one seam instead of reaching
 * into the host's file tree. Explicit named re-exports only — every name a consumer imports
 * is listed here once, and a name two modules export arrives under one of them aliased
 * (`useCompanyContext`).
 *
 * Leaf sources only: every file a statement here forwards from is free of imports of the moved
 * halves' face, so loading this hub can never loop back into a moved module. The forwards from
 * the app's feature modules — whose pages import that face — live in the sibling hub
 * (`@prismshadow/penguin-web/internal-hub`, src/internal-hub.ts), which the app's own surfaces
 * import for those names; no moved module imports it.
 *
 * Deliberately a re-export hub and nothing more: no logic, no defaults.
 */

// The moved modules call these three bindings as their bodies load (the dock's command
// handlers, the launcher's account hook, the draft heights' chords), and a face import inside
// the hub's own sources (lib/account-sync/prefs) can loop back into them mid-load. Their
// re-exports are the hub's first statements, so the bindings are in place however the cycle
// re-enters.

export { subscribeAccountApplied, syncedStorage, writeCached } from "./lib/account-sync/cache";

export { LAUNCHER_HIDDEN_KEY, STEER_MODE_KEY } from "./lib/account-sync/prefs";

export { onCommand } from "./lib/shortcuts/dispatcher";

export { chordEquals, chordOf, parseChord } from "./lib/shortcuts/chord";

export { ApiError } from "./api/client";

export * as api from "./api/endpoints";
export {
  abortSubagent,
  getAgentPlugins,
  getChildSessions,
  getGoal,
  getSession,
  getSessionContext,
  getVoicePolish,
  listSessions,
  messageSubagent,
  patchSession,
  polishTranscript,
  readReplyAloud,
  transcribeRecording,
} from "./api/endpoints";
export type { ChildSessionEntry } from "./api/endpoints";

export { probeSession } from "./api/session-probe";

export { apiSocket } from "./api/socket";

export { openHistoryStream, openSessionStream, openTraceBodyStream } from "./api/sse";

export type { ToolBinding } from "./api/tool-types";

export { VersionStamp } from "./components/account/version-stamp";

export { chordKeys } from "./components/ui/chord-kbd";

export {
  GROUP_MODE_ICONS,
  GroupPager,
  Icon,
  SORT_MODE_ICONS,
  initialGroupMode,
  newEntityForGroupMode,
  storeGroupMode,
} from "./components/ui/group-list";
export type { GroupMode } from "./components/ui/group-list";

export {
  CONTEXT_MENU_ACTIONS,
  HOVER_ROW_ACTIONS,
  sessionRowActions,
} from "./components/ui/session-row-menu";
export type { SessionRowAction } from "./components/ui/session-row-menu";

export {
  CostPartsRows,
  ElapsedSplitRows,
  StatHint,
  TokenPartsRows,
} from "./components/ui/stat-hint";
export type { UsageParts } from "./components/ui/stat-hint";

export { restoreSelection } from "./components/ui/text-selection";

export { Truncated } from "./components/ui/truncated";

export { a2uiDrafts } from "./lib/a2ui-drafts";

export { isDesktopShellWindow } from "./lib/account-menu";

export { useAgentAvatarSrc } from "./lib/agent-avatar";

export { agentSettingsPath } from "./lib/agent-location";

export { installWithModules } from "./lib/agent-plugin-install";

export {
  compactionDegraded,
  compactionResultVisible,
  compactionShortOfRoom,
  compactionSummaryText,
  refusalHandoff,
} from "./lib/amsp/compaction-summary";

export {
  aggregateMemoryChanges,
  isFolderFilePath,
  memoryRowKey,
  orderUnderTopics,
  sameMemoryChanges,
} from "./lib/amsp/memory-changes";
export type {
  MemoryChangeOp,
  MemoryChangeRow,
  MemoryLocateTarget,
} from "./lib/amsp/memory-changes";

export {
  FIRST_PAINT_BYTES,
  TAIL_UNITS,
  createStreamController,
} from "./lib/amsp/stream-controller";
export type {
  HistoryTransfer,
  OlderHistoryState,
  PendingApproval,
  StreamController,
} from "./lib/amsp/stream-controller";

export {
  approvalKey,
  createStreamModel,
  elidedRecordsOf,
  finalizeHistory,
  hasPendingWithinOrigin,
  localWorkTime,
  pushMessage,
  pushMessages,
  seedHistoryWindow,
} from "./lib/amsp/stream-model";
export type {
  ChatItem,
  CompactionItem,
  LlmErrorItem,
  McpConnectItem,
  McpServerOutcome,
  McpToolSummary,
  NestedSessionMeta,
  ReconnectItem,
  StreamModel,
  ThinkingItem,
  ToolCallItem,
} from "./lib/amsp/stream-model";

export {
  bucketCostUsd,
  formatTaskStats,
  liveSessionElapsedMs,
  mergedIntervalMs,
  sessionElapsedBreakdown,
} from "./lib/amsp/task-stats";
export type { BucketPricing, TaskStats, TaskStatsTracker } from "./lib/amsp/task-stats";

export { apiErrorText } from "./lib/api-error";

export { attachmentFileName, splitAttachments } from "./lib/attachments";

export { PENGUIN_LOGO_URL } from "./lib/brand-logo";

export { SYSTEM_AGENT_ID, isConversationAgent } from "./lib/builtin-agents";

export { CONTEXT_PART_COLORS } from "./lib/category-colors";

export { ChatSessionContext, useChatSession } from "./lib/chat-session";
export type { ChatSession } from "./lib/chat-session";

export { writeClipboard } from "./lib/clipboard";

export { useCompany as useCompanyContext } from "./lib/company-context";

export {
  MIN_COMPACTION_THRESHOLD,
  THRESHOLD_STEP,
  configuredCompactionLimit,
  contextFillBasis,
  modelWindowBelowCompactionLimit,
  resolveContextWindow,
  snapThreshold,
  thresholdCappedByWindow,
  thresholdFraction,
  thresholdFromPointer,
} from "./lib/context";

export { requestDefaultModels } from "./lib/default-models-request";

export { confirmClose, setCloseGuard } from "./lib/dock-close-guard";

export { DockPanelTitle } from "./lib/dock-panel-empty";

export {
  dockPanelDefinition,
  dockPanels,
  dockPanelsVersion,
  panelGlyphPath,
  panelLabel,
  registerDockPanel,
  subscribeDockPanels,
  useDockPanels,
  useSessionWorkbenchPanels,
} from "./lib/dock-panel-registry";
export type { DockPanelBodyProps, DockPanelDefinition, PanelId } from "./lib/dock-panel-registry";

export {
  draftUploads,
  forgetDraftUploads,
  hasDraftUploads,
  parkDraftUploads,
} from "./lib/draft-uploads";
export type { DraftUploads } from "./lib/draft-uploads";

export { failureNode, toldFailure, toldNode } from "./lib/failure";

export { dropRegionAction, isFileDrag, splitDroppedFiles } from "./lib/file-drop";
export type { DragSignal, DropRegionAction } from "./lib/file-drop";

export { isFilePathLike, toWorkspaceRelative } from "./lib/file-path";

export { useFileRendererRules } from "./lib/file-renderers";
export type { FileRenderer, FileRendererRule } from "./lib/file-renderers";

export { FIND_LOAD_OLDER_EVENT, FIND_MORE_ATTR } from "./lib/find-dom";

export { FindRevealContext, useRegionRevealed } from "./lib/find-expand";

export { GUIDE_MODEL_SELECTED } from "./lib/first-workbench-entry";

export {
  cacheHitRate,
  formatBytes,
  formatDateTime,
  formatMessageTime,
  formatMoney,
  formatPercent,
  formatRelativeDate,
  formatRelativeShort,
  formatTps,
  humanizeDuration,
  humanizeDurationLive,
  humanizeTokens,
} from "./lib/format";

export { elidedArgumentsPreview, elidedPreview } from "./lib/history/elided-preview";

export { readHistory } from "./lib/history/history-read";

export { transferAmount } from "./lib/history/transfer-amount";

export { isLongPaste, longPasteFileName } from "./lib/long-paste";

export { mixAgents, useMachineAgents } from "./lib/machine-agent-lists";

export { cachedMachineAgents, rememberMachineAgents } from "./lib/machine-cache";

export { machineLink, remoteAgentsEmpty } from "./lib/machine-link";
export type { MachineLink } from "./lib/machine-link";

export { useMachineModels } from "./lib/machine-models";

export type {
  MainSidebarProps,
  SidebarBindingReader,
  SidebarNavSelector,
  SidebarPagesReader,
} from "./lib/main-sidebar-bindings";

export {
  DRAFTS_GROUP_KEY,
  DRAG_POINTER_QUERY,
  GROUP_ACTION_CLASS,
  GROUP_DRAG_MIME,
  NEW_CHAT_ICON,
  SESSION_DRAG_MIME,
  collapsedGroupsKey,
  isGroupDrag,
  loadGroupSet,
  pinnedGroupsKey,
  saveGroupSet,
} from "./lib/main-sidebar-persistence";

export { createDeps } from "./lib/module-deps";

export {
  contributionShown,
  gatedComponent,
  subscribeModuleGates,
  useContributionShown,
  useModuleGates,
} from "./lib/module-gate";

export { glyphOf } from "./lib/nav-icons";

export { publishPageAgent, usePageAgent } from "./lib/page-agent";

export { PageIdentity, usePaneFocus } from "./lib/page-focus";

export { PAGE_DRAG_TYPE, pageSessionId } from "./lib/page-layout";
export type { OpenPage } from "./lib/page-layout";

export { useNarrow } from "./lib/page-slot";

export { usePageWorkspace } from "./lib/page-workspace-context";

export {
  PERMISSION_LEVEL_GLYPH,
  PERMISSION_LEVEL_TONE,
  UNCONFINED,
  approvalModePick,
  draftSandboxAfter,
  firstUnavailableBackend,
  matchPreset,
  menuRowLevel,
  permissionLevel,
  permissionMenu,
  presetBlock,
  presetEffects,
  presetPick,
  presetsOf,
  sandboxSwitchOff,
} from "./lib/permission-level";
export type { PermissionLevel, PermissionPick, PresetBlock } from "./lib/permission-level";

export { onPluginConfigSaved } from "./lib/plugin-config-event";

export { ofProject, scopeKey, scoped, scopedValue } from "./lib/project-scope";
export type { Scoped } from "./lib/project-scope";

export { randomHex } from "./lib/random-id";

export { resolveReplyLink } from "./lib/reply-link";

export { useRunningAppRecords } from "./lib/running-apps";

export { inEditable, writeSelectionCopy } from "./lib/selection-copy";

export {
  LINK_MENU_ITEMS,
  SELECTION_MENU_ITEMS,
  excerptLabel,
  excerptReference,
  linkAnchor,
  menuLinkHref,
  selectionEndAnchor,
  streamMenuContent,
} from "./lib/selection-menu";

export { apiUrl } from "./lib/server-context";

export {
  sessionActivity,
  sessionActivityLabel,
  sessionBackgroundTasks,
  sessionRowActivity,
} from "./lib/session-activity";
export type { SessionActivity } from "./lib/session-activity";

export {
  ScopedPanelSession,
  SessionAppDockBody,
  dockPageId,
  dockPageKey,
  existingDockPanel,
  registerSessionAppDockAdapter,
  sessionAppPair,
} from "./lib/session-app-dock";

export {
  SIDEBAR_PAGE_SIZE,
  TIME_LIST_KEY,
  aggregateWorkspaceCounts,
  aggregateWorkspaceLatest,
  clampGroupPage,
  completeWorkspaceGroups,
  cutAtWatermark,
  groupPageCount,
  groupPageOf,
  groupPageSlice,
  groupSessionsByTime,
  groupSessionsByWorkspace,
  isSidebarRow,
  isTempWorkspace,
  latestConversation,
  matchesSessionQuery,
  revealPlan,
  revealStep,
  sectionWindow,
  withoutOrgSessions,
  workspaceGroupKey,
  workspaceGroupPath,
  workspaceGroupQuery,
  workspaceLabel,
} from "./lib/session-grouping";
export type { WorkspaceGroup } from "./lib/session-grouping";

export {
  machineForSession,
  rememberSessionMachine,
  routedUrl,
  sessionKnownHere,
} from "./lib/session-machines";

export {
  applyManualReorder,
  initialSessionSortMode,
  loadSessionOrder,
  moveInSequence,
  orderSessionRows,
  orderWithinPinPartitions,
  readStringArray,
  removeFromSessionOrder,
  saveSessionOrder,
  storeSessionSortMode,
  writeStringArray,
} from "./lib/session-order";
export type { SessionOrderStorage, SessionSortMode } from "./lib/session-order";

export { closeSessionResources, listSessionResourceCounts } from "./lib/session-resource-counts";

export type {
  RowAction,
  SessionRowEntry,
  SessionRowMark,
  SessionRowMarkKind,
  WorkspaceEntryHost,
  WorkspaceGroupEntry,
  WorkspaceTarget,
} from "./lib/session-row-contributions";

export { forgetSession, noteSessionSeen, useSessionSeen } from "./lib/session-seen";

export { backgroundSourceMark, programSource } from "./lib/session-source-mark";

export {
  isSessionWorkbenchKind,
  parseSessionWorkbenchPage,
  sessionWorkbenchEntries,
  sessionWorkbenchKindAt,
  sessionWorkbenchPage,
} from "./lib/session-workbenches";
export type { SessionWorkbenchKind } from "./lib/session-workbenches";

export { currentPlatform } from "./lib/shortcuts/platform";

export { displayedBinding, useKeymap, useShortcutTitle } from "./lib/shortcuts/use-keymap";

export type { SidebarSection } from "./lib/sidebar-contributions";

export { currentModeIndex, sectionsIn } from "./lib/sidebar-modes";

export {
  BOOK_ICON,
  buildSkillsMessage,
  filterSkills,
  localizedShortText,
  localizedText,
  parseSkillsMessage,
  skillSlashItems,
} from "./lib/skill-use";
export type { SkillDescLike, SkillSlashItem } from "./lib/skill-use";

export { STAT_ICONS } from "./lib/stat-icons";

export { S, zh } from "./lib/strings";

export { stripAnsi } from "./lib/strip-ansi";

export { systemAppKey, useSystemApps } from "./lib/system-apps";
export type { SystemShortcut } from "./lib/system-apps";

export { rememberTerminalMachine } from "./lib/terminal-machines";

export { fitTextarea } from "./lib/textarea-fit";

export { toastApiError, toastFailure } from "./lib/toast-api-error";

export { toneInk } from "./lib/tone";

export { toolDisplayName } from "./lib/tool-alias";

export { versionBadgeFor } from "./lib/update-flow";

export { splitBySize } from "./lib/upload-limits";

export { useCoarsePointer } from "./lib/use-coarse-pointer";

export { useDocumentTitle } from "./lib/use-document-title";

export { useFreshRead } from "./lib/use-fresh-read";

export { useRsiToolkits } from "./lib/use-rsi-toolkits";

export { useUpdateBadges } from "./lib/use-update-badges";

export { openAppInfo, useUpdateFlow } from "./lib/use-update-flow";

export { useVersionInfo } from "./lib/use-version-info";

export { nameOnMachine } from "./lib/workspace-machines";

export { lineSuffix } from "./lib/workspace-tree";
export type { ComposerReference } from "./lib/workspace-tree";

export { WORKBENCH_NEWS_SETTLE_MS, WORKBENCH_UPDATED_EVENT } from "./lib/workbench-tabs";
export type { WorkbenchUpdatedDetail } from "./lib/workbench-tabs";

export { useAuth } from "./state/auth";

export { useLocale } from "./state/locale";

export { useMachines } from "./state/machines";

export { agentDisplayName, useProject } from "./state/project";

export { useSessions } from "./state/sessions";

export { useActivityAppearance, useTheme } from "./state/theme";
export type { Currency } from "./state/theme";

export { boundToolModel, useToolBindings } from "./state/use-tool-bindings";

export { useSafeMode } from "./rescue/safe-mode";

// The server-side values the half imports (the draft marker and the model catalog's provider
// info): the server faces are the host's to resolve — the Web App already reads them — and the
// half takes the values from here.
export { DRAFT_SESSION_ID } from "@prismshadow/penguin-server/api";

export { modelCalledKeyless, providerInfo } from "@prismshadow/penguin-server/model-catalog";

// The features' re-exports come last: a moved module reaches its host plumbing through this
// hub, and a features import (through a face deep path) can loop back into a moved module
// whose body calls a hub binding as it loads. The hub's own re-export of that binding must
// already be in place by then, so the leaves are re-exported before the features.
