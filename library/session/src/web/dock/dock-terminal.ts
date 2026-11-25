/**
 * The dock's terminal-side helpers: the conversation the docks belong to, its shells, creating
 * one, opening the terminal panel, and the global `terminal.*` commands. Split from
 * dock-state.ts so the store stays pure (unit-testable without fetch); this module owns every
 * server round-trip the terminal panel needs.
 *
 * The terminal is ONE dock panel per conversation (`terminal`, 「命令行终端」), and its body
 * draws the conversation's shells as a strip of tabs inside it, the way the browser panel draws
 * its pages. A shell belongs to the Session that created it (the server records `sessionId`): a
 * conversation creates its shells with its own id, and its panel lists exactly those, on its
 * machine — including ones opened on another device. A draft has no Session yet, so it has no
 * terminal at all until its first send.
 */
import { useSyncExternalStore } from "react";
import type { SessionWorkbenchScope } from "@prismshadow/penguin-web-plugin";
import { onCommand } from "@prismshadow/penguin-web/internal/lib/shortcuts/dispatcher";
import {
  HttpStatusError,
  S,
  fetchJson,
  liveTerminals,
  noteTerminalCreated,
  noteTerminalReowned,
  refreshTerminals,
  rememberTerminalMachine,
  terminalApiSupported,
  terminalsOf,
  toastApiError,
  watchTerminals,
} from "@prismshadow/penguin-web/internal";
import type { TerminalInfo } from "@prismshadow/penguin-web/internal";

import {
  currentDockScope,
  docksOnScreen,
  openPanel,
  setShownShell,
  shownShell,
  subscribeDock,
  toggleDock,
  togglePanelShown,
  type DockPosition,
} from "./dock-state";

/** The terminal panel's id in the registry and the dock store (and its stored tab key). */
export const TERMINAL_PANEL = "terminal";

/** Where the panel's tab lands when it has none yet and nothing asked for a dock. */
const TERMINAL_DOCK: DockPosition = "bottom";

/** Where a new shell starts when no Workspace is known: the user's home directory. */
const HOME_CWD = "~";

/**
 * The conversation the page's docks belong to, as the surface that knows it publishes it (the
 * chat page for a Session, the draft page for the Workspace picked there) rather than read from
 * a store, because the terminal commands run from module-scope handlers with no React context to
 * consult.
 */
export interface DockConversation {
  /** The owning Project for a Session-scoped first open from a native dock. */
  projectId?: string;
  /** The Session that owns the shells opened here; null while drafting (or none loaded yet). */
  sessionId: string | null;
  /** Its Workspace, where a new shell starts — what the agent has been working in. */
  workspace: string | null;
  /**
   * The machine the conversation runs on (null: this server). A shell for it has to be a pty
   * on THAT machine: the files it is for are there, and the agent it sits beside is there.
   */
  machineId: string | null;
}

let conversation: DockConversation = { sessionId: null, workspace: null, machineId: null };
const conversationListeners = new Set<() => void>();

/** Publishes the conversation on screen; an empty Workspace path counts as none (home). */
export function setDockConversation(next: DockConversation): void {
  const workspace = next.workspace !== null && next.workspace.trim() !== "" ? next.workspace : null;
  if (
    next.projectId === conversation.projectId &&
    next.sessionId === conversation.sessionId &&
    workspace === conversation.workspace &&
    next.machineId === conversation.machineId
  )
    return;
  conversation = { ...next, workspace };
  for (const listener of [...conversationListeners]) listener();
}

/**
 * The Session whose shells this page's docks may list and open, or null when there is none:
 * a draft, a page without docks, or the moment between a route change and the new conversation
 * being published — the docks have already switched to the next conversation's scope then, so
 * the last one's id must not be used to fill them.
 */
export function dockSessionId(): string | null {
  const sessionId = conversation.sessionId;
  return sessionId !== null && sessionId === currentDockScope() ? sessionId : null;
}

/** Hears both halves dockSessionId reads: the published conversation and the dock's scope. */
export function subscribeDockSession(listener: () => void): () => void {
  conversationListeners.add(listener);
  const offDock = subscribeDock(listener);
  return () => {
    conversationListeners.delete(listener);
    offDock();
  };
}

/** dockSessionId as a render reads it. */
export function useDockSessionId(): string | null {
  return useSyncExternalStore(subscribeDockSession, dockSessionId);
}

