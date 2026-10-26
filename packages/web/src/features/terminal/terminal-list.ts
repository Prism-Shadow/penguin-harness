/**
 * The user's live terminals, as a tiny module-level store. Every shell the user has is in
 * here, each filed under the conversation that opened it (`sessionId`): a conversation's
 * terminal panel lists exactly its own (terminalsOf) — never another conversation's, machine's
 * or Project's.
 *
 * The server is the source of truth (`GET /api/terminals`, alive only); this store decides
 * *when* to look. There is no push channel for terminal lifecycle yet, so:
 * - every dock lifecycle step that can change the list calls refreshTerminals() directly
 *   (create, reattach, kill, exit);
 * - while anyone is subscribed, a slow poll plus a window-focus refresh catch changes this
 *   tab cannot see (a shell exiting on its own, terminals opened from another window).
 */
import type { TerminalInfo } from "./terminal-view";
import { probeSession } from "../../api/session-probe";
import { ANSWER_TIMEOUT_MS } from "../../api/socket";
import { apiUrl } from "../../lib/server-context";
import {
  machineForTerminal,
  rememberTerminalMachine,
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
/**
 * Bumped by every change this window makes to the list itself — a shell it created, a shell it
 * refiled under another conversation. A list fetched across such a change misses or misfiles
 * that shell, so it is neither shown nor allowed to prune: it would drop the very tab the change
 * just made (see refreshTerminals).
 */
let localChanges = 0;
/** Stable snapshot (same reference until contents change) for useSyncExternalStore. */
let terminals: TerminalInfo[] = [];
let fingerprint = "";
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
/** Listeners that only hear changes and start no polling of their own (watchTerminals). */
const watchers = new Set<() => void>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
/** True once the server answered 404 for the terminal API (an older runtime). */
let unsupported = false;
/**
 * Whether the list on hand is every source's answer. A machine that did not answer one round
 * (a connection being re-held) leaves its shells out of it, which is not their end.
 */
let complete = false;

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
  notify();
}

