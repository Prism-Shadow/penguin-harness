/**
 * One small read cache for every per-machine read in the Web App: a machine's Agent list, an
 * Agent's installed plugins, the modules a machine runs.
 *
 * A machine answers slowly, sometimes not at all, and its link flips while it is being brought
 * back. Pages that each kept their own answers asked it again on every mount and every flip, and
 * dropped what they knew in between — every status word, count and card went to a placeholder
 * and came back, which reads as the data changing when it did not. So the answers live here,
 * keyed by what they are about (`readKey`: the Project, the server, the object), and every reader
 * of a key shares them:
 *
 * - **One read per key in flight.** A second reader joins the read already asked; the answer
 *   that lands is the one the newest ask started, never a late one from before it.
 * - **The last answer stands.** A read in flight, a read that fails, a reader that stops reading
 *   (its machine went out of reach) change nothing about the value: the failure is reported
 *   beside it. Only an answer replaces it, and an answer equal to it keeps the very same object,
 *   so a consumer memoised on it does not re-render, reorder or re-derive.
 * - **Remembered when a storage is given.** The value loads from it the first time a key is
 *   read here (as not `fresh`), and every applied answer is written back. Storage is best-effort
 *   both ways: refused, full or holding something that no longer parses, it reads as nothing.
 * - **Invalidation, not polling.** A write marks the key `stale` (or hands its answer to
 *   `accept`); readers on screen read again at once, a reader mounting later reads on mount.
 *
 * `use-project-todos.ts` has the same shape for one pair of probes, `use-fresh-read.ts` for one
 * key without sharing; this is the general form, without a library.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { apiErrorText } from "./api-error";

export interface ReadState<T> {
  /** The last answer — from this page load or from storage; null when nothing is known. */
  value: T | null;
  /** When `value` was answered (ms since epoch); null without an answer in this page load. */
  at: number | null;
  /** `value` came from an answer in this page load, not from storage. */
  fresh: boolean;
  /** Marked by `invalidate`: a reader mounting reads again; `value` stands meanwhile. */
  stale: boolean;
  reading: boolean;
  /** The last read's failure in words; null when it answered. `value` stands. */
  error: string | null;
}

export interface ReadStorage<T> {
  load(key: string): T | null;
  save(key: string, value: T): void;
  clear(key: string): void;
}

export interface ReadStore<T> {
  get(key: string): ReadState<T>;
  subscribe(key: string, listener: () => void): () => void;
  /** One read per key in flight (a second caller joins it); the answer applies only while it is the newest ask for that key. */
  read(key: string, run: () => Promise<T>): Promise<void>;
  /** Takes an answer a write already brought (an install's response); outdates any read in flight. */
  accept(key: string, value: T): void;
  /** `stale = true`; readers re-read; nothing shown changes. */
  invalidate(key: string): void;
  forget(key: string): void;
  /** Every key under a prefix (a Project's, a machine's), for forget/invalidate sweeps. */
  keys(prefix: string): string[];
}

/** What a key reads as before anything is known about it. One identity, frozen. */
const NOTHING: ReadState<never> = Object.freeze({
  value: null,
  at: null,
  fresh: false,
  stale: false,
  reading: false,
  error: null,
});

/** The separator between a key's parts: no id the app mints contains it. */
const SEP = "\u0000";

/** The key of a read about one Project on one server: `${projectId}\0${machineId ?? ""}\0${parts…}`. */
export function readKey(projectId: string, machineId: string | null, ...parts: string[]): string {
  return [projectId, machineId ?? "", ...parts].join(SEP);
}

const jsonEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Every store's way to drop what it holds in memory (see {@link resetReadStores}). */
const resets = new Set<() => void>();

/**
 * Drops what every store holds in memory, as a page reload would; storage is left alone, and a
 * read still in flight lands nowhere. The stores live as long as the module graph, and a test
 * file runs many page loads in one: its teardown calls this so no test starts from what the
 * previous one read.
 */
export function resetReadStores(): void {
  for (const reset of resets) reset();
}

interface Entry<T> {
  state: ReadState<T>;
  /** Asks so far: only the newest one's answer applies. */
  ask: number;
  /** The ask current when the key was last invalidated: an answer to it, or to an older one, leaves the key stale. */
  invalidatedAt: number;
  /** The newest ask's read while it is in flight and may still be joined; cleared by `invalidate`. */
  pending: Promise<void> | null;
}

