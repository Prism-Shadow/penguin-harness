/**
 * The archive page's state (Settings › Archived chats): the groups the server counts, the rows
 * each shown group has loaded, the selection, and the actions that move Sessions out of the
 * archive — unarchive, which returns them to the sidebar, and delete.
 *
 * - The groups come first (one request, with their counts); then each shown group's first page.
 *   Groups show twenty at a time, and a group shows ten rows at a time: "more" reveals ten more
 *   (fetching the next page below the last row held when the reveal runs past what is loaded),
 *   "less" folds back to ten.
 * - The selection: rows chosen one by one, and groups chosen whole with Select all — every
 *   Session the group's count saw, loaded or not, but the rows unticked since and those a row's
 *   own button has acted on. A whole group is pinned to the time its count was read at, so
 *   acting on it touches no Session archived, created or run after that.
 * - A new query or filter starts over: no rows, no reveal, no selection.
 * - An action takes its rows off the page at once, then reads the counts and every shown group
 *   again (as far as each was revealed), so what is left is the server's word.
 * - The page follows the user channel: a Session archived, unarchived, deleted or opened by a
 *   program elsewhere refreshes it the same way, debounced; a run starting or settling redraws
 *   its row's busy glyph in place, with nothing read again.
 * - An admin's groups include the machines their Projects use (this server asks each one): a
 *   machine's group is read from that machine, acted on there — its rows by id, the whole group
 *   pinned to the machine's own count time — and its events reach the page through this
 *   server's channel, wrapped as `machine_event`. Machines that could not be asked are named.
 *   The machines' groups are asked apart from this server's and join them when they answer.
 *
 * A vanilla store with its async actions, so the page's whole behaviour is exercised in Node
 * against the fetch fake (the component only renders it and asks before a delete).
 */
