/**
 * In-app terminal dock (Codex-style integrated terminal): a panel across the bottom of the
 * main content column, toggled by Ctrl+` or the sidebar's terminal entry, present on every
 * page because it mounts in AppLayout.
 *
 * The shell is the same server-side terminal the standalone page uses, so:
 * - closing the dock only hides the view; the shell (and anything running in it) stays up,
 *   and reopening the dock reattaches to it;
 * - "Detach" hands the terminal off to its own window — it opens `/terminal?id=<id>` and
 *   forgets the id locally, so the dock's next shell is a fresh one and exactly one surface
 *   owns any given terminal (the Codex handoff behaviour);
 * - a reload restores both the dock (open state persists) and the shell (id persists).
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
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

const DOCK_ID_KEY = "penguin.terminal.dock.id";
/** The dock always opens in the home directory (project-scoped cwd can come later). */
const DOCK_CWD = "~";

export function useTerminalDockOpen(): boolean {
  return useSyncExternalStore(subscribeTerminalDock, isTerminalDockOpen);
}

/** Reattaches to the dock's stored terminal when it is still alive, else creates a new one. */
async function ensureDockTerminal(cols: number, rows: number): Promise<TerminalInfo> {
  const storedId = localStorage.getItem(DOCK_ID_KEY);
  if (storedId) {
    const existing = await fetchJson<TerminalInfo>(`/api/terminals/${storedId}`).catch(() => null);
    if (existing?.alive) return existing;
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
  }, []);

  /** Fresh shell for the dock; the old one (if alive) is deliberately left running. */
  const newShell = useCallback(() => {
    localStorage.removeItem(DOCK_ID_KEY);
    setStatus("connecting");
    setDetail("");
    setInfo(null);
    setGeneration((n) => n + 1);
  }, []);

  /** Codex-style detach: hand the terminal to its own window and let the dock forget it. */
  const detach = useCallback(() => {
    const id = info?.id ?? localStorage.getItem(DOCK_ID_KEY);
    if (!id) return;
    window.open(`/terminal?id=${encodeURIComponent(id)}`, "_blank", "noopener");
    localStorage.removeItem(DOCK_ID_KEY);
    setInfo(null);
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
        ensure={ensureDockTerminal}
        onStatus={onStatus}
        onInfo={setInfo}
        className="min-h-0 flex-1 overflow-hidden px-2 py-1"
      />
    </div>
  );
}