/** The conversation's live shells, on its machine, in creation order — the panel's strip. */
export function ownTerminals(group?: SessionWorkbenchScope): TerminalInfo[] {
  const sessionId = group?.sessionId ?? dockSessionId();
  return sessionId === null
    ? []
    : terminalsOf(sessionId, group ? group.machineId : conversation.machineId);
}

function terminalSelectionScope(group: SessionWorkbenchScope): string {
  return `terminal:${JSON.stringify([group.projectId, group.machineId, group.sessionId])}`;
}

export function selectTerminal(id: string, group?: SessionWorkbenchScope): void {
  setShownShell(id, group ? terminalSelectionScope(group) : undefined);
}

/**
 * The shell the panel shows: the one last shown here while it is still one of the
 * conversation's live shells, else the newest; null when it has none.
 */
export function shownTerminalId(group?: SessionWorkbenchScope): string | null {
  const own = ownTerminals(group);
  const kept = shownShell(group ? terminalSelectionScope(group) : undefined);
  if (kept !== null && own.some((t) => t.id === kept)) return kept;
  return own.at(-1)?.id ?? null;
}

/** Whether the panel is offered here: a server with terminals, and a Session to own them. */
export function terminalPanelOffered(): boolean {
  return terminalApiSupported() && dockSessionId() !== null;
}

/**
 * terminalPanelOffered's change feed, for the panel registry: fires only when the answer flips,
 * and only listens — the registry follows it for good, from module load, on every page.
 */
export function subscribeTerminalPanelOffered(listener: () => void): () => void {
  let last = terminalPanelOffered();
  const check = (): void => {
    const next = terminalPanelOffered();
    if (next === last) return;
    last = next;
    listener();
  };
  const offList = watchTerminals(check);
  const offSession = subscribeDockSession(check);
  return () => {
    offList();
    offSession();
  };
}

/**
 * The Workspace the page's docks belong to — the conversation's, or the one the draft picked —
 * with its machine; null when none is known. Only meaningful while a page with docks is on
 * screen (`docksOnScreen`): elsewhere it still names the last conversation's.
 */
export function dockWorkspace(): { path: string; machineId: string | null } | null {
  return conversation.workspace === null
    ? null
    : { path: conversation.workspace, machineId: conversation.machineId };
}

/** A rejected working directory (gone, replaced by a file, relative) — see resolveCwd server-side. */
function isBadCwd(err: unknown): boolean {
  return err instanceof HttpStatusError && err.status === 400 && err.message.includes("cwd_not_");
}

/**
 * Starts and selects a shell inside this conversation’s terminal group. Nothing happens
 * without a Session to own it (a draft). The shell starts in the conversation's Workspace, on its
 * machine; a Workspace the server rejects (deleted since, or a path that server cannot see) falls
 * back to home rather than leaving the user with no terminal at all.
 * Failures surface as a toast — with no shell created there is no surface of its own to
 * carry the error, and a swallowed create looks like nothing happened, which is exactly
 * how a server-side spawn failure used to present. Resolves whether a shell started.
 */
export async function createShell(
  group?: SessionWorkbenchScope,
  reuseSession = false,
): Promise<boolean> {
  const sessionId = group?.sessionId ?? dockSessionId();
  if (sessionId === null) return false;
  // The machine is named explicitly: there is no terminal id yet for the routing rule to
  // read, which is the one call in this feature that cannot use it.
  const machine = group ? group.machineId : conversation.machineId;
  const workspace = group ? (group.workspace ?? null) : conversation.workspace;
  const projectId = group?.projectId ?? conversation.projectId;
  if (reuseSession && !projectId) return false;
  const create = (cwd: string): Promise<TerminalInfo> =>
    fetchJson<TerminalInfo>(
      reuseSession && projectId
        ? `/api/terminals/projects/${encodeURIComponent(projectId)}/session-resources/${encodeURIComponent(sessionId)}/open`
        : "/api/terminals",
      {
        method: "POST",
        ...(reuseSession ? {} : { body: JSON.stringify({ cwd, sessionId }) }),
      },
      machine,
    );
  try {
    let created: TerminalInfo;
    try {
      created = await create(workspace ?? HOME_CWD);
    } catch (err) {
      if (reuseSession || workspace === null || !isBadCwd(err)) throw err;
      console.warn(`[terminal] Workspace unusable as cwd, opening in ${HOME_CWD}:`, err);
      // Home is still home ON THAT MACHINE: a Workspace that has gone is no reason to put
      // the shell on a different computer from the conversation it belongs to.
      created = await create(HOME_CWD);
    }
    rememberTerminalMachine(created.id, machine);
    noteTerminalCreated(created);
    // Only into the docks it was asked from: the user may have moved to another conversation
    // while the shell started. It is that conversation's own either way, and its panel lists it.
    setShownShell(created.id, group ? terminalSelectionScope(group) : sessionId);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A 404 here is not "this terminal is gone" — the endpoint itself is absent, which
    // means the server answering is older than the terminal API (the desktop shell also
    // attaches to an already-running server rather than starting its own).
    const detail =
      err instanceof HttpStatusError && err.status === 404 && !message.includes("session_not_found")
        ? `${message} — ${S.terminal.noTerminalApi}`
        : message;
    console.error("[terminal] create failed:", detail);
    toastApiError(err, {
      text: `${S.terminal.createFailed}: ${detail}`,
      what: "a terminal could not be started",
      privatePaths: [workspace ?? HOME_CWD],
    });
    return false;
  } finally {
    void refreshTerminals();
  }
}

