/**
 * The user's live terminals, as a tiny module-level store. Every shell the user has is in
 * here, tabbed into a dock or not: the docks' strips show the tabbed ones (dock-state.ts),
 * while the toolbar's terminal menu lists all of them, so any shell can be pulled into
 * view here.
 *
 * The server is the source of truth (`GET /api/terminals`, alive only); this store decides
 * *when* to look. There is no push channel for terminal lifecycle yet, so:
 * - every dock lifecycle step that can change the list calls refreshTerminals() directly
 *   (create, reattach, kill, exit);
 * - while anyone is subscribed, a slow poll plus a window-focus refresh catch changes this
 *   tab cannot see (a shell exiting on its own, terminals opened from another window).
 */
import type { TerminalInfo } from "./terminal-view";
import { pruneTerminalTabs } from "../dock/dock-state";
import { apiUrl } from "../../lib/server-context";
import {
  rememberTerminalMachine,
  terminalMachinesPublished,
  terminalSources,
  terminalUrl,
} from "../../lib/terminal-machines";

/**
 * Shell titles usually open with a `user@host` marker (bash and zsh default title
 * strings). The host says nothing useful in a single-server UI and eats the tab's width,
 * so it is dropped at display time only — the stored title stays untouched.
 *
 * The host part must exclude `:` explicitly: in a spaceless title like
 * `user@host:~/work`, a greedy `\S+` would swallow the path along with the host and leave
 * nothing of the title at all.
 */
export function displayTitle(title: string | null | undefined): string {
  return (title ?? "")
    .trim()
    .replace(/^[^@\s]+@[^:\s]+:?\s*/, "")
    .trim();
}

const POLL_MS = 30_000;

/** Raw live list as the server reports it (creation order). */
let raw: TerminalInfo[] = [];
/** Stable snapshot (same reference until contents change) for useSyncExternalStore. */
let terminals: TerminalInfo[] = [];
let fingerprint = "";
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
/** True once the server answered 404 for the terminal API (an older runtime). */
let unsupported = false;

/**
 * Terminals the user just asked to kill, excluded from refresh results while the shell is
 * still winding down (a DELETE only signals; `alive` flips when the pty exits a moment
 * later). Without this, the reconciling refresh would resurrect the tab the user just
 * closed. Entries clear when the server stops listing the id, or after a deadline.
 */
const pendingKills = new Map<string, number>();

function isPendingKill(id: string): boolean {
  const deadline = pendingKills.get(id);
  if (deadline === undefined) return false;
  if (Date.now() > deadline) {
    pendingKills.delete(id);
    return false;
  }
  return true;
}

function commit(next: TerminalInfo[]): void {
  raw = next;
  const nextFingerprint = JSON.stringify(next);
  if (nextFingerprint === fingerprint) return;
  terminals = next;
  fingerprint = nextFingerprint;
  for (const listener of [...listeners]) listener();
}

/** Live title update from the attached client's own xterm (OSC parsed locally). */
export function noteTerminalTitle(id: string, title: string): void {
  if (!raw.some((t) => t.id === id && (t.title ?? "") !== title)) return;
  commit(raw.map((t) => (t.id === id ? { ...t, title } : t)));
}

/** Live terminals, ordered by creation time (the server's list order). */
export function liveTerminals(): TerminalInfo[] {
  return terminals;
}

/** Whether this server serves the terminal API at all (false on an older runtime). */
export function terminalApiSupported(): boolean {
  return !unsupported;
}

