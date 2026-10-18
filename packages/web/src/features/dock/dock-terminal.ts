/**
 * The dock's terminal-side helpers: creating shells for terminal tabs, bringing back a
 * conversation's own shells, and the global `terminal.*` commands. Split from dock-state.ts so
 * the store stays pure (unit-testable without fetch); this module owns every server round-trip a
 * terminal tab needs.
 *
 * A shell belongs to the Session that created it (the server records `sessionId`): a
 * conversation creates its shells with its own id, and lists and opens only those. A draft has
 * no Session yet, so it has no terminal at all until its first send.
 */
import { useSyncExternalStore } from "react";
import { toastError } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { onCommand } from "../../lib/shortcuts/dispatcher";
import {
  HttpStatusError,
  fetchJson,
  probeJson,
  type TerminalInfo,
} from "../terminal/terminal-view";
import {
  liveTerminals,
  noteTerminalCreated,
  noteTerminalReowned,
  refreshTerminals,
  terminalsOf,
} from "../terminal/terminal-list";
import { machineForTerminal, rememberTerminalMachine } from "../../lib/terminal-machines";
import {
  addTerminalTab,
  currentDockScope,
  docksOnScreen,
  removeTab,
  restoreTerminalTab,
  showTerminal,
  subscribeDock,
  terminalTabDock,
  toggleDock,
  toggleTerminalDocks,
  type DockPosition,
} from "./dock-state";

/** Where a new shell starts when no Workspace is known: the user's home directory. */
const HOME_CWD = "~";

/**
 * The conversation the page's docks belong to, as the surface that knows it publishes it (the
 * chat page for a Session, the draft page for the Workspace picked there) rather than read from
 * a store, because the terminal commands run from module-scope handlers with no React context to
 * consult.
 */
export interface DockConversation {
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
    next.sessionId === conversation.sessionId &&
    workspace === conversation.workspace &&
    next.machineId === conversation.machineId
  )
    return;
  conversation = { sessionId: next.sessionId, workspace, machineId: next.machineId };
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

/** This conversation's live shells with no tab in its docks (the "+" menu's small rows). */
export function untabbedTerminals(sessionId: string): TerminalInfo[] {
  return terminalsOf(sessionId, conversation.machineId).filter(
    (t) => terminalTabDock(t.id) === null,
  );
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
 * Creates a fresh shell for this conversation and tabs it into `position` (the bottom dock by
 * default). Nothing happens without a Session to own it (a draft). The shell starts in the
 * conversation's Workspace, on its machine; a Workspace the server rejects (deleted since, or a
 * path that server cannot see) falls back to home rather than leaving the user with no terminal
 * at all.
 * Failures surface as a toast — with no tab created there is no surface of its own to
 * carry the error, and a swallowed create looks like nothing happened, which is exactly
 * how a server-side spawn failure used to present.
 */
export async function createShellInDock(position?: DockPosition): Promise<void> {
  const sessionId = dockSessionId();
  if (sessionId === null) return;
  // The machine is named explicitly: there is no terminal id yet for the routing rule to
  // read, which is the one call in this feature that cannot use it.
  const { workspace, machineId: machine } = conversation;
  const create = (cwd: string): Promise<TerminalInfo> =>
    fetchJson<TerminalInfo>(
      "/api/terminals",
      { method: "POST", body: JSON.stringify({ cwd, sessionId }) },
      machine,
    );
  try {
    let created: TerminalInfo;
    try {
      created = await create(workspace ?? HOME_CWD);
    } catch (err) {
      if (workspace === null || !isBadCwd(err)) throw err;
      console.warn(`[terminal] Workspace unusable as cwd, opening in ${HOME_CWD}:`, err);
      // Home is still home ON THAT MACHINE: a Workspace that has gone is no reason to put
      // the shell on a different computer from the conversation it belongs to.
      created = await create(HOME_CWD);
    }
    rememberTerminalMachine(created.id, machine);
    noteTerminalCreated(created);
    // Only into the docks it was asked from: the user may have moved to another conversation
    // while the shell started. It is that conversation's own either way, and its "+" menu
    // offers it there.
    if (currentDockScope() === sessionId) addTerminalTab(created.id, position);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A 404 here is not "this terminal is gone" — the endpoint itself is absent, which
    // means the server answering is older than the terminal API (the desktop shell also
    // attaches to an already-running server rather than starting its own).
    const detail =
      err instanceof HttpStatusError && err.status === 404
        ? `${message} — ${S.terminal.noTerminalApi}`
        : message;
    console.error("[terminal] create failed:", detail);
    toastError(`${S.terminal.createFailed}: ${detail}`);
  } finally {
    void refreshTerminals();
  }
}

