/**
 * The chat module's public face: the drafts interface the sidebar and the session list `@Use`, the
 * new-chat draft's route and cache for the surfaces that seed it (an Agent card, a plugin's quick
 * start, "Create with AI", the Project's chat defaults), the Skill text helpers, the transcript's
 * follow-the-bottom scroller, and the dock's shared panel width.
 */
export { ChatDrafts } from "./iface";
export type { ParkedDraft } from "./iface";
export { DRAFT_SESSION_ID, parkActiveDraft } from "./draft-sessions";
export {
  clearDraftChatDefaults,
  clearDraftModelRef,
  draftKey,
  loadDraft,
  saveDraft,
} from "./draft-cache";
export type { DraftCache } from "./draft-cache";
export { prepareNewChatDraft } from "./new-chat";
export { dispatchChatDefaultsChanged } from "./chat-defaults-event";
export type { ChatDefaultsChangedDetail } from "./chat-defaults-event";
export { BOOK_ICON, filterSkills, localizedShortText, localizedText } from "../../lib/skill-use";
export { createStreamFollow, stickToBottom } from "./stream-follow";
export {
  maxWidthFor,
  panelWidth,
  persistPanelWidth,
  resetPanelWidth,
  setPanelWidth,
  usePanelWidthValue,
} from "./use-panel-width";

export { draftSessionTitle } from "./draft-sessions";

export type { DraftSessionEntry } from "./draft-sessions";

export { useDraftSessions } from "./draft-sessions";

export { clearDraft } from "./draft-cache";

export { sessionDraftKey } from "./draft-cache";

export { removeDraftSession } from "./draft-sessions";

export { APPROVAL_MODES } from "./approval-mode";

export type { DraftStorage } from "./draft-cache";

export { useNewChat } from "./use-new-chat";
