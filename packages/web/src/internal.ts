/**
 * The web app's internals the domain packages' web halves compile against, one surface: each
 * web half under library/ consumes the web host through this subpath
 * (`@prismshadow/penguin-web/internal`), so the half's imports name one seam instead of
 * reaching into the host's file tree. The host compiles the halves with the app (vite and the
 * app's own tsconfig), so this file carries no logic of its own.
 *
 * Deliberately a re-export hub and nothing more: every export is named (star re-exports are
 * reserved for a module whose whole surface one half consumes, so a name added to such a
 * module cannot silently collide), no defaults, no logic.
 */
export {
  TEMP_WORKSPACE_GROUP_KEY,
  isTempWorkspace,
  workspaceGroupMachine,
  workspaceGroupPath,
} from "./lib/session-grouping";
export { DraftPanelEmpty } from "./lib/dock-panel-empty";
export { useChatSession } from "./lib/chat-session";
export { S } from "./lib/strings";
export { PageIdentity } from "./lib/page-focus";
export {
  panelLabel,
  setCloseGuard,
  tabKey,
  TERMINAL_PANEL,
  dockVersion,
  subscribeDock,
  terminalPanelOffered,
  subscribeTerminalPanelOffered,
  type DockPanelBodyProps,
  type PanelId,
} from "./features/dock/index";
export {
  createShell,
  ownTerminals,
  selectTerminal,
  shownTerminalId,
  useDockSessionId,
} from "./features/dock/dock-terminal";
export { filesApi, filesScopeKey, type FilesScope } from "./api/workspace-files";
export { formatBytes, formatDateTime, formatRelativeLong, formatRelativeShort, formatShortDateTime, formatSpan } from "./lib/format";
export { cardBodyClick } from "./lib/card-open";
export { dismissNotice, envOnlyNoticeId, skippedNoticeId, useNoticeDismissed } from "./lib/notice-dismissals";
export { useDocumentTitle } from "./lib/use-document-title";
export { useReaderFind } from "./lib/reader-find";
export { fetchTextPreview } from "./lib/text-preview";
export * from "./lib/workspace-tree";
export { failureNode, toldFailure, toldNode } from "./lib/failure";
export { ApiError } from "./api/client";
export { useAuth } from "./state/auth";
export { isDesktopShellWindow } from "./lib/account-menu";
export { isShortcut } from "./lib/shortcuts/match";
export { currentPlatform } from "./lib/shortcuts/platform";
export { keymap } from "./lib/shortcuts/store";
export { joinWorkspacePath } from "./lib/file-path";
export { writeClipboard } from "./lib/clipboard";
export { dropRegionAction, isFileDrag, type DragSignal } from "./lib/file-drop";
export { MB_BYTES, splitBySize } from "./lib/upload-limits";
export { restoreSelection } from "./components/ui/text-selection";
export { STAT_ICONS } from "./lib/stat-icons";
export { toneInk, type Tone } from "./lib/tone";
export { toastApiError } from "./lib/toast-api-error";
export { isElectronRenderer } from "./lib/desktop-renderer";
export {
  machineLabel,
  nameOnMachine,
  workspaceMachines,
  type WorkspaceMachine,
} from "./lib/workspace-machines";
export { useSessions } from "./state/sessions";
export { useMachines } from "./state/machines";
export { replyLinkBehavior } from "./lib/reply-link";
export { pageSessionId, PAGE_DRAG_TYPE, type OpenPage } from "./lib/page-layout";
export { getSession, getWorkbenches } from "./api/endpoints";
export * as api from "./api/endpoints";
export { locatedAppKey, appWindowPath } from "./lib/app-center-path";
export { sessionAppPair, slotDomId } from "./lib/session-app-dock";
export { usePageWorkspace } from "./lib/page-workspace-context";
export {
  panelLabel,
  setCloseGuard,
  tabKey,
  TERMINAL_PANEL,
  dockVersion,
  isNarrow,
  subscribeDock,
  terminalPanelOffered,
  subscribeTerminalPanelOffered,
  type DockPanelBodyProps,
  type PanelId,
} from "./features/dock/index";
export { localizedText } from "./lib/skill-use";
export {
  launchApp,
  useRestoreApp,
  useRunningAppRecords,
  type RunningShortcut,
} from "./lib/running-apps";
export { shortcutOfWorkbench } from "./lib/workbench-shortcut";
export { runningWorkbenches, WORKBENCH_UPDATED_EVENT } from "./lib/workbench-tabs";
export { useLocale } from "./state/locale";
export { useProject } from "./state/project";
export { TileIcon } from "./features/app-center";
export { useSafeMode } from "./rescue/safe-mode";
export { ErrorBoundary } from "./rescue/error-boundary";
export { RescuePanel } from "./rescue/rescue-panel";
export { PageSlot, useNarrow } from "./lib/page-slot";
export { WorkbenchExitBall } from "./features/workbenches";
export { apiErrorText } from "./lib/api-error";
export { focusSessionMachine } from "./lib/session-machines";
export { NAV_ICONS } from "./lib/nav-icons";
export { useTheme } from "./state/theme";
export { useCoarsePointer } from "./lib/use-coarse-pointer";
export { useVisualViewportHeight } from "./lib/use-visual-viewport-height";
export { useShortcutLabel } from "./lib/shortcuts/use-keymap";
export { terminalClipboardAction } from "./lib/shortcuts/terminal-clipboard";
export { terminalKeyAction } from "./lib/shortcuts/terminal-keys";
export {
  machineForTerminal,
  rememberTerminalMachine,
  terminalSources,
  terminalUrl,
} from "./lib/terminal-machines";
export { probeSession } from "./api/session-probe";
export { ANSWER_TIMEOUT_MS } from "./api/socket";
export { apiUrl } from "./lib/server-context";
export { HttpStatusError, fetchJson, probeJson } from "./lib/terminal-http";
export { adminGetSettings, adminPutSettings } from "./api/endpoints";
export { SETTINGS_SCOPE } from "./lib/unsaved/scopes";