function notify(): void {
  for (const listener of [...listeners, ...watchers]) listener();
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

/**
 * A conversation's own live shells, on the machine it runs on, in creation order. Only an owner
 * the server named counts: a shell from a server that reports none (an older build on a
 * machine) belongs to no conversation's list until that server is updated.
 */
export function terminalsOf(sessionId: string, machineId: string | null): TerminalInfo[] {
  return terminals.filter(
    (t) => t.alive && t.sessionId === sessionId && machineForTerminal(t.id) === machineId,
  );
}

/**
 * Whether the last list read heard from every source, so a shell missing from it has really
 * gone — what the terminal panel waits for before it closes over a last shell that ended.
 */
export function terminalListComplete(): boolean {
  return complete;
}

/** Whether this server serves the terminal API at all (false on an older runtime). */
export function terminalApiSupported(): boolean {
  return !unsupported;
}

/**
 * How long a machine's list is waited for. A machine that holds its connection but answers
 * nothing would otherwise hold its round — and every refresh after it, which shares the one in
 * flight — until ssh gives the connection up; its shells are left out of that round instead, as
 * an unreachable machine's are. The API socket's own wait for an answer.
 */
const MACHINE_LIST_TIMEOUT_MS = ANSWER_TIMEOUT_MS;

/** Re-reads the list from the server; concurrent calls share one request. */
export function refreshTerminals(): Promise<void> {
  if (inflight) return inflight;
  const changesAtStart = localChanges;
  let stale = false;
  inflight = (async () => {
    try {
      // Every source, this server first: a terminal is a pty on ONE machine's kernel, so
      // the list is not one server's answer. A machine that does not answer contributes
      // nothing and its terminals are simply not listed this round — which is right, since
      // a pane whose bytes cannot arrive is not a pane anyone can use.
      const sources = terminalSources();
      /** Each source's answer as it lands: its shells, or null when it did not answer. */
      const parts = new Map<string | null, { terminals: TerminalInfo[] } | null>();
      const ask = async (source: string | null) => {
        const giveUp = new AbortController();
        const timer =
          source === null ? null : setTimeout(() => giveUp.abort(), MACHINE_LIST_TIMEOUT_MS);
        const res = await fetch(apiUrl("/api/terminals", source), {
          credentials: "same-origin",
          signal: giveUp.signal,
        })
          .catch(() => null)
          .finally(() => {
            if (timer !== null) clearTimeout(timer);
          });
        const part =
          res !== null && res.ok
            ? ((await res.json().catch(() => null)) as { terminals: TerminalInfo[] } | null)
            : null;
        parts.set(source, part);
        return { source, res };
      };
      // This server first; the machines once its shells are on screen.
      const here = (await ask(null)).res;
      // 404 means the route does not exist at all: the running runtime predates the
      // terminal API. Under hot update the Web App and the runtime can be different
      // versions by design, so the UI has to notice rather than offer a dead control.
      // Asked of THIS server only — a machine on an older build says nothing about the
      // control this page offers.
      if (here?.status === 404 && !unsupported) {
        unsupported = true;
        notify();
        return;
      }
      // This poll is often the only request an idle window still makes, so it is the
      // first thing to see a session that was revoked meanwhile. It goes through the raw
      // fetch rather than the api client, so nothing has told the app yet — the probe
      // does, and the window lands on the sign-in page (api/session-probe.ts).
      if (here?.status === 401) {
        void probeSession();
        return;
      }
      if (here === null || !here.ok) return; // server unreachable or refusing: keep the last list
      unsupported = false;
      /**
       * The list from the answers in hand, in source order. A machine still out keeps the
       * shells it had until its own answer lands.
       */
      const listFrom = (out: ReadonlySet<string | null>): TerminalInfo[] => {
        const terminals: TerminalInfo[] = [];
        for (const source of sources) {
          if (out.has(source)) {
            terminals.push(...raw.filter((t) => machineForTerminal(t.id) === source));
            continue;
          }
          for (const terminal of parts.get(source)?.terminals ?? []) {
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
        return terminals.filter((t) => t.alive && !isPendingKill(t.id));
      };
      /** Shows a list unless this window changed it since the round began (see below). */
      const show = (live: TerminalInfo[], answeredAll: boolean): boolean => {
        // This window created or refiled a shell while the list was on its way: the answer
        // predates that, so it would take the new shell out of the panel (or file it under the
        // old conversation) until the next poll. Ask again instead (below, once this request is
        // no longer the one in flight).
        stale = localChanges !== changesAtStart;
        if (stale) return false;
        // A short answer (a machine still being re-held after a restart answers nothing yet)
        // is displayed as it is: a pane whose bytes cannot arrive is not usable yet, but
        // nothing acts on its strength (terminalListComplete), and the next complete refresh
        // restores the rest.
        const flipped = answeredAll !== complete;
        complete = answeredAll;
        commit(live);
        if (flipped) notify();
        return true;
      };
      // This server's shells are shown the moment it answers: a machine still out never holds
      // them back.
      const machines = sources.filter((source): source is string => source !== null);
      if (machines.length > 0 && !show(listFrom(new Set(machines)), false)) return;
      const answers = await Promise.all(machines.map(ask));
      show(
        listFrom(new Set()),
        answers.every((a) => a.res !== null && a.res.ok),
      );
    } catch {
      // Network hiccup: the next poll/focus refresh will catch up.
    } finally {
      inflight = null;
    }
  })().then(async () => {
    // A stale answer asks again, and whoever awaited this round waits for that one.
    if (stale) await refreshTerminals();
  });
  return inflight;
}

const onFocus = (): void => void refreshTerminals();

/**
 * Hears every change of the list and of the API's support without asking the server for
 * anything: for a feed that is followed for good (the panel registry's `offered`), which
 * must not keep a poll running on pages that show no terminal.
 */
export function watchTerminals(listener: () => void): () => void {
  watchers.add(listener);
  return () => {
    watchers.delete(listener);
  };
}

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
  localChanges += 1;
  if (raw.some((t) => t.id === info.id)) return;
  commit([...raw, info]);
}

/** A shell this window just refiled under another conversation (the PATCH answer in hand). */
export function noteTerminalReowned(id: string, sessionId: string | null): void {
  localChanges += 1;
  commit(raw.map((t) => (t.id === id ? { ...t, sessionId } : t)));
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
