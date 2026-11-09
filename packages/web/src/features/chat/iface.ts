/**
 * The seam between the chat page's drafts and the surfaces that start or list them — the sidebar's
 * New chat, the collapsed rail, the `chat.new` shortcut and the session list's parked drafts.
 * The chat module provides it (chat-drafts.ts); a consumer `@Use`s it and hands it to its
 * components through its own deps, so none of them imports the chat page's draft files.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";

/** One parked draft as a list shows it: unsent new-chat text set aside for later. */
export interface ParkedDraft {
  /** Route id (`draft-<8 hex>`): the draft reopens at `/chat/<id>`. */
  id: string;
  /** The first non-empty line of its text, capped; "" when it has none. */
  title: string;
}

@Interface()
export abstract class ChatDrafts {
  /** The new-chat draft page's route id: the page is `/chat/<newChatId>`. */
  abstract readonly newChatId: string;
  /** A user × Project's parked drafts, newest first — a React hook, re-rendering when they change. */
  abstract useParked(userId: string | null, projectId: string | null): readonly ParkedDraft[];
  /** Drops a parked draft (sent or deleted). Idempotent. */
  abstract removeParked(userId: string, projectId: string, id: string): void;
  /** Drops a deleted conversation's unsent composer text, so no orphaned key is left behind. */
  abstract forgetSession(userId: string, sessionId: string): void;
  /** Clears the active new-chat slot for an entry point about to open it: typed text is parked first. */
  abstract prepareNewChat(userId: string, projectId: string): void;
  /** The generic New chat as a hook: prepares the slot, then opens the draft page on the Project's defaults. */
  abstract useNewChat(): () => void;
}