export function createReadStore<T>(
  options: {
    storage?: ReadStorage<T>;
    /** Same data → the previous object is kept (identity stable, no re-render, no reorder). Default: JSON equality. */
    equal?: (a: T, b: T) => boolean;
  } = {},
): ReadStore<T> {
  const { storage, equal = jsonEqual } = options;
  const entries = new Map<string, Entry<T>>();
  const listeners = new Map<string, Set<() => void>>();
  resets.add(() => entries.clear());

  const load = (key: string): T | null => {
    if (storage === undefined) return null;
    try {
      return storage.load(key);
    } catch {
      return null;
    }
  };
  const save = (key: string, value: T): void => {
    try {
      storage?.save(key, value);
    } catch {
      // Refused or full: the answer is merely not remembered across a reload.
    }
  };

  /** The key's entry, made on first use from what storage remembers. */
  const entry = (key: string): Entry<T> => {
    let found = entries.get(key);
    if (found === undefined) {
      const stored = load(key);
      found = {
        state: stored === null ? NOTHING : { ...NOTHING, value: stored },
        ask: 0,
        invalidatedAt: 0,
        pending: null,
      };
      entries.set(key, found);
    }
    return found;
  };

  const set = (key: string, e: Entry<T>, next: ReadState<T>): void => {
    e.state = next;
    for (const listener of [...(listeners.get(key) ?? [])]) listener();
  };

  /** The value to hold for `answer`: the current object when it carries the same data. */
  const kept = (e: Entry<T>, answer: T): T =>
    e.state.value !== null && equal(e.state.value, answer) ? e.state.value : answer;

  /** Whether `e` is still the key's entry and `ask` its newest ask. */
  const owns = (key: string, e: Entry<T>, ask: number): boolean =>
    entries.get(key) === e && e.ask === ask;

  return {
    get: (key) => entry(key).state,

    subscribe: (key, listener) => {
      let group = listeners.get(key);
      if (group === undefined) {
        group = new Set();
        listeners.set(key, group);
      }
      const own = group;
      own.add(listener);
      return () => {
        own.delete(listener);
        if (own.size === 0 && listeners.get(key) === own) listeners.delete(key);
      };
    },

    read: (key, run) => {
      const e = entry(key);
      if (e.pending !== null) return e.pending;
      const ask = ++e.ask;
      if (!e.state.reading) set(key, e, { ...e.state, reading: true });
      // `run` starts a tick later, so even one that throws at once settles after `pending` is set.
      const done: Promise<void> = Promise.resolve()
        .then(run)
        .then(
          (answer) => {
            if (!owns(key, e, ask)) return;
            const value = kept(e, answer);
            save(key, value);
            set(key, e, {
              value,
              at: Date.now(),
              fresh: true,
              stale: ask <= e.invalidatedAt,
              reading: false,
              error: null,
            });
          },
          (err: unknown) => {
            if (!owns(key, e, ask)) return;
            set(key, e, { ...e.state, reading: false, error: apiErrorText(err) });
          },
        )
        .finally(() => {
          if (e.pending === done) e.pending = null;
        });
      e.pending = done;
      return done;
    },

    accept: (key, answer) => {
      const e = entry(key);
      e.ask++;
      e.pending = null;
      const value = kept(e, answer);
      save(key, value);
      set(key, e, {
        value,
        at: Date.now(),
        fresh: true,
        stale: false,
        reading: false,
        error: null,
      });
    },

    invalidate: (key) => {
      const e = entry(key);
      e.invalidatedAt = e.ask;
      // A read asked before the write may carry what the write replaced: the next read starts
      // its own instead of joining it, and outdates it.
      e.pending = null;
      if (!e.state.stale) set(key, e, { ...e.state, stale: true });
    },

    forget: (key) => {
      try {
        storage?.clear(key);
      } catch {
        // Refused: what was remembered is gone from this page load all the same.
      }
      // A fresh entry, so a read still in flight finds it is no longer the key's and drops its answer.
      const e: Entry<T> = { state: NOTHING, ask: 0, invalidatedAt: 0, pending: null };
      entries.set(key, e);
      set(key, e, NOTHING);
    },

    keys: (prefix) =>
      [...entries.keys()].filter((key) => key === prefix || key.startsWith(prefix + SEP)),
  };
}

