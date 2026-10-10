/**
 * The archive page's state (Settings › Archived chats): the groups the server counts, the rows
 * each shown group has loaded, the selection, and the actions that move Sessions out of the
 * archive — unarchive, which returns them to the sidebar, and delete.
 *
 * - The groups come first (one request, with their counts); then each shown group's first page.
 *   Groups show twenty at a time, and a group shows ten rows at a time: "more" reveals ten more
 *   (fetching the next page below the last row held when the reveal runs past what is loaded),
 *   "less" folds back to ten.
 * - A new query or filter starts over: no rows, no reveal, no selection.
 * - An action takes its rows off the page at once, then reads the counts and every shown group
 *   again (as far as each was revealed), so what is left is the server's word. A whole group's
 *   action carries the time its count was read at, so it acts on the Sessions that count saw
 *   and on none archived, created or run after it.
 * - The page follows the user channel: a Session archived, unarchived, deleted or opened by a
 *   program elsewhere refreshes it the same way, debounced; a run starting or settling redraws
 *   its row's busy glyph in place, with nothing read again.
 *
 * A vanilla store with its async actions, so the page's whole behaviour is exercised in Node
 * against the fetch fake (the component only renders it and asks before a delete).
 */
import { createStore } from "zustand/vanilla";
import type {
  ArchivedSessionGroup,
  ArchivedSessionSource,
  ArchivedSessionsBatch,
  ArchivedSessionsQuery,
  ServerEvent,
  SessionInfo,
  SessionStatus,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { SIDEBAR_PAGE_SIZE, activityKeyOf } from "../../lib/session-grouping";

/** Groups shown before "more groups". */
export const ARCHIVE_GROUP_PAGE = 20;

/** Rows a group shows, and loads, per step. */
export const ARCHIVE_ROW_PAGE = SIDEBAR_PAGE_SIZE;

/** The largest page one request may ask for (the route's own cap). */
const ROWS_MAX = 100;

/** Ids one batch request may name (the route's own cap). */
const BATCH_MAX = 500;

/** How long a burst of live events gathers before the page reads itself again. */
export const ARCHIVE_REFRESH_DELAY_MS = 300;

/** The page's filters: the title query, and the two pickers (null = all). */
export interface ArchiveFilters {
  q: string;
  source: ArchivedSessionSource | null;
  projectId: string | null;
}

/** One group's loaded rows: the rows held, whether the server has more below them, and how many show. */
export interface GroupRows {
  sessions: SessionInfo[];
  hasMore: boolean;
  /** Rows shown (a multiple of ARCHIVE_ROW_PAGE). */
  cap: number;
  /** A page for this group is on its way. */
  loading: boolean;
}

/**
 * What an action acts on: chosen rows, or the archived rows of one group the filters match that
 * its count, read at `until` (the groups' `asOf`), saw.
 */
export type ArchiveTarget =
  { kind: "ids"; ids: string[] } | { kind: "group"; key: string; until?: string };

export interface ArchiveState {
  filters: ArchiveFilters;
  /** The groups, newest first; null until the first answer. */
  groups: ArchivedSessionGroup[] | null;
  /** Sum of the groups' counts. */
  total: number;
  /** When the server took the counts on screen; null until the first answer. */
  asOf: string | null;
  /** Groups shown (a multiple of ARCHIVE_GROUP_PAGE). */
  groupLimit: number;
  /** Each shown group's rows, by groupKey. */
  rows: ReadonlyMap<string, GroupRows>;
  /** Chosen Session ids, across groups. */
  selection: ReadonlySet<string>;
  /** An action is running: its buttons stay disabled until it settles. */
  busy: boolean;
  /** Why the last read failed; null when it did not. */
  error: string | null;
}

/** A group's key: its Project and its Workspace (a path or `temp`), which no id or path can forge. */
export const groupKey = (group: Pick<ArchivedSessionGroup, "projectId" | "workspace">): string =>
  `${group.projectId}\0${group.workspace}`;

/** The groups on screen: the first `groupLimit`. */
export function shownGroups(state: ArchiveState): ArchivedSessionGroup[] {
  return (state.groups ?? []).slice(0, state.groupLimit);
}

/** The rows of one group on screen: the first `cap` of those held. */
export function shownRows(rows: GroupRows | undefined): SessionInfo[] {
  return rows === undefined ? [] : rows.sessions.slice(0, rows.cap);
}

/**
 * A whole group as an action's target, pinned to the counts on screen: what the user is shown
 * counted is what the action acts on.
 */
export function groupTarget(state: ArchiveState, key: string): ArchiveTarget {
  return { kind: "group", key, ...(state.asOf !== null ? { until: state.asOf } : {}) };
}

/** How many Sessions an action on `target` acts on, as the confirm before a delete counts them. */
export function targetCount(state: ArchiveState, target: ArchiveTarget): number {
  if (target.kind === "ids") return target.ids.length;
  return state.groups?.find((g) => groupKey(g) === target.key)?.count ?? 0;
}

const query = (filters: ArchiveFilters): ArchivedSessionsQuery => ({
  ...(filters.q.trim() !== "" ? { q: filters.q.trim() } : {}),
  ...(filters.source !== null ? { source: filters.source } : {}),
  ...(filters.projectId !== null ? { projectId: filters.projectId } : {}),
});

export interface ArchiveStoreState extends ArchiveState {
  /** Reads everything again under `filters` (a new query or filter starts over). */
  load: (filters: ArchiveFilters) => Promise<void>;
  /** Reads the counts and every shown group again, keeping each group's reveal. */
  refresh: () => Promise<void>;
  showMoreGroups: () => Promise<void>;
  showMoreRows: (key: string) => Promise<void>;
  showLessRows: (key: string) => void;
  toggle: (sessionId: string) => void;
  clearSelection: () => void;
  unarchive: (target: ArchiveTarget) => Promise<boolean>;
  remove: (target: ArchiveTarget) => Promise<boolean>;
  /**
   * Hears the user channel: a change to what the archive lists refreshes the page soon; a run
   * state redraws its row where it stands.
   */
  noteEvent: (ev: ServerEvent) => void;
  /** Stops a pending refresh (the page is closing). */
  dispose: () => void;
}

/** Whether a user-channel event can change what the archive lists. */
export function touchesArchive(ev: ServerEvent): boolean {
  if (ev.type === "session_archived" || ev.type === "session_deleted") return true;
  // What a program opens is archived from the start: it may be one of this page's rows now.
  return (
    ev.type === "session_created" &&
    (ev.source === "api" || ev.source === "schedule" || ev.source === "cli")
  );
}

export function createArchiveStore(onError: (message: string) => void = () => undefined) {
  /** Invalidates the answers of a load that a newer one replaced. */
  let gen = 0;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  return createStore<ArchiveStoreState>((set, get) => {
    /** One group's rows, `limit` of them below `before` (from the top when absent). */
    const fetchRows = async (group: ArchivedSessionGroup, limit: number, before?: SessionInfo) =>
      api.listArchivedSessions({
        ...query(get().filters),
        projectId: group.projectId,
        workspace: group.workspace,
        limit,
        ...(before !== undefined ? { before: activityKeyOf(before) } : {}),
      });

    const setRows = (key: string, rows: GroupRows) => {
      const next = new Map(get().rows);
      next.set(key, rows);
      set({ rows: next });
    };

    /** A loaded row's run state, redrawn where the row stands (its place is not re-sorted). */
    const patchStatus = (sessionId: string, status: SessionStatus) => {
      let next: Map<string, GroupRows> | null = null;
      for (const [key, rows] of get().rows) {
        const i = rows.sessions.findIndex((s) => s.sessionId === sessionId);
        if (i === -1 || rows.sessions[i]!.status === status) continue;
        next ??= new Map(get().rows);
        const sessions = rows.sessions.slice();
        sessions[i] = { ...sessions[i]!, status };
        next.set(key, { ...rows, sessions });
      }
      if (next !== null) set({ rows: next });
    };

    /** Loads the top of each group (as far as `capOf` says) that has no rows yet or is asked to reload. */
    const fillGroups = async (
      g: number,
      groups: ArchivedSessionGroup[],
      capOf: (key: string) => number,
    ) => {
      await Promise.all(
        groups.map(async (group) => {
          const key = groupKey(group);
          const cap = capOf(key);
          const held = get().rows.get(key);
          setRows(key, {
            sessions: held?.sessions ?? [],
            hasMore: held?.hasMore ?? false,
            cap,
            loading: true,
          });
          try {
            const page = await fetchRows(group, Math.min(cap, ROWS_MAX));
            if (g !== gen) return;
            setRows(key, { sessions: page.sessions, hasMore: page.hasMore, cap, loading: false });
          } catch (err) {
            if (g !== gen) return;
            const now = get().rows.get(key);
            if (now !== undefined) setRows(key, { ...now, loading: false });
            set({ error: apiErrorText(err) });
          }
        }),
      );
    };

    /** Reads the groups, then their rows; `keep` carries each shown group's reveal over. */
    const read = async (keep: boolean) => {
      const g = ++gen;
      const caps = new Map([...get().rows].map(([key, rows]) => [key, rows.cap]));
      let groups: ArchivedSessionGroup[];
      let total: number;
      let asOf: string;
      try {
        ({ groups, total, asOf } = await api.listArchivedSessionGroups(query(get().filters)));
      } catch (err) {
        if (g !== gen) return;
        set({ error: apiErrorText(err) });
        if (get().groups === null) set({ groups: [], total: 0 });
        return;
      }
      if (g !== gen) return;
      // Rows of groups that are gone go with them.
      const present = new Set(groups.map(groupKey));
      const rows = new Map([...get().rows].filter(([key]) => present.has(key)));
      set({ groups, total, asOf, rows, error: null });
      await fillGroups(g, groups.slice(0, get().groupLimit), (key) =>
        keep ? (caps.get(key) ?? ARCHIVE_ROW_PAGE) : ARCHIVE_ROW_PAGE,
      );
      if (g !== gen) return;
      // A chosen row the page no longer holds (unarchived or deleted elsewhere) is unchosen.
      const held = new Set(
        [...get().rows.values()].flatMap((r) => r.sessions.map((s) => s.sessionId)),
      );
      const selection = [...get().selection].filter((id) => held.has(id));
      if (selection.length !== get().selection.size) set({ selection: new Set(selection) });
    };

    /** Takes these Sessions off the page at once (an action's own result). */
    const dropRows = (ids: ReadonlySet<string>) => {
      const rows = new Map<string, GroupRows>();
      for (const [key, held] of get().rows) {
        rows.set(key, { ...held, sessions: held.sessions.filter((s) => !ids.has(s.sessionId)) });
      }
      const selection = new Set([...get().selection].filter((id) => !ids.has(id)));
      set({ rows, selection });
    };

    /** The batch requests for a target: chunks of ids, or one filter naming the group. */
    const batchesOf = (target: ArchiveTarget): ArchivedSessionsBatch[] => {
      if (target.kind === "ids") {
        const out: ArchivedSessionsBatch[] = [];
        for (let i = 0; i < target.ids.length; i += BATCH_MAX) {
          out.push({ sessionIds: target.ids.slice(i, i + BATCH_MAX) });
        }
        return out;
      }
      const group = get().groups?.find((g) => groupKey(g) === target.key);
      if (group === undefined) return [];
      const until = target.until ?? get().asOf;
      return [
        {
          filter: {
            ...query(get().filters),
            projectId: group.projectId,
            workspace: group.workspace,
            ...(until !== null ? { until } : {}),
          },
        },
      ];
    };

    /** The rows a target names that the page holds, to take off at once. */
    const heldIds = (target: ArchiveTarget): Set<string> =>
      target.kind === "ids"
        ? new Set(target.ids)
        : new Set((get().rows.get(target.key)?.sessions ?? []).map((s) => s.sessionId));

    const act = async (
      target: ArchiveTarget,
      call: (batch: ArchivedSessionsBatch) => Promise<unknown>,
    ): Promise<boolean> => {
      set({ busy: true });
      try {
        for (const batch of batchesOf(target)) await call(batch);
        dropRows(heldIds(target));
        return true;
      } catch (err) {
        onError(apiErrorText(err));
        return false;
      } finally {
        set({ busy: false });
        await get().refresh();
      }
    };

    return {
      filters: { q: "", source: null, projectId: null },
      groups: null,
      total: 0,
      asOf: null,
      groupLimit: ARCHIVE_GROUP_PAGE,
      rows: new Map(),
      selection: new Set(),
      busy: false,
      error: null,

      load: async (filters) => {
        set({
          filters,
          groups: null,
          total: 0,
          asOf: null,
          groupLimit: ARCHIVE_GROUP_PAGE,
          rows: new Map(),
          selection: new Set(),
          error: null,
        });
        await read(false);
      },

      refresh: async () => {
        await read(true);
      },

      showMoreGroups: async () => {
        const before = get().groupLimit;
        const groupLimit = before + ARCHIVE_GROUP_PAGE;
        set({ groupLimit });
        const fresh = (get().groups ?? []).slice(before, groupLimit);
        await fillGroups(gen, fresh, () => ARCHIVE_ROW_PAGE);
      },

      showMoreRows: async (key) => {
        const held = get().rows.get(key);
        const group = get().groups?.find((g) => groupKey(g) === key);
        if (held === undefined || group === undefined || held.loading) return;
        const cap = held.cap + ARCHIVE_ROW_PAGE;
        // A page already in memory spends no request.
        if (held.sessions.length >= cap || !held.hasMore) {
          setRows(key, { ...held, cap });
          return;
        }
        setRows(key, { ...held, cap, loading: true });
        const g = gen;
        try {
          const page = await fetchRows(
            group,
            Math.min(cap - held.sessions.length, ROWS_MAX),
            held.sessions.at(-1),
          );
          if (g !== gen) return;
          const now = get().rows.get(key) ?? held;
          const seen = new Set(now.sessions.map((s) => s.sessionId));
          setRows(key, {
            sessions: [...now.sessions, ...page.sessions.filter((s) => !seen.has(s.sessionId))],
            hasMore: page.hasMore,
            cap,
            loading: false,
          });
        } catch (err) {
          if (g !== gen) return;
          setRows(key, { ...(get().rows.get(key) ?? held), loading: false });
          onError(apiErrorText(err));
        }
      },

      showLessRows: (key) => {
        const held = get().rows.get(key);
        if (held !== undefined) setRows(key, { ...held, cap: ARCHIVE_ROW_PAGE });
      },

      toggle: (sessionId) => {
        const next = new Set(get().selection);
        if (next.has(sessionId)) next.delete(sessionId);
        else next.add(sessionId);
        set({ selection: next });
      },

      clearSelection: () => set({ selection: new Set() }),

      unarchive: (target) => act(target, (batch) => api.unarchiveSessions(batch)),

      remove: (target) => act(target, (batch) => api.deleteSessions(batch)),

      noteEvent: (ev) => {
        if (ev.type === "session_state") {
          patchStatus(ev.sessionId, ev.state);
          return;
        }
        if (!touchesArchive(ev) || refreshTimer !== null) return;
        refreshTimer = setTimeout(() => {
          refreshTimer = null;
          // An action in flight refreshes when it settles.
          if (!get().busy) void get().refresh();
        }, ARCHIVE_REFRESH_DELAY_MS);
      },

      dispose: () => {
        gen += 1;
        if (refreshTimer !== null) clearTimeout(refreshTimer);
        refreshTimer = null;
      },
    };
  });
}

export type ArchiveStore = ReturnType<typeof createArchiveStore>;
