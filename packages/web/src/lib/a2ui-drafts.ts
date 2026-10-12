/**
 * The open question's answers in progress, kept in this browser: a reply's form half filled in,
 * or a multi-select choice half ticked, comes back after a reload or a visit to another
 * conversation.
 *
 * The UI package decides what an entry holds and when it is read or written (its a2ui draft.ts);
 * this is only where entries live. A key is `penguin.a2uiDraft.<Session id>:<block hash>` and a
 * value `{ v: 1, at, state }`, `at` the time of the write in ms.
 *
 * A draft is a convenience, not a record. It is per browser, an entry a week old is dropped when
 * it is read, and every write keeps only the newest fifty entries, so answers left in
 * conversations nobody returns to do not pile up. Storage is best-effort in both directions: a
 * private window, blocked site data or a full quota turn every write into a no-op and every read
 * into nothing, and the form starts blank, as it did before drafts.
 */
import type { A2uiDrafts } from "@prismshadow/penguin-ui";

const PREFIX = "penguin.a2uiDraft.";

/** How long an entry lasts after its last write. */
export const A2UI_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Entries kept at most: a write drops the oldest beyond this. */
export const A2UI_DRAFT_LIMIT = 50;

interface Entry {
  v: 1;
  at: number;
  state: unknown;
}

/** The entry `raw` holds, or null when it is missing, malformed, of another version, or expired. */
function liveEntry(raw: string | null, now: number): Entry | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const entry = parsed as Partial<Entry>;
  if (entry.v !== 1 || typeof entry.at !== "number" || !Number.isFinite(entry.at)) return null;
  if (now - entry.at > A2UI_DRAFT_MAX_AGE_MS) return null;
  return entry as Entry;
}

/** Drops every dead entry, then all but the newest {@link A2UI_DRAFT_LIMIT}. */
function prune(now: number): void {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key !== null && key.startsWith(PREFIX)) keys.push(key);
  }
  const live: { key: string; at: number }[] = [];
  for (const key of keys) {
    const entry = liveEntry(localStorage.getItem(key), now);
    if (entry === null) localStorage.removeItem(key);
    else live.push({ key, at: entry.at });
  }
  live.sort((a, b) => b.at - a.at);
  for (const { key } of live.slice(A2UI_DRAFT_LIMIT)) localStorage.removeItem(key);
}

function load(key: string): unknown {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    const entry = liveEntry(raw, Date.now());
    if (entry === null && raw !== null) localStorage.removeItem(PREFIX + key);
    return entry?.state;
  } catch {
    return undefined;
  }
}

function save(key: string, state: unknown): void {
  try {
    const entry: Entry = { v: 1, at: Date.now(), state };
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
    prune(entry.at);
  } catch {
    // Storage refused or is full: the answers are merely not kept past this page.
  }
}

function clear(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // Storage refused: nothing was kept to remove.
  }
}

/** The store the chat page hands the open question's blocks. */
export const a2uiDrafts: A2uiDrafts = { load, save, clear };
