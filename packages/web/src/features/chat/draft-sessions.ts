/**
 * Parked draft conversations ("email drafts" for new chats), localStorage-backed like the
 * active draft cache (draft-cache.ts) and keyed per "user × Project" (#68 — same
 * cross-account isolation).
 *
 * Clicking "New chat" while the ACTIVE new-chat draft holds typed text no longer leaves
 * that text invisibly parked in the cache: parkActiveDraft moves it into this list, the
 * sidebar shows it as a draft conversation row (route `/chat/<draft-id>`), and opening
 * the row resumes the full draft — selections included — ready to send anytime. Sending
 * or deleting removes the entry; the ACTIVE draft slot (draftKey) keeps only the model
 * carry-over, so the next new chat starts empty on the same model
 * (switch-becomes-default, exactly like a successful send).
 *
 * Ids are `draft-<8 hex>`: real Session ids start with `session-` and the new-chat route
 * uses the literal `new`, so the chat route dispatches on the prefix alone.
 *
 * The in-memory copy is a module-level store so the sidebar list
 * and the draft page react to every mutation in this tab; parseDraft validates each
 * entry's content field-by-field on load, exactly like the caches it mirrors.
 */
import { useStore } from "zustand/react";
import { createStore } from "zustand/vanilla";
import { clearDraft, draftFromUnknown, draftKey, loadDraft, saveDraft } from "./draft-cache";
import type { DraftCache, DraftStorage } from "./draft-cache";

export interface DraftSessionEntry {
  /** Route id (`draft-<8 hex>`). */
  id: string;
  /** Park time (ISO) — the list's stable sort key; content edits don't reorder rows. */
  savedAt: string;
  draft: DraftCache;
}

/** Storage key for one user × Project's parked drafts (a JSON array of entries). */
export const draftSessionsKey = (userId: string, projectId: string): string =>
  `penguin.chatDrafts.${userId}.${projectId}`;

/** Newest-first cap: localStorage is shared budget, and fifty abandoned drafts is already hoarding. */
const MAX_DRAFTS = 50;

/**
 * Fired (synchronously) by parkActiveDraft before it reads the active cache: a mounted
 * draft page flushes its debounce-pending text on this event, so the park never captures
 * a keystroke-stale cache and the page's unmount flush never resurrects parked text.
 */
export const DRAFT_FLUSH_EVENT = "penguin:draft-flush";

function parseEntries(raw: string | null): DraftSessionEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: DraftSessionEntry[] = [];
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) continue;
      const o = item as Record<string, unknown>;
      if (typeof o.id !== "string" || !o.id.startsWith("draft-")) continue;
      out.push({
        id: o.id,
        savedAt: typeof o.savedAt === "string" ? o.savedAt : "",
        draft: draftFromUnknown(o.draft),
      });
    }
    return out;
  } catch {
    return [];
  }
}

// —— Module-level store: storage key → entries, every subscriber re-renders on change ——

// The Map doubles as the lazy parse cache: readEntries seeds a missing key IN PLACE (no new
// reference, no notification — it may run inside a render via useDraftSessions' selector),
// while writeEntries swaps in a new Map so subscribers are notified.
const draftsStore = createStore<{ cache: Map<string, DraftSessionEntry[]> }>(() => ({
  cache: new Map(),
}));
const EMPTY: DraftSessionEntry[] = [];

function storageOf(injected?: DraftStorage): DraftStorage | null {
  if (injected) return injected;
  try {
    return localStorage;
  } catch {
    return null; // No storage at all (privacy mode edge): drafts silently disabled.
  }
}

function readEntries(key: string, storage?: DraftStorage): DraftSessionEntry[] {
  const { cache } = draftsStore.getState();
  const hit = cache.get(key);
  if (hit) return hit;
  const s = storageOf(storage);
  let entries: DraftSessionEntry[] = EMPTY;
  if (s) {
    try {
      entries = parseEntries(s.getItem(key));
    } catch {
      entries = EMPTY;
    }
  }
  cache.set(key, entries);
  return entries;
}

