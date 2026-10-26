/**
 * Notices a person closed, remembered per account (`ui_prefs.noticesDismissed`): each notice id
 * maps to the SIGNATURE of what the notice was about when it was closed — the set of things it
 * named — so it stays closed while everything it would name now was already waved away, and
 * comes back the moment something new appears. It is the rule the to-do markers follow
 * (todo-dismissals.ts), for notices that are about a set of things rather than a trail; the
 * initial-password banner keeps its own flag (`initialPasswordBannerDismissed`), which is about
 * one thing and is stored as it always was.
 *
 * Per account, not per browser, for the to-do markers' reason: what one person has read says
 * nothing about another on a shared workstation, and the same person on a second device should
 * not have to close it twice.
 *
 * `PUT /me/prefs` merges only at the top level, so the whole map is written, composed from the
 * last successful read or write, and the writes are serialized. Until the read lands a notice's
 * state is unknown (`null`) and the caller keeps it off screen, so a closed notice never flashes
 * in before going away; a read that fails opens every notice (fail-open, the banner's choice),
 * and closing one then hides it for this tab without writing a map that was never read.
 */
import { useEffect } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand/react";
import * as api from "../api/endpoints";

/** The `ui_prefs` key the whole map is stored under. */
export const NOTICE_PREFS_KEY = "noticesDismissed";

/** Notice id → the signature it was closed at. */
export type NoticeDismissMap = Record<string, string>;

/** The signature of what a notice names: its items, sorted and de-duplicated, one per line. */
export function noticeSignature(items: readonly string[]): string {
  return [...new Set(items)].sort().join("\n");
}

/** Reads the map out of the free-form prefs blob; anything malformed reads as nothing closed. */
export function parseNoticeDismissMap(raw: unknown): NoticeDismissMap {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: NoticeDismissMap = {};
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value === "string") out[id] = value;
  }
  return out;
}

/** Whether a notice closed at `signature` stays closed over `items`: none of them is new. */
export function coveredBy(signature: string | undefined, items: readonly string[]): boolean {
  if (signature === undefined) return false;
  const closed = new Set(signature === "" ? [] : signature.split("\n"));
  return items.every((item) => closed.has(item));
}

/** The whole map after closing `id` over `items` (pure; the caller persists it). */
export function withNoticeDismissed(
  map: NoticeDismissMap,
  id: string,
  items: readonly string[],
): NoticeDismissMap {
  return { ...map, [id]: noticeSignature(items) };
}

/** The id of a machine's "model keys from this server's environment" notice. */
export const envOnlyNoticeId = (machineId: string): string => `machine-env-only:${machineId}`;

/**
 * The id of a machine's "models not synced to this machine" notice, per Project: the list holds
 * that Project's entries only, so closing it in one Project leaves another Project's list alone.
 */
export const skippedNoticeId = (machineId: string, projectId: string): string =>
  `machine-skipped:${machineId}:${projectId}`;

interface NoticeStore {
  /** The stored map; null until read. */
  map: NoticeDismissMap | null;
  /** The read failed: notices open (fail-open). */
  unreadable: boolean;
  /** Closed in this tab, persisted or not. */
  local: NoticeDismissMap;
}

const store = createStore<NoticeStore>(() => ({ map: null, unreadable: false, local: {} }));

let reading = false;

function hydrate(): void {
  if (reading || store.getState().map !== null) return;
  reading = true;
  void api
    .getPrefs()
    .then(({ prefs }) => {
      store.setState({ map: parseNoticeDismissMap(prefs[NOTICE_PREFS_KEY]), unreadable: false });
    })
    .catch(() => {
      // Open every notice, and let a later mount read again.
      store.setState({ unreadable: true });
      reading = false;
    });
}

let saving: Promise<void> = Promise.resolve();

/** Closes a notice over its items: at once in this tab, and in the account once written. */
export function dismissNotice(id: string, items: readonly string[]): void {
  store.setState((s) => ({ local: withNoticeDismissed(s.local, id, items) }));
  saving = saving
    .then(async () => {
      const map = store.getState().map;
      // Never write a map that was not read: it would reopen every other closed notice.
      if (map === null || coveredBy(map[id], items)) return;
      const next = withNoticeDismissed(map, id, items);
      await api.putPrefs({ [NOTICE_PREFS_KEY]: next });
      store.setState({ map: next });
    })
    // A lost write costs only persistence: the notice is already closed in this tab.
    .catch(() => undefined);
}

/**
 * Whether the notice `id` about `items` is closed: true or false once known, null while the
 * account's map is still being read. Reading starts on first use.
 */
export function useNoticeDismissed(id: string, items: readonly string[]): boolean | null {
  useEffect(() => {
    hydrate();
  }, []);
  return useStore(store, (s) => {
    if (coveredBy(s.local[id], items)) return true;
    if (s.map === null) return s.unreadable ? false : null;
    return coveredBy(s.map[id], items);
  });
}
