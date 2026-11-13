/**
 * The chat module's public face: the drafts interface the sidebar and the session list `@Use`,
 * what a `sessionTabs` contribution receives, the new-chat draft's route and cache for the
 * surfaces that seed it (an Agent card, a plugin's quick start, "Create with AI", the Project's
 * chat defaults), the draft storage an organization channel's composer shares, the Skill text
 * helpers, the transcript's follow-the-bottom scroller and the short Session id.
 */
export { ChatDrafts } from "./iface";
export type { ParkedDraft, SessionTabProps } from "./iface";
export { DRAFT_SESSION_ID, parkActiveDraft } from "./draft-sessions";
export {
  clearDraft,
  clearDraftChatDefaults,
  clearDraftModelRef,
  draftKey,
  loadDraft,
  saveDraft,
} from "./draft-cache";
export type { DraftCache, DraftStorage } from "./draft-cache";
export { prepareNewChatDraft } from "./new-chat";
export { dispatchChatDefaultsChanged } from "./chat-defaults-event";
export type { ChatDefaultsChangedDetail } from "./chat-defaults-event";
export { BOOK_ICON, filterSkills, localizedShortText, localizedText } from "../../lib/skill-use";
export { createStreamFollow, stickToBottom } from "./stream-follow";
export { shortSessionId } from "./agent-topology";

export { draftSessionTitle } from "./draft-sessions";

export type { DraftSessionEntry } from "./draft-sessions";

export { useDraftSessions } from "./draft-sessions";

export { sessionDraftKey } from "./draft-cache";

export { removeDraftSession } from "./draft-sessions";

export { APPROVAL_MODES } from "./approval-mode";

export { useNewChat } from "./use-new-chat";