import { createStore } from "zustand/vanilla";
import type {
  ArchivedSessionGroup,
  ArchivedSessionGroupsResponse,
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
 * What an action acts on: some rows by id (a row's own buttons, with the machine of the group
 * they are in), or the selection (the bar's).
 */
export type ArchiveTarget =
  { kind: "ids"; ids: string[]; machineId?: string } | { kind: "selection" };

/**
 * A group chosen whole with Select all: every Session its count saw at `until`, loaded or not,
 * but the rows unticked since. Its Project and Workspace ride along, so the batch names the
 * group even if a refresh drops it from the page.
 */
export interface WholeGroup {
  projectId: string;
  workspace: string;
  /** The machine the group is on; absent on this server. */
  machineId?: string;
  /** The time the group's count was read at, by the clock of the server that counted it. */
  until: string;
  /** How many Sessions the group held at `until`. */
  count: number;
  /** Rows unticked since the group was chosen: left out of every action. */
  excluded: ReadonlySet<string>;
}

/** What is chosen: rows one by one, and groups whole (by groupKey). */
export interface ArchiveSelection {
  picked: ReadonlySet<string>;
  wholes: ReadonlyMap<string, WholeGroup>;
}

const NO_SELECTION: ArchiveSelection = { picked: new Set(), wholes: new Map() };

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
  /** What is chosen, across groups. */
  selection: ArchiveSelection;
  /** An action is running: its buttons stay disabled until it settles. */
  busy: boolean;
  /** Why the last read failed; null when it did not. */
  error: string | null;
  /** Machines whose archive could not be read this time, by alias. */
  unreachable: string[];
}

/**
 * A group's key: its machine (none for this server), its Project and its Workspace (a path or
 * `temp`), which no id or path can forge. The same path on two machines is two directories.
 */
export const groupKey = (
  group: Pick<ArchivedSessionGroup, "projectId" | "workspace" | "machineId">,
): string => `${group.machineId ?? ""}\0${group.projectId}\0${group.workspace}`;

/** Newest activity first, then Project, machine and Workspace: the order the server lists groups in. */
function groupOrder(a: ArchivedSessionGroup, b: ArchivedSessionGroup): number {
  if (a.latest !== b.latest) return a.latest > b.latest ? -1 : 1;
  if (a.projectId !== b.projectId) return a.projectId < b.projectId ? -1 : 1;
  const am = a.machineId ?? "";
  const bm = b.machineId ?? "";
  if (am !== bm) return am < bm ? -1 : 1;
  return a.workspace < b.workspace ? -1 : a.workspace > b.workspace ? 1 : 0;
}

/** The groups on screen: the first `groupLimit`. */
export function shownGroups(state: ArchiveState): ArchivedSessionGroup[] {
  return (state.groups ?? []).slice(0, state.groupLimit);
}

/** The rows of one group on screen: the first `cap` of those held. */
export function shownRows(rows: GroupRows | undefined): SessionInfo[] {
  return rows === undefined ? [] : rows.sessions.slice(0, rows.cap);
}

/** How many Sessions the selection names: the rows picked, and each whole group's count but its unticked rows. */
export function selectedCount(state: ArchiveState): number {
  let n = state.selection.picked.size;
  for (const whole of state.selection.wholes.values()) {
    n += Math.max(0, whole.count - whole.excluded.size);
  }
  return n;
}

/** Whether a row of the group `key` is chosen: picked, or in a whole group and not unticked. */
export function isChosen(state: ArchiveState, key: string, sessionId: string): boolean {
  const whole = state.selection.wholes.get(key);
  return whole !== undefined
    ? !whole.excluded.has(sessionId)
    : state.selection.picked.has(sessionId);
}

/**
 * Whether every Session of the group is chosen — what turns its Select all into Deselect all:
 * chosen whole with nothing unticked, or every row picked once all of them are loaded.
 */
export function wholeGroupChosen(state: ArchiveState, group: ArchivedSessionGroup): boolean {
  const key = groupKey(group);
  const whole = state.selection.wholes.get(key);
  if (whole !== undefined) return whole.excluded.size === 0;
  const rows = state.rows.get(key);
  return (
    rows !== undefined &&
    !rows.hasMore &&
    rows.sessions.length > 0 &&
    rows.sessions.length >= group.count &&
    rows.sessions.every((s) => state.selection.picked.has(s.sessionId))
  );
}

/** How many Sessions an action on `target` acts on, as the confirm before a delete counts them. */
export function targetCount(state: ArchiveState, target: ArchiveTarget): number {
  return target.kind === "ids" ? target.ids.length : selectedCount(state);
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
  /** Ticks or unticks one row of the group `key`. */
  toggle: (key: string, sessionId: string) => void;
  /** Select all on the group `key`, or Deselect all once all of it is chosen. */
  toggleGroup: (key: string) => void;
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

/**
 * Whether a user-channel event can change what the archive lists: this server's own, or one a
 * connected machine said (this server relays it as `machine_event`).
 */
export function touchesArchive(ev: ServerEvent): boolean {
  if (ev.type === "machine_event") return touchesArchive(ev.event);
  if (ev.type === "session_archived" || ev.type === "session_deleted") return true;
  // What a program opens is archived from the start: it may be one of this page's rows now.
  return (
    ev.type === "session_created" &&
    (ev.source === "api" ||
      ev.source === "schedule" ||
      ev.source === "cli" ||
      ev.source === "workbench")
  );
}

export function createArchiveStore(onError: (message: string) => void = () => undefined) {
  /** Invalidates the answers of a load that a newer one replaced. */
  let gen = 0;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  return createStore<ArchiveStoreState>((set, get) => {
    /** One group's rows, `limit` of them below `before` (from the top when absent), from its machine. */
    const fetchRows = async (group: ArchivedSessionGroup, limit: number, before?: SessionInfo) =>
      api.listArchivedSessions({
        ...query(get().filters),
        projectId: group.projectId,
        workspace: group.workspace,
        limit,
        ...(before !== undefined ? { before: activityKeyOf(before) } : {}),
        ...(group.machineId !== undefined ? { machineId: group.machineId } : {}),
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

    /**
     * Puts `groups` on the page in the server's order — rows of groups that are gone go with
     * them — then loads the shown ones among `fill`, and unchooses what the page no longer holds.
     */
    const place = async (
      g: number,
      next: ArchivedSessionGroup[],
      fields: { asOf: string; unreachable: string[] },
      fill: readonly ArchivedSessionGroup[],
      capOf: (key: string) => number,
    ) => {
      const groups = [...next].sort(groupOrder);
      const present = new Set(groups.map(groupKey));
      const rows = new Map([...get().rows].filter(([key]) => present.has(key)));
      const total = groups.reduce((n, group) => n + group.count, 0);
      set({ groups, total, rows, error: null, ...fields });
      const filling = new Set(fill.map(groupKey));
      await fillGroups(
        g,
        groups.slice(0, get().groupLimit).filter((group) => filling.has(groupKey(group))),
        capOf,
      );
      if (g !== gen) return;
      // A row picked that the page no longer holds (unarchived or deleted elsewhere) is
      // unchosen, and so is a whole group that is gone.
      const held = new Set(
        [...get().rows.values()].flatMap((r) => r.sessions.map((s) => s.sessionId)),
      );
      const { picked, wholes } = get().selection;
      const keptPicks = [...picked].filter((id) => held.has(id));
      const keptWholes = [...wholes].filter(([key]) => present.has(key));
      if (keptPicks.length !== picked.size || keptWholes.length !== wholes.size) {
        set({ selection: { picked: new Set(keptPicks), wholes: new Map(keptWholes) } });
      }
    };

    /**
     * Reads the groups, then their rows; `keep` carries each shown group's reveal over.
     *
     * This server's groups and the machines' are asked apart: this server's first, on the page
     * the moment they come, the machines' after that. A machine that holds its connection but
     * answers nothing must not keep the archive this server holds off the page for as long as
     * its read takes to time out. Until the machines' answer lands, a refresh keeps the machine
     * groups it showed.
     */
    const read = async (keep: boolean) => {
      const g = ++gen;
      const caps = new Map([...get().rows].map(([key, rows]) => [key, rows.cap]));
      const capOf = (key: string) =>
        keep ? (caps.get(key) ?? ARCHIVE_ROW_PAGE) : ARCHIVE_ROW_PAGE;
      const filters = query(get().filters);
      let local: ArchivedSessionGroupsResponse;
      try {
        local = await api.listArchivedSessionGroups(filters, "here");
      } catch (err) {
        if (g !== gen) return;
        set({ error: apiErrorText(err) });
        if (get().groups === null) set({ groups: [], total: 0 });
        return;
      }
      if (g !== gen) return;
      const shownMachines = (get().groups ?? []).filter((group) => group.machineId !== undefined);
      await place(
        g,
        [...local.groups, ...shownMachines],
        { asOf: local.asOf, unreachable: get().unreachable },
        local.groups,
        capOf,
      );
      if (g !== gen) return;
      const remote = await api.listArchivedSessionGroups(filters, "machines").catch(() => null);
      if (g !== gen || remote === null) return;
      await place(
        g,
        [...local.groups, ...remote.groups],
        {
          asOf: local.asOf,
          unreachable: (remote.unreachable ?? []).map((machine) => machine.alias),
        },
        remote.groups,
        capOf,
      );
    };

    /**
     * Takes these Sessions off the page at once (an action's own result). A group chosen whole
     * counts the ones it held out, so the bar and the delete confirm count what is left of it.
     */
    const dropRows = (ids: ReadonlySet<string>) => {
      const rows = new Map<string, GroupRows>();
      for (const [key, held] of get().rows) {
        rows.set(key, { ...held, sessions: held.sessions.filter((s) => !ids.has(s.sessionId)) });
      }
      const { picked, wholes } = get().selection;
      const keptWholes = new Map<string, WholeGroup>();
      for (const [key, whole] of wholes) {
        const gone = (get().rows.get(key)?.sessions ?? []).filter((s) => ids.has(s.sessionId));
        const count = whole.count - gone.length;
        const excluded = new Set([...whole.excluded].filter((id) => !ids.has(id)));
        // Nothing of the group left chosen: it is not chosen any more.
        if (count > excluded.size) keptWholes.set(key, { ...whole, count, excluded });
      }
      set({
        rows,
        selection: {
          picked: new Set([...picked].filter((id) => !ids.has(id))),
          wholes: keptWholes,
        },
      });
    };

    /** The machine each held row is on (absent: this server), from the group that holds it. */
    const machinesOfHeld = (): Map<string, string | undefined> => {
      const machineOfKey = new Map((get().groups ?? []).map((g) => [groupKey(g), g.machineId]));
      const out = new Map<string, string | undefined>();
      for (const [key, rows] of get().rows) {
        for (const s of rows.sessions) out.set(s.sessionId, machineOfKey.get(key));
      }
      return out;
    };

    /**
     * The batch requests for a target: chunks of ids for the rows named or picked — one run of
     * chunks per server they are on — and one filter per whole group, pinned to the time its count
     * was read at, without its unticked rows. A machine's batch names the machine.
     */
    const batchesOf = (target: ArchiveTarget): ArchivedSessionsBatch[] => {
      const byMachine = new Map<string | undefined, string[]>();
      if (target.kind === "ids") byMachine.set(target.machineId, target.ids);
      else {
        const held = machinesOfHeld();
        for (const id of get().selection.picked) {
          const machineId = held.get(id);
          byMachine.set(machineId, [...(byMachine.get(machineId) ?? []), id]);
        }
      }
      const out: ArchivedSessionsBatch[] = [];
      for (const [machineId, ids] of byMachine) {
        for (let i = 0; i < ids.length; i += BATCH_MAX) {
          out.push({
            sessionIds: ids.slice(i, i + BATCH_MAX),
            ...(machineId !== undefined ? { machineId } : {}),
          });
        }
      }
      if (target.kind === "ids") return out;
      for (const whole of get().selection.wholes.values()) {
        out.push({
          filter: {
            ...query(get().filters),
            projectId: whole.projectId,
            workspace: whole.workspace,
            until: whole.until,
            ...(whole.excluded.size > 0 ? { exclude: [...whole.excluded] } : {}),
          },
          ...(whole.machineId !== undefined ? { machineId: whole.machineId } : {}),
        });
      }
      return out;
    };

    /** The rows a target names that the page holds, to take off at once. */
    const heldIds = (target: ArchiveTarget): Set<string> => {
      if (target.kind === "ids") return new Set(target.ids);
      const out = new Set(get().selection.picked);
      for (const [key, whole] of get().selection.wholes) {
        for (const s of get().rows.get(key)?.sessions ?? []) {
          if (!whole.excluded.has(s.sessionId)) out.add(s.sessionId);
        }
      }
      return out;
    };

    const act = async (
      target: ArchiveTarget,
      call: (batch: ArchivedSessionsBatch) => Promise<unknown>,
    ): Promise<boolean> => {
      set({ busy: true });
      try {
        const held = heldIds(target);
        for (const batch of batchesOf(target)) await call(batch);
        dropRows(held);
        if (target.kind === "selection") set({ selection: NO_SELECTION });
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
      selection: NO_SELECTION,
      busy: false,
      error: null,
      unreachable: [],

      load: async (filters) => {
        set({
          filters,
          groups: null,
          total: 0,
          asOf: null,
          groupLimit: ARCHIVE_GROUP_PAGE,
          rows: new Map(),
          selection: NO_SELECTION,
          error: null,
          unreachable: [],
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

      toggle: (key, sessionId) => {
        const { picked, wholes } = get().selection;
        const whole = wholes.get(key);
        if (whole !== undefined) {
          // A row of a whole group is unticked by leaving it out, and ticked again by taking it back.
          const excluded = new Set(whole.excluded);
          if (excluded.has(sessionId)) excluded.delete(sessionId);
          else excluded.add(sessionId);
          const next = new Map(wholes);
          // Every row unticked: nothing of the group is chosen any more.
          if (excluded.size >= whole.count) next.delete(key);
          else next.set(key, { ...whole, excluded });
          set({ selection: { picked, wholes: next } });
          return;
        }
        const next = new Set(picked);
        if (next.has(sessionId)) next.delete(sessionId);
        else next.add(sessionId);
        set({ selection: { picked: next, wholes } });
      },

      toggleGroup: (key) => {
        const state = get();
        const group = state.groups?.find((g) => groupKey(g) === key);
        if (group === undefined || state.asOf === null) return;
        // The group's rows picked one by one are folded into the whole group, or dropped with it.
        const held = new Set((state.rows.get(key)?.sessions ?? []).map((s) => s.sessionId));
        const picked = new Set([...state.selection.picked].filter((id) => !held.has(id)));
        const wholes = new Map(state.selection.wholes);
        if (wholeGroupChosen(state, group)) wholes.delete(key);
        else {
          wholes.set(key, {
            projectId: group.projectId,
            workspace: group.workspace,
            ...(group.machineId !== undefined ? { machineId: group.machineId } : {}),
            // A machine's group was counted by the machine's clock: its batch is pinned to that.
            until: group.asOf ?? state.asOf,
            count: group.count,
            excluded: new Set(),
          });
        }
        set({ selection: { picked, wholes } });
      },

      clearSelection: () => set({ selection: NO_SELECTION }),

      unarchive: (target) => act(target, (batch) => api.unarchiveSessions(batch)),

      remove: (target) => act(target, (batch) => api.deleteSessions(batch)),

      noteEvent: (ev) => {
        // A machine's own run state arrives wrapped, and redraws its row the same way.
        const said = ev.type === "machine_event" ? ev.event : ev;
        if (said.type === "session_state") {
          patchStatus(said.sessionId, said.state);
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
