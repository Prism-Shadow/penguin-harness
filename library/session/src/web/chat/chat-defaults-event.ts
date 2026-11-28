/**
 * Same-tab notification that a Project's new-chat defaults were saved (project-settings
 * dialog → any live view seeded from them). The dialog and the draft page are mounted by
 * different trees (sidebar vs route), so a window CustomEvent is the narrowest channel: the
 * dialog dispatches after its PUTs land, carrying the fresh server-confirmed values, and a
 * mounted DraftView / ChatPage reseeds from the payload without refetching what the dialog
 * already holds. Same-tab only by design — other tabs (and the stripped localStorage cache)
 * pick the new defaults up on their next /chat/new mount.
 */
import type { ChatDefaultsDto, ModelRefDto } from "@prismshadow/penguin-server/api";

export const CHAT_DEFAULTS_CHANGED_EVENT = "penguin:chat-defaults-changed";

export interface ChatDefaultsChangedDetail {
  projectId: string;
  /** Present iff the `[default_chat]` block changed: the stored block the PUT returned. */
  defaults?: ChatDefaultsDto;
  /** Present iff the Project default model changed: the new default (paired reference). */
  defaultModel?: ModelRefDto;
}

export function dispatchChatDefaultsChanged(detail: ChatDefaultsChangedDetail): void {
  window.dispatchEvent(
    new CustomEvent<ChatDefaultsChangedDetail>(CHAT_DEFAULTS_CHANGED_EVENT, { detail }),
  );
}

/** Listener-side accessor: returns the detail when the event targets `projectId`, else null. */
export function chatDefaultsChangedDetail(
  e: Event,
  projectId: string,
): ChatDefaultsChangedDetail | null {
  const detail = (e as CustomEvent<ChatDefaultsChangedDetail>).detail;
  return detail && detail.projectId === projectId ? detail : null;
}