/** Re-reads the list from the server; concurrent calls share one request. */
export function refreshTerminals(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      // Every source, this server first: a terminal is a pty on ONE machine's kernel, so
      // the list is not one server's answer. A machine that does not answer contributes
      // nothing and its terminals are simply not listed this round — which is right, since
      // a pane whose bytes cannot arrive is not a pane anyone can use.
      const answers = await Promise.all(
        terminalSources().map(async (source) => {
          const res = await fetch(apiUrl("/api/terminals", source), {
            credentials: "same-origin",
          }).catch(() => null);
          return { source, res };
        }),
      );
      const here = answers.find((a) => a.source === null)?.res ?? null;
      // 404 means the route does not exist at all: the running runtime predates the
      // terminal API. Under hot update the Web App and the runtime can be different
      // versions by design, so the UI has to notice rather than offer a dead control.
      // Asked of THIS server only — a machine on an older build says nothing about the
      // control this page offers.
      if (here?.status === 404 && !unsupported) {
        unsupported = true;
        for (const listener of [...listeners]) listener();
        return;
      }
      if (here === null || !here.ok) return; // signed out or unreachable: keep the last list
      unsupported = false;
      const terminals: TerminalInfo[] = [];
      for (const { source, res } of answers) {
        if (res === null || !res.ok) continue;
        const part = (await res.json()) as { terminals: TerminalInfo[] };
        for (const terminal of part.terminals) {
          terminals.push(terminal);
          // Where it lives, so the two calls about it — attach and kill — reach that
          // machine. Rebuilt by the very list that displays them.
          rememberTerminalMachine(terminal.id, source);
        }
      }
      const listed = new Set(terminals.map((t) => t.id));
      for (const id of pendingKills.keys()) {
        if (!listed.has(id)) pendingKills.delete(id); // fully gone: nothing left to hide
      }
      const live = terminals.filter((t) => t.alive && !isPendingKill(t.id));
      // Pruning is the one thing here that DESTROYS something: it drops terminal tabs out
      // of every conversation's stored arrangement. So it may only act on a complete
      // picture — every source answered, and the machine set already published. Neither
      // holds on a fresh page: the machines are published once the machine list has been
      // read, and a connection the server is still re-holding after a restart answers
      // nothing yet, so an early refresh sees this server alone. Pruning on that would
      // delete the tabs of terminals that are alive on a machine, and storage does not get
      // them back. Displaying the short list meanwhile is fine — a pane whose bytes cannot
      // arrive is not usable yet, but it is not gone either, and the next complete refresh
      // restores it.
      if (terminalMachinesPublished() && answers.every((a) => a.res !== null && a.res.ok)) {
        pruneTerminalTabs(new Set(live.map((t) => t.id)));
      }
      commit(live);
    } catch {
      // Network hiccup: the next poll/focus refresh will catch up.
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

const onFocus = (): void => void refreshTerminals();

export function subscribeTerminals(listener: () => void): () => void {
  if (listeners.size === 0) {
    void refreshTerminals();
    pollTimer = setInterval(() => void refreshTerminals(), POLL_MS);
    window.addEventListener("focus", onFocus);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
      window.removeEventListener("focus", onFocus);
    }
  };
}

/**
 * A terminal the user just created (the POST response in hand): into the list right away,
 * so the count/tabs react to the user's own action instantly rather than after a re-fetch.
 */
export function noteTerminalCreated(info: TerminalInfo): void {
  if (raw.some((t) => t.id === info.id)) return;
  commit([...raw, info]);
}

/**
 * Kills a terminal. Optimistic: the user's intent is immediate, so the entry leaves the
 * list (count, tabs, badge) before the server round-trip; delayed refreshes reconcile once
 * the pty has actually exited, with `pendingKills` keeping the dying shell from
 * reappearing in between.
 */
export async function killTerminal(id: string): Promise<void> {
  pendingKills.set(id, Date.now() + 10_000);
  commit(raw.filter((t) => t.id !== id));
  try {
    await fetch(terminalUrl(`/api/terminals/${encodeURIComponent(id)}`), {
      method: "DELETE",
      credentials: "same-origin",
    });
  } catch {
    // The delayed refreshes below still reconcile with whatever the server thinks.
  }
  for (const delay of [300, 1500]) {
    setTimeout(() => void refreshTerminals(), delay);
  }
}
