/**
 * One agent's scheduled tasks, as a tiny module-level store shared by the two surfaces that
 * read them: the sidebar's alarm-clock mark (which of the listed Sessions have an enabled task
 * bound to them) and the dock's scheduled-tasks panel (the conversation's own tasks, listed).
 * They must never disagree about whether a conversation has tasks, so they read one list rather
 * than fetching one each.
 *
 * The server has no per-Session schedule field and no push channel for the schedule
 * directory — an agent may write a task file at any moment — so the store decides *when* to
 * look: on the Session or agent changing, whenever the window regains focus while anyone is
 * subscribed, on the `schedule_fired` / `schedule_queued` events (wired in state/sessions.tsx),
 * on the panel's slow poll while it is on screen, and after every mutation the panel makes.
 *
 * The scope is set, not stacked: the sidebar names the current Agent and the panel names the
 * open conversation's, which the chat page keeps in step, so a different agent replaces the
 * cached list instead of keeping both. Readers ask for the scope they want and get nothing until
 * the store is actually pointed at it, which is what keeps the previous agent's marks off screen
 * for the frame after a navigation.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { ScheduleItem } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";

interface Scope {
  projectId: string;
  agentId: string;
}

let scope: Scope | null = null;
/** Null until the current scope has answered once; a refetch keeps the list it has. */
let items: ScheduleItem[] | null = null;
/** Only the first load's failure is reported; later failures leave the last known list alone. */
let error: string | null = null;
let version = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

/** Monotonic counter — the `useSyncExternalStore` snapshot; readers pull the data with the getters below. */
export function schedulesVersion(): number {
  return version;
}

/** Whether the store currently holds this agent's list (a reader asking for another scope must wait). */
export function schedulesScopedTo(projectId: string | null, agentId: string | null): boolean {
  return scope !== null && scope.projectId === projectId && scope.agentId === agentId;
}

/** The loaded list, or null while the current scope has not answered yet. */
export function scheduleItems(): ScheduleItem[] | null {
  return items;
}

/** The first load's failure text, or null. */
export function scheduleError(): string | null {
  return error;
}

/**
 * Points the store at an agent. A different agent drops the list at once — an alarm clock
 * standing for the previous agent's tasks is worse than no mark at all.
 */
export function scopeSchedules(projectId: string | null, agentId: string | null): void {
  if (schedulesScopedTo(projectId, agentId)) return;
  scope = projectId !== null && agentId !== null ? { projectId, agentId } : null;
  items = null;
  error = null;
  notify();
}

/** Re-reads the scoped agent's list; concurrent calls share one request. */
export function refreshSchedules(): Promise<void> {
  const target = scope;
  if (target === null) return Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await api.listSchedules(target.projectId, target.agentId);
      // The scope may have moved while the request was out; that answer belongs to nobody.
      if (scope !== target) return;
      items = res.schedules;
      error = null;
      notify();
    } catch (e) {
      if (scope !== target) return;
      error = apiErrorText(e);
      notify();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * A schedule event landed for some agent (state/sessions.tsx): refresh only when it is the one
 * on screen, so a task firing in another Project or another Agent costs no request.
 */
export function noteScheduleEvent(projectId: string, agentId: string): void {
  if (!schedulesScopedTo(projectId, agentId)) return;
  void refreshSchedules();
}

const onFocus = (): void => {
  if (document.visibilityState === "visible") void refreshSchedules();
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
 * Subscribes to the store and points it at one agent, refetching whenever `refreshKey` changes
 * — the Session on screen, so two conversations of the same agent each get a fresh read. The
 * result is this agent's whole list; callers narrow it to a Session themselves
 * (`sessionSchedules` / `enabledScheduleSessions`).
 */
export function useAgentSchedules(
  projectId: string | null,
  agentId: string | null,
  refreshKey: string,
): { items: ScheduleItem[] | null; error: string | null } {
  useSyncExternalStore(subscribeSchedules, schedulesVersion, schedulesVersion);
  useEffect(() => {
    scopeSchedules(projectId, agentId);
    void refreshSchedules();
  }, [projectId, agentId, refreshKey]);
  // Read through the scope check rather than the raw fields: the effect above runs after this
  // render, so on the first render after a navigation the store still holds the old agent.
  const mine = schedulesScopedTo(projectId, agentId);
  return { items: mine ? items : null, error: mine ? error : null };
}
