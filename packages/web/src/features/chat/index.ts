/** The chat module's public face: the drafts interface the sidebar and the session list `@Use`. */
export { ChatDrafts } from "./iface";
export type { ParkedDraft } from "./iface";
export { dispatchChatDefaultsChanged, type ChatDefaultsChangedDetail } from "./chat-defaults-event";
export { clearDraftChatDefaults, clearDraftModelRef } from "./draft-cache";

export { draftSessionTitle } from "./draft-sessions";

export type { DraftSessionEntry } from "./draft-sessions";

export { useDraftSessions } from "./draft-sessions";

export { DRAFT_SESSION_ID } from "./chat-page";

export { clearDraft } from "./draft-cache";

export { sessionDraftKey } from "./draft-cache";

export { removeDraftSession } from "./draft-sessions";

export { prepareNewChatDraft } from "./new-chat";

export { APPROVAL_MODES } from "./approval-mode";

export { draftKey } from "./draft-cache";

export { loadDraft } from "./draft-cache";

export { saveDraft } from "./draft-cache";

export type { DraftCache } from "./draft-cache";

export { parkActiveDraft } from "./draft-sessions";

export type { DraftStorage } from "./draft-cache";

export { createStreamFollow } from "./stream-follow";

export { stickToBottom } from "./stream-follow";

export { panelWidth } from "./use-panel-width";

export { maxWidthFor } from "./use-panel-width";

export { persistPanelWidth } from "./use-panel-width";

export { resetPanelWidth } from "./use-panel-width";

export { setPanelWidth } from "./use-panel-width";

export { usePanelWidthValue } from "./use-panel-width";

export { useNewChat } from "./use-new-chat";
