/**
 * The sessions domain's web half (`./web`), which the Web App compiles in at build time: the
 * chat page and its drafts, the session list (the sidebar's controller and rows), and the dock
 * — with the module classes the composition root lists. The app's own surfaces reach this half
 * only through the names exported here; the half consumes the app through the app's internals
 * face (`@prismshadow/penguin-web/internal`).
 */
export { ChatModule } from "./chat/module";

export { SessionListModule } from "./session-list/module";

export { DockModule } from "./dock/module";

// The chat page's public face: the drafts interface the sidebar and the session list `@Use`,
// the draft cache a channel composer or a plugin surface shares, and the keys the app's own
// preference storage reads.
export {
  APPROVAL_MODES,
  ChatDrafts,
  DRAFT_SESSION_ID,
  HistoryFileLoading,
  STEER_MODE_KEY,
  clearDraft,
  clearDraftChatDefaults,
  clearDraftModelRef,
  createStreamFollow,
  dispatchChatDefaultsChanged,
  draftKey,
  loadDraft,
  parkActiveDraft,
  prepareNewChatDraft,
  saveDraft,
  stickToBottom,
  useNewChat,
} from "./chat";
export type { ChatDefaultsChangedDetail, DraftCache, DraftStorage } from "./chat";

// The session list's public face: the sidebar controller the frame binds and the rows and
// dialogs it renders.
export {
  MainSidebarFragments,
  renderMainSessionDialogs,
  renderMainSessionList,
  useMainSidebarController,
} from "./session-list";
export type { MainSidebarState } from "./session-list";

// The dock's public face: the panel registry the other modules' panels register through, the
// state the app's own surfaces subscribe to, and the terminal the dock hosts.
export {
  LAUNCHER_HIDDEN_KEY,
  TERMINAL_PANEL,
  createShell,
  currentDockScope,
  dockVersion,
  isTabShown,
  launcherHiddenVersion,
  openPanel,
  ownTerminals,
  panelLabel,
  readLauncherHidden,
  selectTerminal,
  setCloseGuard,
  shownTerminalId,
  subscribeDock,
  subscribeLauncherHidden,
  subscribeTerminalPanelOffered,
  tabKey,
  terminalPanelOffered,
  useDockSessionId,
  writeLauncherHidden,
} from "./dock";
export type { DockPanelBodyProps, PanelId } from "./dock";
