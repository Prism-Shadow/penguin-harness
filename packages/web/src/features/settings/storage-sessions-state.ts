/**
 * The conversation list behind Clean up old chats and Manage chats (Settings › Storage): the
 * Sessions of the Projects the user can open, by size or by last activity, the choice, and the
 * delete — the archive page's batch delete, the one way a Session is deleted.
 *
 * - The list is read for the filters (an Agent, archived or not, last active more than N days
 *   ago, the order); only the newest read lands, and the rows shown stay until it does. The
 *   server lists at most 500 and says when more matched.
 * - A running Session is listed but cannot be chosen. A read that opens with everything chosen
 *   (Clean up old chats) chooses every row but those. A read again keeps the choice on the rows
 *   it still lists that are not running, and drops the rest.
 * - Deleting sends exactly the chosen ids, at most 500 per request (the route's cap), takes those
 *   rows off the list at once, then reads it again.
 *
 * A vanilla store, so the dialog's behaviour runs in Node against the fetch fake.
 */
import { createStore } from "zustand/vanilla";
import type {
  StorageSessionListing,
  StorageSessionRow,
  StorageSessionSort,
  StorageSessionsResponse,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";

/** Ids one batch request may name (the route's own cap). */
const BATCH_MAX = 500;

export interface SessionFilters {
  /** One Agent of one Project; null for every Agent. */
  agent: { projectId: string; agentId: string } | null;
  listing: StorageSessionListing;
  /** Last active more than this many days ago; null for any time. */
  olderThanDays: number | null;
  sort: StorageSessionSort;
}

/** Every Session, largest first: Manage chats as it opens. */
export const ALL_SESSIONS: SessionFilters = {
  agent: null,
  listing: "all",
  olderThanDays: null,
  sort: "size",
};

/** Archived and idle for a month, everything chosen: Clean up old chats as it opens. */
export const OLD_SESSIONS: SessionFilters = {
  agent: null,
  listing: "archived",
  olderThanDays: 30,
  sort: "size",
};

export interface SessionsState {
  filters: SessionFilters;
  /** The last answer; null until the first one. */
  list: StorageSessionsResponse | null;
  loading: boolean;
  /** Why the last read failed; null when it did not. */
  error: string | null;
  /** The chosen Sessions, by id. */
  selected: ReadonlySet<string>;
  /** A delete is on its way. */
  busy: boolean;
}

export interface SessionsStoreState extends SessionsState {
  /** Reads the list for `filters`; `chooseAll` chooses every row that can be chosen once it lands. */
  load: (filters: SessionFilters, options?: { chooseAll?: boolean }) => Promise<void>;
  /** Sets the choice; a running Session is never in it. */
  setSelected: (next: ReadonlySet<string>) => void;
  /** Deletes the chosen Sessions; the number deleted, or null when the server refused. */
  remove: () => Promise<number | null>;
  /** Drops the answers still on their way (the dialog is closing). */
  dispose: () => void;
}

/** A Session's size on the page: its Trace and, once measured, its scratchpad. */
export function sessionBytes(row: StorageSessionRow): number {
  return row.traceBytes + (row.scratchpadBytes ?? 0);
}

/** The chosen rows of the list on screen. */
export function chosenSessions(state: SessionsState): StorageSessionRow[] {
  return (state.list?.sessions ?? []).filter((row) => state.selected.has(row.sessionId));
}

/** The choice kept to the rows of `rows` that can be chosen. */
const choosable = (rows: readonly StorageSessionRow[], wanted: (id: string) => boolean) =>
  new Set(rows.filter((row) => !row.running && wanted(row.sessionId)).map((row) => row.sessionId));

export function createSessionsStore(
  onError: (message: string, error: unknown) => void = () => undefined,
) {
  let gen = 0;
  return createStore<SessionsStoreState>((set, get) => {
    const read = async (filters: SessionFilters, chooseAll: boolean) => {
      const g = ++gen;
      set({ filters, loading: true, error: null });
      try {
        const list = await api.listStorageSessions({
          ...(filters.agent !== null
            ? { projectId: filters.agent.projectId, agentId: filters.agent.agentId }
            : {}),
          listing: filters.listing,
          ...(filters.olderThanDays !== null ? { olderThanDays: filters.olderThanDays } : {}),
          sort: filters.sort,
        });
        if (g !== gen) return;
        const { selected } = get();
        set({
          list,
          loading: false,
          selected: choosable(list.sessions, chooseAll ? () => true : (id) => selected.has(id)),
        });
      } catch (err) {
        if (g !== gen) return;
        set({ loading: false, error: apiErrorText(err) });
      }
    };

    return {
      filters: ALL_SESSIONS,
      list: null,
      loading: false,
      error: null,
      selected: new Set(),
      busy: false,

      load: (filters, options) => read(filters, options?.chooseAll === true),

      setSelected: (next) =>
        set({ selected: choosable(get().list?.sessions ?? [], (id) => next.has(id)) }),

      remove: async () => {
        const ids = chosenSessions(get()).map((row) => row.sessionId);
        if (ids.length === 0) return null;
        set({ busy: true });
        let done = 0;
        const gone = new Set<string>();
        try {
          for (let i = 0; i < ids.length; i += BATCH_MAX) {
            const part = ids.slice(i, i + BATCH_MAX);
            const answer = await api.deleteSessions({ sessionIds: part });
            done += answer.done;
            for (const id of part) gone.add(id);
          }
          return done;
        } catch (err) {
          onError(apiErrorText(err), err);
          return done > 0 ? done : null;
        } finally {
          // What was sent is off the list at once; the read below is the server's word on the rest.
          const list = get().list;
          if (list !== null && gone.size > 0) {
            set({
              list: { ...list, sessions: list.sessions.filter((row) => !gone.has(row.sessionId)) },
              selected: new Set([...get().selected].filter((id) => !gone.has(id))),
            });
          }
          set({ busy: false });
          await read(get().filters, false);
        }
      },

      dispose: () => {
        gen += 1;
      },
    };
  });
}

export type SessionsStore = ReturnType<typeof createSessionsStore>;
