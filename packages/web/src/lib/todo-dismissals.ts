/**
 * "I have dealt with this" markers for the four dismissible badge trails, per Project.
 *
 * What is stored is not a hidden flag but the SIGNATURE the trail carried when it was
 * dismissed (`todo-badges.ts` explains why): the badge stays down while what is waiting is
 * still contained in what the user waved away, and anything new raises it again.
 *
 * **Per account, not per browser.** A marker says what one PERSON has already looked at, so
 * `localStorage` would be wrong in both directions: on a shared workstation the owner's
 * dismissal would put the dots down for a member who was never shown what was waiting, and the
 * same user on a second device would keep clearing a dot they had already cleared. The markers
 * therefore live in `ui_prefs` under `todoDismissed`, following the precedent
 * `initialPasswordBannerDismissed` set (app-layout.tsx) — the store is free-form JSON, so this
 * needs no schema or API change — and reloading any tab picks up what another one dismissed.
 *
 * `PUT /me/prefs` merges only at the TOP level, which is why the store holds every Project's
 * markers and writes the whole map: sending one Project's slice would drop the others.
 *
 * Until that read lands the map is `null` and every trail reads as down. That is the same
 * fail-soft direction the probes take (`use-project-todos.ts`) — an unreachable read leaves
 * the gate closed and says nothing — and it also keeps a dot from appearing on load only to
 * disappear a moment later.
 */
import { useEffect } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand/react";
import * as api from "../api/endpoints";
import type { TodoKey } from "./todo-badges";

/** The `ui_prefs` key the whole map is stored under. */
export const TODO_PREFS_KEY = "todoDismissed";

/** One Project's markers: the dismissed signature per trail, absent where nothing was dismissed. */
export type TodoDismissals = Partial<Record<TodoKey, string>>;

/** Every Project's markers, keyed by Project id — the shape held under {@link TODO_PREFS_KEY}. */
export type TodoDismissMap = Record<string, TodoDismissals>;

/**
 * The four keys, listed once so parsing cannot drift from the union.
 *
 * A stored map written before a key existed simply has no such key — `agents` was added late,
 * and `plugins` replaced `skills` when the library became a plugin library — and
 * {@link parseTodoDismissMap} reads that as "nothing dismissed", which shows a dot the user can
 * clear again. That is the same direction every other malformed case degrades in, so the markers
 * already on disk need no migration and nothing is lost by an older client writing the map back
 * without it (a stale `skills` marker rides along unread until a newer write drops it).
 */
const TODO_KEYS: readonly TodoKey[] = ["agents", "plugins", "models", "errors"];

const EMPTY: TodoDismissals = {};

/**
 * Reads the markers out of the free-form prefs blob. Anything malformed degrades to "nothing
 * dismissed", which shows a dot the user can clear again — the failure direction that loses no
 * information. Non-string values are dropped per key rather than failing the whole record: a
 * signature is always a string, and one bad key must not resurrect the other two trails' dots.
 */
export function parseTodoDismissMap(raw: unknown): TodoDismissMap {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: TodoDismissMap = {};
  for (const [projectId, value] of Object.entries(raw)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const record: TodoDismissals = {};
    for (const key of TODO_KEYS) {
      const signature = (value as Record<string, unknown>)[key];
      if (typeof signature === "string") record[key] = signature;
    }
    out[projectId] = record;
  }
  return out;
}

/** The whole map after dismissing one Project's trail at `signature` (pure; the caller persists it). */
export function withDismissal(
  map: TodoDismissMap,
  projectId: string,
  key: TodoKey,
  signature: string,
): TodoDismissMap {
  return { ...map, [projectId]: { ...(map[projectId] ?? EMPTY), [key]: signature } };
}

// —— Module-level store: one read per browser session, every subscriber re-renders on change ——

/** `null` until the stored markers arrive; every trail reads as down while it is. */
const dismissStore = createStore<{ map: TodoDismissMap | null }>(() => ({ map: null }));

let hydrating = false;

function hydrate(): void {
  if (hydrating || dismissStore.getState().map !== null) return;
  hydrating = true;
  void api
    .getPrefs()
    .then(({ prefs }) => {
      dismissStore.setState({ map: parseTodoDismissMap(prefs[TODO_PREFS_KEY]) });
    })
    .catch(() => {
      // Left unhydrated on purpose, so a later mount retries: writing an empty map here would
      // both raise every dot and let the next dismissal overwrite the Projects it never read.
      hydrating = false;
    });
}

/**
 * Reactive read of one Project's markers, or `null` while they are unknown.
 *
 * `eager` marks the single owner that actually reads them — `AppLayout`, through
 * `use-update-badges.ts`, the same owner that activates the probes. Every other anchor passes
 * false and is pushed the result when it lands.
 */
export function useTodoDismissals(projectId: string | null, eager = false): TodoDismissals | null {
  useEffect(() => {
    if (eager) hydrate();
  }, [eager]);
  return useStore(dismissStore, (s) =>
    s.map === null || projectId === null ? null : (s.map[projectId] ?? EMPTY),
  );
}

/** Dismisses one trail at the signature it is showing right now, and persists it (best-effort). */
export function dismissTodo(projectId: string | null, key: TodoKey, signature: string): void {
  if (projectId === null) return;
  const { map } = dismissStore.getState();
  // No markers means no dot was raised, so there is nothing to wave away — and writing now
  // would persist a map missing every Project this session never read.
  if (map === null) return;
  if (map[projectId]?.[key] === signature) return; // No-op: skip the write and the re-render.
  const next = withDismissal(map, projectId, key, signature);
  dismissStore.setState({ map: next });
  // Fire-and-forget, the initial-password banner's pattern: a lost write only costs
  // persistence, the dot is already down in this tab.
  void api.putPrefs({ [TODO_PREFS_KEY]: next }).catch(() => undefined);
}
