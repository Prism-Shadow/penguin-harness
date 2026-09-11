/**
 * Scheduled tasks per agent, as a tiny module-level store shared by the two surfaces that read
 * them: the sidebar's alarm-clock mark (which of the listed Sessions have an enabled task bound
 * to them) and the dock's scheduled-tasks panel (the conversation's own tasks, listed). They must
 * never disagree about whether a conversation has tasks, so they read one cache rather than
 * fetching one each.
 *
 * The server has no per-Session schedule field and no push channel for the schedule
 * directory — an agent may write a task file at any moment — so the store decides *when* to
 * look: on the Session or agent changing, whenever the window regains focus while a reader is
 * mounted, on the `schedule_fired` / `schedule_queued` events (wired in state/sessions.tsx), on
 * the panel's slow poll while it is on screen, and after every mutation the panel makes.
 *
 * Everything here is keyed by scope — one project and one agent — rather than held in a single
 * slot the store points at. The two readers genuinely disagree for as long as a navigation takes
 * to settle: the sidebar names the current Agent, which flips the moment a row is clicked, while
 * the panel names the open conversation's. With one slot every such moment threw the list away
 * and bought it back with a round trip, so the row marks blinked; with one entry per scope, a
 * reader whose scope has already answered keeps answering from it, and a request asked for on
 * behalf of agent B is issued for B even while A's is still out.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { ScheduleItem } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";

interface Scope {
  projectId: string;
  agentId: string;
}

interface Entry {
  scope: Scope;
  /** Null until this scope has answered once; a refetch keeps the list it already has. */
  items: ScheduleItem[] | null;
  /** Last failure text, cleared by the next success. The panel shows it only while `items` is null. */
  error: string | null;
  /** This scope's request: concurrent readers of one scope share it, another scope gets its own. */
  inflight: Promise<void> | null;
  /** Mounted readers of this scope (retainSchedules); zero means nothing on screen shows this list. */
  readers: number;
}

/**
 * One entry per scope, kept for the lifetime of the tab. Growth is bounded in practice by how
 * many Agents one sitting opens — a project holds a handful, and an entry is a list already
 * loaded once — so nothing is evicted: dropping an entry would trade a few kilobytes back for
 * exactly the blank-then-refetch this cache exists to remove.
 */
const entries = new Map<string, Entry>();

/** Cache key. Neither id can contain a space (both are `[A-Za-z0-9_-]`), so no pair collides. */
function keyOf(projectId: string, agentId: string): string {
  return `${projectId} ${agentId}`;
}

function entryFor(projectId: string, agentId: string): Entry {
  const key = keyOf(projectId, agentId);
  const existing = entries.get(key);
  if (existing) return existing;
  const created: Entry = {
    scope: { projectId, agentId },
    items: null,
    error: null,
    inflight: null,
    readers: 0,
  };
  entries.set(key, created);
  return created;
}

/** Lookup that creates nothing: a render must not add an entry for a scope nobody is loading. */
function peek(projectId: string | null, agentId: string | null): Entry | undefined {
  if (projectId === null || agentId === null) return undefined;
  return entries.get(keyOf(projectId, agentId));
}

let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

/** Monotonic counter — the `useSyncExternalStore` snapshot; readers pull the data with the getters below. */
export function schedulesVersion(): number {
  return version;
}

/** This agent's loaded list, or null while this scope has never answered. */
export function scheduleItems(
  projectId: string | null,
  agentId: string | null,
): ScheduleItem[] | null {
  return peek(projectId, agentId)?.items ?? null;
}

/** This agent's last failure text, or null. */
export function scheduleError(projectId: string | null, agentId: string | null): string | null {
  return peek(projectId, agentId)?.error ?? null;
}

/**
 * Re-reads one agent's list. The scope is an argument rather than whatever the store last pointed
 * at, which is what makes the request always the one the caller asked for: concurrent calls for a
 * scope share its request, and a call for another scope issues its own instead of waiting on a
 * promise that will answer about somebody else.
 */
export function refreshSchedules(projectId: string | null, agentId: string | null): Promise<void> {
  if (projectId === null || agentId === null) return Promise.resolve();
  const entry = entryFor(projectId, agentId);
  if (entry.inflight) return entry.inflight;
  const request = (async () => {
    try {
      const res = await api.listSchedules(projectId, agentId);
      entry.items = res.schedules;
      entry.error = null;
    } catch (e) {
      // The list it already has stays: a refetch failing is not news that the tasks are gone.
      entry.error = apiErrorText(e);
    } finally {
      entry.inflight = null;
    }
    notify();
  })();
  // Assigned after the body starts, which is safe because the body suspends at its first
  // `await`: any second caller for this scope runs after that point and finds the promise here.
  entry.inflight = request;
  return request;
}

/**
 * Counts one mounted reader of a scope; the returned function releases it. The count decides
 * which scopes an event or a regained focus re-reads — refreshing a list nothing is showing
 * spends a request on an answer that would be re-read anyway when it next comes on screen.
 * Releasing keeps the cached list, which is precisely what the reader shows again on return.
 */
export function retainSchedules(projectId: string | null, agentId: string | null): () => void {
  if (projectId === null || agentId === null) return () => {};
  const entry = entryFor(projectId, agentId);
  entry.readers += 1;
  return () => {
    entry.readers -= 1;
  };
}

/**
 * A schedule event landed for some agent (state/sessions.tsx, chat-page.tsx): refresh only when
 * that agent is on screen, so a task firing in another Project or another Agent costs no request.
 */
export function noteScheduleEvent(projectId: string, agentId: string): void {
  const entry = peek(projectId, agentId);
  if (entry === undefined || entry.readers === 0) return;
  void refreshSchedules(projectId, agentId);
}

/** Regaining focus re-reads every scope a mounted reader is showing, and no other. */
const onFocus = (): void => {
  if (document.visibilityState !== "visible") return;
  for (const entry of [...entries.values()]) {
    if (entry.readers > 0) void refreshSchedules(entry.scope.projectId, entry.scope.agentId);
  }
};

export function subscribeSchedules(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    }
  };
}

/**
 * Subscribes to the store and keeps one agent's list loaded, refetching whenever `refreshKey`
 * changes — the Session on screen, so two conversations of the same agent each get a fresh read.
 * The result is this agent's whole list; callers narrow it to a Session themselves
 * (`sessionSchedules` / `pendingScheduleSessions`).
 *
 * `items` is null only for a scope that has never been answered. An agent already loaded answers
 * from its own entry on the first render after a navigation, while the refetch is still out,
 * which is what keeps the session rows' marks from blinking as the current Agent changes.
 */
export function useAgentSchedules(
  projectId: string | null,
  agentId: string | null,
  refreshKey: string,
): { items: ScheduleItem[] | null; error: string | null } {
  useSyncExternalStore(subscribeSchedules, schedulesVersion, schedulesVersion);
  // Held for as long as this reader is mounted, and deliberately not keyed on `refreshKey`:
  // moving between two conversations of one agent must not release the scope and take it again.
  useEffect(() => retainSchedules(projectId, agentId), [projectId, agentId]);
  useEffect(() => {
    void refreshSchedules(projectId, agentId);
  }, [projectId, agentId, refreshKey]);
  return {
    items: scheduleItems(projectId, agentId),
    error: scheduleError(projectId, agentId),
  };
}
