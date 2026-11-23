/**
 * The chat module's interfaces. `ChatDrafts` is the seam between the chat page's drafts and the
 * surfaces that start or list them — the sidebar's New chat, the collapsed rail, the `chat.new`
 * shortcut and the session list's parked drafts. The chat module provides it (chat-drafts.ts); a
 * consumer `@Use`s it and hands it to its components through its own deps, so none of them
 * imports the chat page's draft files.
 *
 * `Chat` carries the page's slots: `fileRenderers`, the named components a server's file renderer
 * rule may pick to draw a Workspace file below the reply paragraph that links it
 * (lib/file-renderers.ts); `sessionHandovers`, what another module keeps under a conversation's
 * id and moves when the conversation takes a new one (session-handover.ts); and `linkActions`,
 * rows another module adds to the stream's menu for a web link (link-actions.ts). The last two
 * take the plugin face's types.
 */
import { Interface, type Slot } from "@prismshadow/penguin-core/kernel";
import type { LinkAction, Ordered, SessionHandover } from "@prismshadow/penguin-web-plugin";

import type { FileRenderer } from "../../lib/file-renderers";

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

/** Carries nothing: the kernel hangs the chat module's slot on an interface it provides. */
@Interface()
export abstract class Chat {}

/** The data half of a `fileRenderers` contribution. */
export interface FileRendererData {
  /** The name a rule's `builtin` renderer names it by. */
  name: string;
}

export interface ChatSlots {
  /** A named file renderer. */
  fileRenderers: Slot<FileRendererData, FileRenderer>;
  /** Moves what its module keeps under a conversation's old id to its new one, in `order`. */
  sessionHandovers: Slot<Ordered, SessionHandover>;
  /** A row of the stream's menu for a web link, before the app's own rows, in `order`. */
  linkActions: Slot<Ordered, LinkAction>;
}
