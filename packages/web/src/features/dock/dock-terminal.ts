/**
 * The dock's terminal-side helpers: creating/adopting shells for terminal tabs, and the
 * global Ctrl+` hotkey. Split from dock-state.ts so the store stays pure (unit-testable
 * without fetch); this module owns every server round-trip a terminal tab needs.
 */
import { S } from "../../lib/strings";
import { toastError } from "../../components/ui/toast";
import {
  HttpStatusError,
  fetchJson,
  probeJson,
  type TerminalInfo,
} from "../terminal/terminal-view";
import { liveTerminals, noteTerminalCreated, refreshTerminals } from "../terminal/terminal-list";
import {
  addTerminalTab,
  currentDockScope,
  removeTab,
  restoreTerminalTab,
  showTerminal,
  toggleTerminalDocks,
  unownedTerminals,
  type DockPosition,
} from "./dock-state";

/** Where a new shell starts when no Workspace is known: the user's home directory. */
const HOME_CWD = "~";

/**
 * The Workspace a new shell should start in — the conversation's own directory, which is
 * where its files are and what the agent has been working in. Published by the surface
 * that knows it (the chat page for a Session, the draft page for the Workspace picked
 * there) rather than read from a store, because the Ctrl+` hotkey creates shells from a
 * module-scope listener with no React context to consult. Null = none known; the shell
 * falls back to home.
 */
let workspaceCwd: string | null = null;

/** Points new shells at this absolute Workspace path; null restores the home default. */
export function setDockCwd(path: string | null): void {
  workspaceCwd = path !== null && path.trim() !== "" ? path : null;
}

/** A rejected working directory (gone, replaced by a file, relative) — see resolveCwd server-side. */
function isBadCwd(err: unknown): boolean {
  return err instanceof HttpStatusError && err.status === 400 && err.message.includes("cwd_not_");
}

/**
 * Creates a fresh shell and tabs it into `position` (the bottom dock by default). The
 * shell starts in the current Workspace; a Workspace the server rejects (deleted since,
 * or a path this server cannot see) falls back to home rather than leaving the user with
 * no terminal at all.
 * Failures surface as a toast — with no tab created there is no surface of its own to
 * carry the error, and a swallowed create looks like nothing happened, which is exactly
 * how a server-side spawn failure used to present.
 */
export async function createShellInDock(position?: DockPosition): Promise<void> {
  const create = (cwd: string): Promise<TerminalInfo> =>
    fetchJson<TerminalInfo>("/api/terminals", { method: "POST", body: JSON.stringify({ cwd }) });
  try {
    let created: TerminalInfo;
    try {
      created = await create(workspaceCwd ?? HOME_CWD);
    } catch (err) {
      if (workspaceCwd === null || !isBadCwd(err)) throw err;
      console.warn(`[terminal] Workspace unusable as cwd, opening in ${HOME_CWD}:`, err);
      created = await create(HOME_CWD);
    }
    noteTerminalCreated(created);
    addTerminalTab(created.id, position);
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
 * Puts a terminal on screen in `position` (or the bottom dock): the newest live shell no
 * conversation holds is adopted — one started through the API or the CLI, or whose tab
 * was closed — rather than answered with a second shell running beside it; only when
 * every live shell is already tabbed somewhere (or none exists) is a new one created.
 */
export async function openTerminalInDock(position?: DockPosition): Promise<void> {
  const listed = await fetchJson<{ terminals: TerminalInfo[] }>("/api/terminals").catch(() => null);
  const live = (listed?.terminals ?? liveTerminals()).filter((t) => t.alive);
  const adoptable = unownedTerminals(live.map((t) => t.id)).at(-1);
  if (adoptable !== undefined) {
    addTerminalTab(adoptable, position);
    void refreshTerminals();
    return;
  }
  await createShellInDock(position);
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
  const popup = window.open(`/terminal?id=${encodeURIComponent(id)}`, "_blank");
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
 * Ctrl+`: hide the shown terminals, or bring them back — and with no terminal tab in
 * this conversation, adopt or create a shell (the async tail the store's synchronous
 * toggle hands off).
 */
export function toggleTerminal(): void {
  if (!toggleTerminalDocks()) void openTerminalInDock();
}

/** Re-exported for callers that already know which shell they want on screen. */
export { showTerminal };

// Ctrl+` (the Codex/VS Code binding), registered at module scope: a React-effect listener
// leaves a window after first paint where the shortcut is silently dead — an effect runs
// after paint, and a keypress can land in between. The store is page-global anyway; on
// routes without the docks (login, /terminal) the toggle just flips hidden state.
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (event) => {
    if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (event.key !== "`" && event.code !== "Backquote") return;
    event.preventDefault();
    toggleTerminal();
  });
}
