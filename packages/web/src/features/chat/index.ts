/**
 * The chat module's public face: the drafts interface the sidebar and the session list `@Use`, and
 * the Workspace picker the session list's create button opens.
 */
export { ChatDrafts } from "./iface";
export type { ParkedDraft } from "./iface";
export { WorkspaceSelect } from "./workspace-select";
export { SELECTABLE_THINKING_LEVELS } from "./thinking-level";
export { ModelCatalogSelect, modelLabel } from "./model-select";
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

export { effectiveThinkingLevel } from "./thinking-level";

export { thinkingLevelLabel } from "./thinking-level";

export { panelWidth } from "./use-panel-width";

export { maxWidthFor } from "./use-panel-width";

export { persistPanelWidth } from "./use-panel-width";

export { resetPanelWidth } from "./use-panel-width";

export { setPanelWidth } from "./use-panel-width";

export { usePanelWidthValue } from "./use-panel-width";

export { useNewChat } from "./use-new-chat";

export { pillClass } from "./workspace-select";
export { ThinkingLevelSelect } from "./thinking-level-select";
export { localizedText } from "../../lib/skill-use";
