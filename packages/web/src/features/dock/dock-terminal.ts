/**
 * The dock's terminal-side helpers: creating/adopting shells for terminal tabs, and the
 * global Ctrl+` hotkey. Split from dock-state.ts so the store stays pure (unit-testable
 * without fetch); this module owns every server round-trip a terminal tab needs.
 */
import { S } from "../../lib/strings";
import { toastError } from "../../components/ui/toast";
import { HttpStatusError, fetchJson, type TerminalInfo } from "../terminal/terminal-view";
import { liveTerminals, noteTerminalCreated, refreshTerminals } from "../terminal/terminal-list";
import {
  addTerminalTab,
  showTerminal,
  toggleTerminalDocks,
  unownedTerminals,
  type DockPosition,
} from "./dock-state";

/** The dock always opens new shells in the home directory (project cwd can come later). */
const DOCK_CWD = "~";

/**
 * Creates a fresh shell and tabs it into `position` (the bottom dock by default).
 * Failures surface as a toast — with no tab created there is no surface of its own to
 * carry the error, and a swallowed create looks like nothing happened, which is exactly
 * how a server-side spawn failure used to present.
 */
export async function createShellInDock(position?: DockPosition): Promise<void> {
  try {
    const created = await fetchJson<TerminalInfo>("/api/terminals", {
      method: "POST",
      body: JSON.stringify({ cwd: DOCK_CWD }),
    });
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
