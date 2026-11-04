/**
 * The shapes a module implements to contribute to the session list's `rowActions` slot
 * (features/session-list/iface.ts): an entry in a conversation row's menu, a mark on the row, an
 * entry in a Workspace group's menu. A library file, like lib/sidebar-contributions.ts, so a
 * contributor implements them without importing the session list.
 */
import type { ComponentType } from "react";
import type { SessionInfo } from "@prismshadow/penguin-server/api";

/** The row marks a contribution can raise: the package row's paper plane and alarm clock. */
export type SessionRowMarkKind = "relay" | "scheduled";

/** An entry in a conversation row's menu that opens a dialog on that conversation. */
export interface SessionRowEntry {
  id: string;
  label(): string;
  /** A name in the UI package's icon registry. */
  icon: string;
  /** Mounted while open, beside the list's other dialogs; it closes itself through `onClose`. */
  Dialog: ComponentType<{ session: SessionInfo; onClose: () => void }>;
}

/** A mark on conversation rows. */
export interface SessionRowMark {
  kind: SessionRowMarkKind;
  /** A React hook, called once per render of the list: what the mark says on a row, null for none. */
  useLabel(): (session: SessionInfo) => string | null;
}

/** The directory a Workspace group stands for. */
export interface WorkspaceTarget {
  path: string;
  /** The machine the directory is on; null = this server. */
  machineId: string | null;
}

/** What the session list lends a Workspace group's entry. */
export interface WorkspaceEntryHost {
  /** Starts a new-chat draft in the group's directory (route state `browseFiles` opens the dock's Files panel on arrival). */
  newChat(init: { workspace: string; machineId?: string; browseFiles?: boolean }): void;
  /** Called after acting in place, so a drawer around the list closes. */
  onNavigate?(): void;
}

/** An entry in a Workspace group's menu, before the group's own rename and remove. */
export interface WorkspaceGroupEntry {
  id: string;
  label(): string;
  /** A name in the UI package's icon registry. */
  icon: string;
  run(target: WorkspaceTarget, host: WorkspaceEntryHost): void;
}

/** One `rowActions` contribution: any of the three. */
export interface RowAction {
  sessionEntry?: SessionRowEntry;
  sessionMark?: SessionRowMark;
  workspaceEntry?: WorkspaceGroupEntry;
}
