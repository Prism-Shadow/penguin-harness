/**
 * A Project's scheduled tasks, as a tiny module-level store shared by the two surfaces that read
 * them: the session list's alarm-clock mark (which of the listed Sessions have a task still to
 * fire) and the dock's scheduled-tasks panel (the open conversation's own tasks, listed). They
 * must never disagree about whether a conversation has tasks, so they read one cache rather than
 * fetching one each.
 *
 * The scope is the whole Project because that is what the two surfaces need between them: the
 * session list draws every Agent's Sessions — workspace, time and agent grouping all mix them —
 * while the panel is one conversation of one of them. Read per agent, the list answered only the
 * panel: every other Agent's rows wore no mark, and because the chat page moves the current Agent
 * to whatever conversation is open, the marks left one Agent's rows and returned to them as the
 * user walked the list. One Project-wide listing answers both surfaces, so a row's mark no longer
 * depends on which Agent is current.
 *
 * The server has no per-Session schedule field and no push channel for the schedule directories —
 * an agent may write a task file at any moment — so the store decides *when* to look: on
 * navigation (the Project or the Session on screen changing), whenever the window regains focus
 * while a reader is mounted, on the `schedule_fired` / `schedule_queued` events (wired in
 * state/sessions.tsx), on the panel's slow poll while it is on screen, after every mutation the
 * panel makes, and on the edge where a turn settles (chat-page.tsx) — a turn may have written a
 * task file of its own.
 *
 * Entries are kept per Project rather than held in a single slot the store points at, and none is
 * ever evicted: switching Projects and back then draws the marks on the first frame instead of
 * blanking them for the length of a round trip. Growth is bounded by how many Projects one
 * sitting opens, and an entry is a list already loaded once, so dropping one would trade a few
 * kilobytes back for exactly the blank-then-refetch this cache exists to remove.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { ProjectScheduleItem } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";

interface Entry {
  projectId: string;
  /** Null until this Project has answered once; a refetch keeps the list it already has. */
  items: ProjectScheduleItem[] | null;
  /** Last failure text, cleared by the next success. The panel shows it only while `items` is null. */
  error: string | null;
  /** This Project's request: concurrent readers share it, another Project gets its own. */
  inflight: Promise<void> | null;
  /** Mounted readers of this Project (retainSchedules); zero means nothing on screen shows this list. */
  readers: number;
}

/** One entry per Project, kept for the lifetime of the tab (see the header). */
const entries = new Map<string, Entry>();

function entryFor(projectId: string): Entry {
  const existing = entries.get(projectId);
  if (existing) return existing;
  const created: Entry = {
    projectId,
    items: null,
    error: null,
    inflight: null,
    readers: 0,
  };
  entries.set(projectId, created);
  return created;
}

/** Lookup that creates nothing: a render must not add an entry for a Project nobody is loading. */
function peek(projectId: string | null): Entry | undefined {
  if (projectId === null) return undefined;
  return entries.get(projectId);
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

/** This Project's loaded list, or null while it has never answered. */
export function scheduleItems(projectId: string | null): ProjectScheduleItem[] | null {
  return peek(projectId)?.items ?? null;
}

/** This Project's last failure text, or null. */
export function scheduleError(projectId: string | null): string | null {
  return peek(projectId)?.error ?? null;
}

/**
 * Re-reads one Project's list. The Project is an argument rather than whatever the store last
 * pointed at, which is what makes the request always the one the caller asked for: concurrent
 * calls for a Project share its request, and a call for another Project issues its own instead of
 * waiting on a promise that will answer about somebody else.
 */
export function refreshSchedules(projectId: string | null): Promise<void> {
  if (projectId === null) return Promise.resolve();
  const entry = entryFor(projectId);
  if (entry.inflight) return entry.inflight;
  const request = (async () => {
    try {
      const res = await api.listProjectSchedules(projectId);
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
  // `await`: any second caller for this Project runs after that point and finds the promise here.
  entry.inflight = request;
  return request;
}

/**
 * Counts one mounted reader of a Project; the returned function releases it. The count decides
 * which Projects an event or a regained focus re-reads — refreshing a list nothing is showing
 * spends a request on an answer that would be re-read anyway when it next comes on screen.
 * Releasing keeps the cached list, which is precisely what the reader shows again on return.
 */
export function retainSchedules(projectId: string | null): () => void {
  if (projectId === null) return () => {};
  const entry = entryFor(projectId);
  entry.readers += 1;
  return () => {
    entry.readers -= 1;
  };
}

/**
 * A schedule event landed for some Project (state/sessions.tsx, chat-page.tsx): refresh only when
 * that Project is on screen, so a task firing in another Project costs no request.
 */
export function noteScheduleEvent(projectId: string): void {
  const entry = peek(projectId);
  if (entry === undefined || entry.readers === 0) return;
  void refreshSchedules(projectId);
}

/** Regaining focus re-reads every Project a mounted reader is showing, and no other. */
const onFocus = (): void => {
  if (document.visibilityState !== "visible") return;
  for (const entry of [...entries.values()]) {
    if (entry.readers > 0) void refreshSchedules(entry.projectId);
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
 * Subscribes to the store and keeps one Project's list loaded, refetching whenever `refreshKey`
 * changes — the Session on screen, so opening a conversation re-reads what may just have been
 * created or switched off. The result is the Project's whole list, every Agent's tasks stamped
 * with the agent that owns them; callers narrow it themselves (`sessionSchedules` /
 * `pendingScheduleSessions`).
 *
 * `items` is null only for a Project that has never been answered. A Project already loaded
 * answers from its entry on the first render after a navigation, while the refetch is still out,
 * which is what keeps the session rows' marks from blinking as the user walks the list.
 */
export function useProjectSchedules(
  projectId: string | null,
  refreshKey: string,
): { items: ProjectScheduleItem[] | null; error: string | null } {
  useSyncExternalStore(subscribeSchedules, schedulesVersion, schedulesVersion);
  // Held for as long as this reader is mounted, and deliberately not keyed on `refreshKey`:
  // moving between two conversations of one Project must not release the entry and take it again.
  useEffect(() => retainSchedules(projectId), [projectId]);
  useEffect(() => {
    void refreshSchedules(projectId);
  }, [projectId, refreshKey]);
  return {
    items: scheduleItems(projectId),
    error: scheduleError(projectId),
  };
}
