/**
 * Standalone terminal page (`/terminal`): a full-window terminal outside the app shell.
 * This is where the in-app dock "detach"es to (Codex-style), and it is deep-linkable:
 *
 *   /terminal                 reattach to this page's last terminal, else create one in `~`
 *   /terminal?id=<id>         attach exactly that terminal (the detach handoff)
 *   /terminal?cwd=/some/dir   create the terminal in that directory
 *   /terminal?name=<name>     display/session name for a newly created terminal
 *   /terminal?machine=<id>    the machine the pty is on (absent = this server)
 *
 * Once a terminal is attached, its id is written back into the URL (replaceState, no
 * navigation), so a reload — or copying the address to another window — reattaches to the
 * same shell. The server answers reattach with a Restore frame that repaints the entire
 * screen (scrollback, colours, cursor, input modes); the shell itself never notices.
 *
 * When `?id=` points at a terminal that no longer exists (server restart, reaped after
 * exit), a fresh shell is created with the URL's cwd/name — the page always ends in a
 * usable terminal rather than a dead end.
 */
import { useCallback, useMemo, useState } from "react";
import { S } from "../../lib/strings";
import { useTerminalChrome } from "./terminal-appearance";
import {
  TerminalView,
  fetchJson,
  probeJson,
  type TerminalInfo,
  type TerminalStatus,
} from "./terminal-view";
import { rememberTerminalMachine } from "../../lib/terminal-machines";

const STORAGE_KEY = "penguin.terminal.page.id";

export interface TerminalPageParams {
  id: string | null;
  cwd: string;
  name: string | null;
  /**
   * The machine the terminal is (or should be) on. In the URL because this page is opened
   * in a NEW window: nothing in it has seen a terminal list yet, so the in-memory map that
   * addresses every other terminal call is empty here and the URL is the only thing that
   * can say where the pty lives.
   */
  machine: string | null;
}

/** Parses the /terminal search string into attach parameters (exported for tests). */
export function parseTerminalParams(search: string): TerminalPageParams {
  const params = new URLSearchParams(search);
  const id = params.get("id");
  const cwd = params.get("cwd");
  const name = params.get("name");
  const machine = params.get("machine");
  return {
    id: id && id.trim() ? id.trim() : null,
    cwd: cwd && cwd.trim() ? cwd.trim() : "~",
    name: name && name.trim() ? name.trim() : null,
    machine: machine && machine.trim() ? machine.trim() : null,
  };
}

/** Rewrites `?id=` in place (keeping cwd/name so "new shell" can recreate alike). */
function writeIdToUrl(id: string): void {
  const url = new URL(location.href);
  url.searchParams.set("id", id);
  history.replaceState(null, "", url);
}

async function attachOrCreate(
  params: TerminalPageParams,
  cols: number,
  rows: number,
): Promise<TerminalInfo> {
  // 1. An explicit id wins — this is the detach handoff. A dead-but-not-yet-reaped
  //    terminal is still returned so the user sees its final screen and exit status.
  if (params.id) {
    // Seeded before the probe, so this and every later call about it — attach, resize,
    // kill — address the machine that holds it.
    rememberTerminalMachine(params.id, params.machine);
    const existing = await probeJson<TerminalInfo>(`/api/terminals/${params.id}`).catch(() => null);
    if (existing) return existing;
  } else {
    // 2. Bare visit: reattach to this page's previous terminal when it is still alive.
    const storedId = localStorage.getItem(STORAGE_KEY);
    if (storedId) {
      rememberTerminalMachine(storedId, params.machine);
      const stored = await probeJson<TerminalInfo>(`/api/terminals/${storedId}`).catch(() => null);
      if (stored?.alive) return stored;
    }
  }

  // 3. Create afresh from the URL's cwd/name — on the machine the cwd is a path ON.
  const created = await fetchJson<TerminalInfo>(
    "/api/terminals",
    {
      method: "POST",
      body: JSON.stringify({
        cwd: params.cwd,
        cols,
        rows,
        ...(params.name !== null ? { name: params.name } : {}),
      }),
    },
    params.machine,
  );
  rememberTerminalMachine(created.id, params.machine);
  return created;
}

export function TerminalPage() {
  const chrome = useTerminalChrome();
  const [status, setStatus] = useState<TerminalStatus>("connecting");
  const [detail, setDetail] = useState<string>("");
  const [info, setInfo] = useState<TerminalInfo | null>(null);
  const [generation, setGeneration] = useState(0);

  // window.location, not useLocation(): the id is written back with history.replaceState,
  // which the router never observes — its location object would go stale after the first
  // attach. Re-read on each restart (generation bump).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const params = useMemo(() => parseTerminalParams(window.location.search), [generation]);

  const ensure = useCallback(
    async (cols: number, rows: number): Promise<TerminalInfo> => {
      const terminal = await attachOrCreate(
        parseTerminalParams(window.location.search),
        cols,
        rows,
      );
      localStorage.setItem(STORAGE_KEY, terminal.id);
      writeIdToUrl(terminal.id);
      return terminal;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [generation],
  );

  /** "New shell": drop the current session and recreate from cwd/name (id removed). */
  const restart = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    const url = new URL(location.href);
    url.searchParams.delete("id");
    history.replaceState(null, "", url);
    setStatus("connecting");
    setDetail("");
    setInfo(null);
    setGeneration((n) => n + 1);
  }, []);

  const onStatus = useCallback((next: TerminalStatus, statusDetail: string) => {
    setStatus(next);
    setDetail(statusDetail);
  }, []);

  const statusText =
    status === "exited" && detail
      ? `${S.terminal.status.exited} — ${S.terminal.exitedWithCode(detail)}`
      : `${S.terminal.status[status]}${status === "error" && detail ? ` — ${detail}` : ""}`;

  return (
    <div className={`flex h-screen w-screen flex-col ${chrome.surface}`}>
      <header
        className={`flex shrink-0 items-center gap-3 border-b px-4 py-2 text-xs ${chrome.border}`}
      >
        <span className="font-medium">{S.terminal.title}</span>
        <span className={chrome.muted}>{info?.cwd ?? params.cwd}</span>
        <span
          data-testid="terminal-status"
          data-status={status}
          className={
            status === "ready"
              ? chrome.success
              : status === "connecting"
                ? chrome.attention
                : chrome.danger
          }
        >
          ● {statusText}
        </span>
        <button
          type="button"
          data-testid="terminal-new-shell"
          onClick={restart}
          className={`ml-auto rounded border px-2 py-1 ${chrome.outlineButton}`}
        >
          {S.terminal.newShell}
        </button>
      </header>
      <TerminalView
        key={generation}
        ensure={ensure}
        onStatus={onStatus}
        onInfo={setInfo}
        className="min-h-0 flex-1 overflow-hidden px-2 py-1"
      />
    </div>
  );
}