/**
 * Puts the terminal panel on screen in `position` (where its tab lives, else the bottom dock).
 * The visible panel attaches to or starts its first shell in this Session.
 */
export function openTerminalPanel(position?: DockPosition): void {
  if (dockSessionId() === null) return;
  openPanel(TERMINAL_PANEL, position, TERMINAL_DOCK);
}

/**
 * A conversation's id self-healed (the server answered with a new one): its shells are
 * refiled under the new id, before its arrangement moves there, so its panel keeps listing
 * them. Best effort per shell — one that cannot be refiled keeps its old owner and leaves the
 * panel, while the shell itself keeps running (reachable on /terminal).
 */
export async function reownTerminals(fromSessionId: string, toSessionId: string): Promise<void> {
  await refreshTerminals();
  const owned = liveTerminals().filter((t) => t.sessionId === fromSessionId);
  await Promise.all(
    owned.map(async (terminal) => {
      try {
        const info = await fetchJson<TerminalInfo>(
          `/api/terminals/${encodeURIComponent(terminal.id)}`,
          { method: "PATCH", body: JSON.stringify({ sessionId: toSessionId }) },
        );
        noteTerminalReowned(terminal.id, info.sessionId ?? toSessionId);
      } catch (err) {
        console.warn(`[terminal] could not refile ${terminal.id}:`, err);
      }
    }),
  );
}

/**
 * The terminal toggle: hide the terminal panel when it is the shown tab, bring it forward when
 * it is behind another or its dock is hidden, and open it when this conversation has none. False
 * when there is nothing to toggle and no Session to open it for (a draft, a page without docks):
 * the key is not taken then.
 */
export function toggleTerminal(): boolean {
  if (togglePanelShown(TERMINAL_PANEL)) return true;
  if (dockSessionId() === null) return false;
  openTerminalPanel();
  return true;
}

// `terminal.toggle` (Ctrl+` on every platform by default — the Codex/VS Code binding),
// registered at module scope: a React-effect registration leaves a window after first paint
// where the shortcut is silently dead — an effect runs after paint, and a keypress can land
// in between. The store is page-global anyway; where no Session is on screen (a draft, the
// login page, /terminal) the toggle declines unless it has tabs to flip. The chord itself is
// the keymap's: the window dispatcher matches it and calls this handler.
onCommand("terminal.toggle", () => {
  if (!toggleTerminal()) return false;
});
// The other dock commands live here for the same reason: the store (dock-state.ts) stays
// free of the dispatcher, and this module is evaluated wherever the docks can appear. Each
// declines on a page without docks (the browser's own key then runs): a toggle there would
// flip nothing visible. A new terminal also declines without a Session to own it (a draft).
onCommand("terminal.new", () => {
  const owner = dockSessionId();
  if (owner === null) return false;
  void createShell().then((created) => {
    if (created && dockSessionId() === owner) openTerminalPanel();
  });
});
onCommand("dock.toggleRight", () => {
  if (!docksOnScreen()) return false;
  toggleDock("right");
});
onCommand("dock.toggleBottom", () => {
  if (!docksOnScreen()) return false;
  toggleDock("bottom");
});