function writeEntries(key: string, entries: DraftSessionEntry[], storage?: DraftStorage): void {
  const s = storageOf(storage);
  if (s) {
    try {
      if (entries.length === 0) s.removeItem(key);
      else s.setItem(key, JSON.stringify(entries));
    } catch {
      // Quota/private mode: the in-memory copy still serves this tab.
    }
  }
  draftsStore.setState((prev) => ({ cache: new Map(prev.cache).set(key, entries) }));
}

/** Reactive list of a user × Project's parked drafts, newest first (EMPTY constant when signed out / none). */
export function useDraftSessions(
  userId: string | null,
  projectId: string | null,
): DraftSessionEntry[] {
  return useStore(draftsStore, () =>
    userId && projectId ? readEntries(draftSessionsKey(userId, projectId)) : EMPTY,
  );
}

const randomDraftId = (): string => `draft-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;

/**
 * Moves the ACTIVE new-chat draft into the parked list when it holds typed text;
 * returns the new entry's id, or null when there was nothing worth parking. The active
 * slot keeps only the model carry-over (mirroring discardDraft on a successful send).
 * Dispatches DRAFT_FLUSH_EVENT first so a mounted draft page's debounce-pending
 * keystrokes reach the cache before it is read.
 */
export function parkActiveDraft(
  userId: string,
  projectId: string,
  storage?: DraftStorage,
): string | null {
  if (!storage && typeof window !== "undefined") {
    window.dispatchEvent(new Event(DRAFT_FLUSH_EVENT));
  }
  const activeKey = draftKey(userId, projectId);
  // A defaulted parameter only evaluates `localStorage` when the argument is undefined,
  // which never happens outside a browser (tests always inject a storage).
  const draft = loadDraft(activeKey, storage);
  if (!draft.text || draft.text.trim() === "") return null;
  const key = draftSessionsKey(userId, projectId);
  const entry: DraftSessionEntry = {
    id: randomDraftId(),
    savedAt: new Date().toISOString(),
    draft,
  };
  writeEntries(key, [entry, ...readEntries(key, storage)].slice(0, MAX_DRAFTS), storage);
  if (draft.modelRef) saveDraft(activeKey, { modelRef: draft.modelRef }, storage);
  else clearDraft(activeKey, storage);
  return entry.id;
}

/** One parked entry by id, or null. */
export function getDraftSession(
  userId: string,
  projectId: string,
  id: string,
  storage?: DraftStorage,
): DraftSessionEntry | null {
  return readEntries(draftSessionsKey(userId, projectId), storage).find((e) => e.id === id) ?? null;
}

/** Replaces a parked entry's content in place (savedAt untouched — edits don't reorder the list). Unknown ids are a no-op: the entry was deleted elsewhere. */
export function saveDraftSession(
  userId: string,
  projectId: string,
  id: string,
  draft: DraftCache,
  storage?: DraftStorage,
): void {
  const key = draftSessionsKey(userId, projectId);
  const entries = readEntries(key, storage);
  if (!entries.some((e) => e.id === id)) return;
  writeEntries(
    key,
    entries.map((e) => (e.id === id ? { ...e, draft } : e)),
    storage,
  );
}

/** Drops a parked entry (sent or deleted). Idempotent. */
export function removeDraftSession(
  userId: string,
  projectId: string,
  id: string,
  storage?: DraftStorage,
): void {
  const key = draftSessionsKey(userId, projectId);
  const entries = readEntries(key, storage);
  if (!entries.some((e) => e.id === id)) return;
  writeEntries(
    key,
    entries.filter((e) => e.id !== id),
    storage,
  );
}

/** Row title: the first non-empty line of the draft text, capped (the row truncates further via CSS). */
export function draftSessionTitle(entry: DraftSessionEntry): string {
  const line = (entry.draft.text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "");
  return (line ?? "").slice(0, 80);
}