export interface UseReadOptions {
  /** False: no read is made (the machine is not connected); the state is returned as it stands. */
  enabled?: boolean;
  /** A value answered more recently than this is not read again on mount (StrictMode, back-and-forth). Default 2000. */
  minAgeMs?: number;
}

/** One key a component reads, for {@link useReads}. */
export interface ReadRequest<T> {
  key: string;
  run: () => Promise<T>;
  /** False: no read is made; the state is returned as it stands. Default true. */
  enabled?: boolean;
}

const DEFAULT_MIN_AGE_MS = 2000;

/** Whether `state` was answered in this page load less than `minAgeMs` ago, and not invalidated since. */
const recent = (state: ReadState<unknown>, minAgeMs: number): boolean =>
  !state.stale && state.fresh && state.at !== null && Date.now() - state.at < minAgeMs;

/**
 * {@link useRead} for a list of keys whose length varies (one per machine, one per Agent): each
 * key is read when it first appears or turns enabled — a key read already is not asked again
 * because a neighbour arrived — and whenever it is marked stale. The states come back in the
 * requests' order, as one array that keeps its identity until one of them changes.
 */
export function useReads<T>(
  store: ReadStore<T>,
  requests: readonly ReadRequest<T>[],
  { minAgeMs = DEFAULT_MIN_AGE_MS }: { minAgeMs?: number } = {},
): readonly ReadState<T>[] {
  const keys = requests.map((r) => r.key);
  /** The keys as one string: an unchanged set keeps the subscription and the effects still. */
  const keysId = JSON.stringify(keys);
  /** The newest closure per key: what a read started by an effect runs. */
  const runs = useRef(new Map<string, () => Promise<T>>());
  runs.current = new Map(requests.map((r) => [r.key, r.run]));
  const runOf = (key: string) => () => runs.current.get(key)!();

  const subscribe = useCallback(
    (listener: () => void) => {
      const offs = (JSON.parse(keysId) as string[]).map((key) => store.subscribe(key, listener));
      return () => {
        for (const off of offs) off();
      };
    },
    [store, keysId],
  );
  /** The last array handed out: returned again while every state in it is the same object. */
  const last = useRef<readonly ReadState<T>[]>([]);
  const snapshot = (): readonly ReadState<T>[] => {
    const next = keys.map((key) => store.get(key));
    const prev = last.current;
    if (prev.length === next.length && prev.every((state, i) => state === next[i])) return prev;
    last.current = next;
    return next;
  };
  const states = useSyncExternalStore(subscribe, snapshot, snapshot);

  /** The enabled keys as last read for: one enabled again after a pause is read again. */
  const asked = useRef(new Set<string>());
  const enabledId = JSON.stringify(requests.filter((r) => r.enabled !== false).map((r) => r.key));
  useEffect(() => {
    const enabled = new Set(JSON.parse(enabledId) as string[]);
    for (const key of enabled) {
      if (asked.current.has(key) || recent(store.get(key), minAgeMs)) continue;
      void store.read(key, runOf(key));
    }
    asked.current = enabled;
    // `runOf` reads the ref; what is read is named by the keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, enabledId, minAgeMs]);

  /** The stale keys as last read for: a key is read again each time it turns stale. */
  const staleAsked = useRef(new Set<string>());
  const staleId = JSON.stringify(
    requests.filter((r, i) => r.enabled !== false && states[i]?.stale === true).map((r) => r.key),
  );
  useEffect(() => {
    const stale = new Set(JSON.parse(staleId) as string[]);
    for (const key of stale) {
      if (!staleAsked.current.has(key)) void store.read(key, runOf(key));
    }
    staleAsked.current = stale;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, staleId]);

  return states;
}

/** Subscribes to `key` and reads it on mount, on key change, on `enabled` turning true, and when stale — stale-while-revalidate. `key` null: nothing. */
export function useRead<T>(
  store: ReadStore<T>,
  key: string | null,
  run: () => Promise<T>,
  options: UseReadOptions = {},
): ReadState<T> {
  const states = useReads(
    store,
    key === null ? [] : [{ key, run, enabled: options.enabled ?? true }],
    options.minAgeMs === undefined ? {} : { minAgeMs: options.minAgeMs },
  );
  return states[0] ?? NOTHING;
}