/**
 * Puts a terminal on screen in `position` (or the bottom dock): the newest of this
 * conversation's live shells that has no tab here — one opened on another device or in another
 * browser — rather than a second shell beside it; only when there is none is a new one created.
 * Another Session's shell is never taken, whatever its state.
 */
export async function openTerminalInDock(position?: DockPosition): Promise<void> {
  const sessionId = dockSessionId();
  if (sessionId === null) return;
  // Through the list, not a bare fetch of this server's collection: a terminal is a pty on
  // ONE machine, and `/api/terminals` asked without a machine answers for this one alone —
  // so a conversation on a machine would never find the shell it already has there.
  await refreshTerminals();
  if (dockSessionId() !== sessionId) return; // the user moved on while the list loaded
  const newest = untabbedTerminals(sessionId).at(-1);
  if (newest !== undefined) {
    addTerminalTab(newest.id, position);
    return;
  }
  await createShellInDock(position);
}

/**
 * A conversation's id self-healed (the server answered with a new one): its shells are
 * refiled under the new id, before its arrangement moves there, so its tabs stay its own.
 * Best effort per shell — one that cannot be refiled keeps its old owner and its tab is
 * dropped on the next prune, while the shell itself keeps running.
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
 * Detach a terminal to its own /terminal window, and RETURN it when that window closes:
 * the tab leaves the strip while the shell lives in the window, and closing the window
 * puts the tab back into the conversation and dock it left — even if the user is looking
 * at another conversation by then. There is no cross-window close event, so a slow poll
 * on the handle's `closed` flag watches for it; the restore is skipped when the shell
 * ended inside the window or the user already pulled it back in through a "+" menu.
 * (The handle is why the window is NOT opened with "noopener" — window.open would then
 * return null; the target is this same app's own page.)
 */
export function detachTerminal(id: string, position: DockPosition): void {
  const fromScope = currentDockScope();
  // The machine travels in the URL: the new window starts with an empty terminal map, so
  // without it a detached remote pane would try to attach to a pty on the wrong computer.
  const machine = machineForTerminal(id);
  const popup = window.open(
    `/terminal?id=${encodeURIComponent(id)}` +
      (machine === null ? "" : `&machine=${encodeURIComponent(machine)}`),
    "_blank",
  );
  removeTab(`terminal:${id}`);
  if (!popup) return; // blocked popup: the shell stays reachable from the "+" menus
  const timer = window.setInterval(() => {
    if (!popup.closed) return;
    window.clearInterval(timer);
    void (async () => {
      const info = await probeJson<TerminalInfo>(`/api/terminals/${encodeURIComponent(id)}`).catch(
        () => null,
      );
      if (info?.alive !== true) return; // the shell ended in the window: nothing to restore
      restoreTerminalTab(fromScope, id, position);
      void refreshTerminals();
    })();
  }, 600);
}

/**
 * The terminal toggle: hide the shown terminals, or bring them back — and with no terminal
 * tab in this conversation, bring back or create one of its shells (the async tail the
 * store's synchronous toggle hands off). False when there is nothing to toggle and no
 * Session to open a shell for (a draft, a page without docks): the key is not taken then.
 */
export function toggleTerminal(): boolean {
  if (toggleTerminalDocks()) return true;
  if (dockSessionId() === null) return false;
  void openTerminalInDock();
  return true;
}

/** Re-exported for callers that already know which shell they want on screen. */
export { showTerminal };

// `terminal.toggle` (Ctrl+` on every platform by default — the Codex/VS Code binding),
// registered at module scope: a React-effect registration leaves a window after first paint
// where the shortcut is silently dead — an effect runs after paint, and a keypress can land
// in between. The store is page-global anyway; where no Session is on screen (a draft, the
// login page, /terminal) the toggle declines unless it has tabs to flip. The chord itself is
// the keymap's: the window dispatcher matches it and calls this handler.
onCommand("terminal.toggle", toggleTerminal);
// The other dock commands live here for the same reason: the store (dock-state.ts) stays
// free of the dispatcher, and this module is evaluated wherever the docks can appear. Each
// declines on a page without docks (the browser's own key then runs): a toggle there would
// flip nothing visible. A new terminal also declines without a Session to own it (a draft).
onCommand("terminal.new", () => {
  if (dockSessionId() === null) return false;
  void createShellInDock();
});
onCommand("dock.toggleRight", () => {
  if (!docksOnScreen()) return false;
  toggleDock("right");
});
onCommand("dock.toggleBottom", () => {
  if (!docksOnScreen()) return false;
  toggleDock("bottom");
});
