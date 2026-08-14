/**
 * In-app terminal dock (Codex-style integrated terminal): a panel across the bottom of the
 * main content column, toggled by Ctrl+` or the sidebar's terminal entry, present on every
 * page because it mounts in AppLayout.
 *
 * The shell is the same server-side terminal the standalone page uses, and opening the
 * dock always lands on a live shell (the persistence rules):
 * - the terminal opened last time (stored id) when it is still alive;
 * - otherwise the newest of the user's live terminals — created anywhere: the /terminal
 *   page, a detached window, the API;
 * - otherwise a fresh shell is created (and kept: closing the dock only hides the view).
 * "Detach" opens `/terminal?id=<id>` in its own window; the terminal stays the user's most
 * recent one, so reopening the dock shows that same shell again (multi-client attach).
 * A reload restores both the dock (open state persists) and the shell (id persists).
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { S } from "../../lib/strings";
import {
  isTerminalDockOpen,
  setTerminalDockOpen,
  subscribeTerminalDock,
  toggleTerminalDock,
} from "./terminal-dock-state";
import {
  TerminalView,
  fetchJson,
  type TerminalInfo,
  type TerminalStatus,
} from "./terminal-view";
import { refreshTerminalCount } from "./terminal-count";

const DOCK_ID_KEY = "penguin.terminal.dock.id";
/** The dock always opens in the home directory (project-scoped cwd can come later). */
const DOCK_CWD = "~";

export function useTerminalDockOpen(): boolean {
  return useSyncExternalStore(subscribeTerminalDock, isTerminalDockOpen);
}

/**
 * Resolves the terminal the dock should show: last opened (stored id) if still alive, else
 * the newest live terminal from anywhere, else a fresh one. Only the last case creates —
 * unless `forceCreate` ("New shell"), which skips the reattach paths entirely (they would
 * otherwise just hand back the shell the user asked to leave).
 */
async function ensureDockTerminal(
  cols: number,
  rows: number,
  forceCreate: boolean,
): Promise<TerminalInfo> {
  if (!forceCreate) {
    const storedId = localStorage.getItem(DOCK_ID_KEY);
    if (storedId) {
      const existing = await fetchJson<TerminalInfo>(`/api/terminals/${storedId}`).catch(
        () => null,
      );
      if (existing?.alive) return existing;
    }

    // No usable stored id: fall back to the newest live terminal (the list is ordered by
    // createdAt ascending), wherever it was opened from.
    const listed = await fetchJson<{ terminals: TerminalInfo[] }>("/api/terminals").catch(
      () => null,
    );
    const alive = (listed?.terminals ?? []).filter((t) => t.alive);
    const latest = alive.at(-1);
    if (latest) {
      localStorage.setItem(DOCK_ID_KEY, latest.id);
      return latest;
    }
  }

  const created = await fetchJson<TerminalInfo>("/api/terminals", {
    method: "POST",
    body: JSON.stringify({ cwd: DOCK_CWD, cols, rows }),
  });
  if (!created) throw new Error("Server did not return a terminal.");
  localStorage.setItem(DOCK_ID_KEY, created.id);
  return created;
}

/** Small icon-sized header button shared by the dock's controls. */
function DockButton(props: { label: string; testId: string; onClick: () => void; d: string }) {
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      data-testid={props.testId}
      onClick={props.onClick}
      className="flex h-6 w-6 items-center justify-center rounded text-white/60 transition-colors duration-150 hover:bg-white/10 hover:text-white"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d={props.d} />
      </svg>
    </button>
  );
}

export function TerminalDock() {
  const open = useTerminalDockOpen();
  const [status, setStatus] = useState<TerminalStatus>("connecting");
  const [detail, setDetail] = useState("");
  const [info, setInfo] = useState<TerminalInfo | null>(null);
  const [generation, setGeneration] = useState(0);
  /** Armed by "New shell" for exactly the next attach; consumed inside ensure. */
  const forceCreateRef = useRef(false);

  const ensure = useCallback(async (cols: number, rows: number): Promise<TerminalInfo> => {
    const forceCreate = forceCreateRef.current;
    forceCreateRef.current = false;
    return ensureDockTerminal(cols, rows, forceCreate);
  }, []);

  // Ctrl+` toggles the dock from anywhere in the app (the Codex/VS Code binding). Bound
  // here so it exists exactly once, dock visible or not.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (event.key !== "`" && event.code !== "Backquote") return;
      event.preventDefault();
      toggleTerminalDock();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const onStatus = useCallback((next: TerminalStatus, statusDetail: string) => {
    setStatus(next);
    setDetail(statusDetail);
    // A shell exiting under the dock changes the live count the badge shows.
    if (next === "exited") void refreshTerminalCount();
  }, []);

  const onInfo = useCallback((next: TerminalInfo) => {
    setInfo(next);
    // Attaching may have created a terminal; either way the badge re-syncs.
    void refreshTerminalCount();
  }, []);

  /** Fresh shell for the dock; the old one (if alive) is deliberately left running. */
  const newShell = useCallback(() => {
    localStorage.removeItem(DOCK_ID_KEY);
    forceCreateRef.current = true;
    setStatus("connecting");
    setDetail("");
    setInfo(null);
    setGeneration((n) => n + 1);
  }, []);

  /**
   * Codex-style detach: hand the terminal to its own window. The stored id is kept — it is
   * still the last-opened terminal, so reopening the dock shows this same shell (the
   * stream supports multiple attached clients).
   */
  const detach = useCallback(() => {
    const id = info?.id ?? localStorage.getItem(DOCK_ID_KEY);
    if (!id) return;
    window.open(`/terminal?id=${encodeURIComponent(id)}`, "_blank", "noopener");
    setTerminalDockOpen(false);
  }, [info]);

  if (!open) return null;

  const statusText =
    status === "exited" && detail
      ? `${S.terminal.status.exited} — ${S.terminal.exitedWithCode(detail)}`
      : `${S.terminal.status[status]}${status === "error" && detail ? ` — ${detail}` : ""}`;

  return (
    <div
      data-testid="terminal-dock"
      className="flex h-72 shrink-0 flex-col border-t border-gray-200 bg-[#14171a] text-[#e6e6e6] dark:border-gray-800"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-3 py-1.5 text-xs">
        <span className="font-medium">{S.terminal.title}</span>
        <span className="max-w-64 truncate text-white/45">{info?.cwd ?? ""}</span>
        <span
          data-testid="terminal-dock-status"
          data-status={status}
          className={
            status === "ready"
              ? "text-emerald-400"
              : status === "connecting"
                ? "text-amber-400"
                : "text-red-400"
          }
        >
          ● {statusText}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {/* New shell: plus */}
          <DockButton
            label={S.terminal.newShell}
            testId="terminal-dock-new-shell"
            onClick={newShell}
            d="M12 5v14M5 12h14"
          />
          {/* Detach: box with an arrow escaping to the top right */}
          <DockButton
            label={S.terminal.detach}
            testId="terminal-dock-detach"
            onClick={detach}
            d="M14 4h6v6M20 4l-8 8M10 6H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"
          />
          {/* Close: X (hides the dock; the shell keeps running server-side) */}
          <DockButton
            label={S.terminal.close}
            testId="terminal-dock-close"
            onClick={() => setTerminalDockOpen(false)}
            d="M6 6l12 12M18 6L6 18"
          />
        </div>
      </header>
      <TerminalView
        key={generation}
        ensure={ensure}
        onStatus={onStatus}
        onInfo={onInfo}
        className="min-h-0 flex-1 overflow-hidden px-2 py-1"
      />
    </div>
  );
}
