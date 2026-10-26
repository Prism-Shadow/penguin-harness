/**
 * Keeping this browser's cache (cache.ts) and the account's copy on the server in step: the
 * Settings pages' preferences (prefs.ts) and the unsent drafts (drafts.ts).
 *
 * THE ACCOUNT IS THE TRUTH; THE CACHE IS FOR THE FIRST FRAME. On sign-in — a page load with a
 * session, or a login — {@link startAccountSync} reads the account's preferences and drafts and
 * writes them into the cache before the signed-in app renders (the auth provider waits for it),
 * so the theme does not flash and every composer mounts with the account's draft. The wait is
 * bounded: past {@link SYNC_WAIT_MS} the app renders from the cache as it stands, and drafts that
 * arrive later are not applied over composers already on screen (preferences still are: their
 * providers re-read). From then on an edit is written to the cache at once — typing never waits
 * on the network — and carried to the account a moment later, batched; the last write wins.
 *
 * AN EDIT THE ACCOUNT HAS NOT ACKNOWLEDGED IS PENDING, and pending survives a reload: its name is
 * journaled in the cache (`penguin.syncPending.<user>`), so the next sign-in keeps the cached
 * value instead of overwriting it with the account's older one, and sends it again. That is what
 * makes "the account wins" safe offline, across a crash, and for a draft too large for the
 * account (which stays pending, and so stays in the one browser it was typed in).
 *
 * THE ONE-TIME IMPORT. Before this, preferences and drafts lived only in the browser. The first
 * sign-in on a browser after the upgrade hands them to the account: its preferences when the
 * account holds none yet (marker `penguin.prefsImported`, one per browser, so a second account
 * signing in on the same browser never receives the first one's), and the user's drafts the
 * account does not have (marker `penguin.draftsImported.<user>`). Both markers are install-scoped
 * (lib/install-scope.ts), so a browser pointed at a wiped data root imports again rather than
 * resetting everything to defaults. Remove the import — the two markers, `importing` in
 * prefs.ts and drafts.ts, and their tests — in 0.3.0 (changelog
 * 2026-10-26-backward-compatibility).
 */
import type { UiPrefs } from "@prismshadow/penguin-server/api";
import { DRAFTS_PATCH_MAX_ENTRIES, DRAFT_VALUE_MAX_CHARS } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { noteAccountApplied, subscribeCachedWrites } from "./cache";
import { accountKeyOf, accountValueOf, cacheKeyOf, planDrafts } from "./drafts";
import {
  BACKGROUND_IMAGE,
  BACKGROUND_IMAGE_ID_KEY,
  BACKGROUND_IMAGE_KEY,
  SYNCED_PREFS,
  pendingPrefOfKey,
  planPrefs,
} from "./prefs";
import type { PendingPref } from "./prefs";

/** How long the signed-in app waits for the account before it renders from the cache. */
export const SYNC_WAIT_MS = 3000;
/** How long a preference edit waits for company before it is sent. */
export const PREF_FLUSH_MS = 400;
/** How long a draft edit waits for company: drafts change as fast as someone types. */
export const DRAFT_FLUSH_MS = 1000;
/** Retry delays after a send that did not reach the account, longest last and then repeated. */
const RETRY_MS = [5000, 30000, 120000] as const;

/** This browser has handed its preferences to an account on this data root. */
export const PREFS_IMPORTED_KEY = "penguin.prefsImported";
/** This browser has handed `userId`'s drafts to their account on this data root. */
export const draftsImportedKey = (userId: string): string => `penguin.draftsImported.${userId}`;
/** `userId`'s edits the account has not acknowledged yet. */
export const syncPendingKey = (userId: string): string => `penguin.syncPending.${userId}`;

interface SyncState {
  userId: string;
  /** Names with an unacknowledged edit: preference fields, and the account's draft keys. */
  prefs: Set<PendingPref>;
  drafts: Set<string>;
  /** Edits per name, so a send only clears what it carried (an edit during the send stays pending). */
  edits: Map<string, number>;
  /** Whether drafts that arrive now may still be written into the cache (before the app renders). */
  draftsOpen: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  dueAt: number;
  sending: Promise<void> | null;
  again: boolean;
  failures: number;
}

let state: SyncState | null = null;
/**
 * Preferences changed while nobody was signed in — the language or the theme picked on the login
 * page. Whoever signs in next made that choice, so it becomes their pending edit.
 */
const signedOutEdits = new Set<PendingPref>();

// ----------------------------------------------------------------- raw cache access
// The account's values go into the cache through these, never through cache.ts: a value that
// came from the account must not be reported back to it as an edit.

function rawGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function rawSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Quota or blocked site data: the cache misses this value and the next sign-in tries again.
  }
}

/** Every cached key and its value. */
function cachedEntries(): Map<string, string> {
  const out = new Map<string, string>();
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      const value = key === null ? null : localStorage.getItem(key);
      if (key !== null && value !== null) out.set(key, value);
    }
  } catch {
    // Unreadable store: nothing cached.
  }
  return out;
}

// ------------------------------------------------------------------------ the journal

function readJournal(userId: string): { prefs: PendingPref[]; drafts: string[] } {
  try {
    const parsed = JSON.parse(rawGet(syncPendingKey(userId)) ?? "null") as unknown;
    if (typeof parsed !== "object" || parsed === null) return { prefs: [], drafts: [] };
    const { prefs, drafts } = parsed as { prefs?: unknown; drafts?: unknown };
    const strings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    const known = new Set<string>([BACKGROUND_IMAGE, ...SYNCED_PREFS.map((p) => p.field)]);
    return {
      prefs: strings(prefs).filter((p): p is PendingPref => known.has(p)),
      drafts: strings(drafts),
    };
  } catch {
    return { prefs: [], drafts: [] };
  }
}

function writeJournal(s: SyncState): void {
  rawSet(
    syncPendingKey(s.userId),
    s.prefs.size === 0 && s.drafts.size === 0
      ? null
      : JSON.stringify({ prefs: [...s.prefs], drafts: [...s.drafts] }),
  );
}

// ---------------------------------------------------------------------------- edits

function markEdit(s: SyncState, name: string): void {
  s.edits.set(name, (s.edits.get(name) ?? 0) + 1);
}

/** A user edit of a cached key: track it and schedule the send. */
function onCachedWrite(key: string): void {
  const pref = pendingPrefOfKey(key);
  if (pref !== null) {
    // A new image makes the cached id a lie until the account answers with the new one.
    if (pref === BACKGROUND_IMAGE) rawSet(BACKGROUND_IMAGE_ID_KEY, null);
    if (state === null) {
      signedOutEdits.add(pref);
      return;
    }
    state.prefs.add(pref);
    markEdit(state, `p:${pref}`);
    writeJournal(state);
    schedule(state, PREF_FLUSH_MS);
    return;
  }
  if (state === null) return;
  const draftKey = accountKeyOf(key, state.userId);
  if (draftKey === null) return;
  state.drafts.add(draftKey);
  markEdit(state, `d:${draftKey}`);
  writeJournal(state);
  schedule(state, DRAFT_FLUSH_MS);
}

subscribeCachedWrites(onCachedWrite);

function schedule(s: SyncState, delayMs: number): void {
  const due = Date.now() + delayMs;
  if (s.timer !== null && s.dueAt <= due) return;
  if (s.timer !== null) clearTimeout(s.timer);
  s.dueAt = due;
  s.timer = setTimeout(() => {
    s.timer = null;
    void send(s);
  }, delayMs);
}

// ----------------------------------------------------------------------------- sending

/** Whether a refusal says the request itself is wrong, so sending it again cannot help. */
function refusedForGood(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status >= 400 &&
    err.status < 500 &&
    ![401, 408, 409, 429].includes(err.status)
  );
}

/** Clears the names a successful send carried, unless they were edited again meanwhile. */
function settle(s: SyncState, sent: ReadonlyMap<string, number>): void {
  for (const [name, edits] of sent) {
    if ((s.edits.get(name) ?? 0) !== edits) continue;
    if (name.startsWith("p:")) s.prefs.delete(name.slice(2) as PendingPref);
    else s.drafts.delete(name.slice(2));
  }
  writeJournal(s);
}

async function sendPrefs(s: SyncState): Promise<void> {
  const fields = [...s.prefs].filter((f) => f !== BACKGROUND_IMAGE);
  if (fields.length > 0) {
    const sent = new Map(fields.map((f) => [`p:${f}`, s.edits.get(`p:${f}`) ?? 0]));
    const patch: Record<string, unknown> = {};
    for (const pref of SYNCED_PREFS) {
      if (!fields.includes(pref.field)) continue;
      const cached = rawGet(pref.key);
      // A value garbled in the cache clears the account's rather than travelling on.
      patch[pref.field] = cached === null ? null : (pref.toAccount(cached) ?? null);
    }
    try {
      await api.putPrefs(patch as UiPrefs);
      settle(s, sent);
    } catch (err) {
      if (!refusedForGood(err)) throw err;
      settle(s, sent);
    }
  }
  if (s.prefs.has(BACKGROUND_IMAGE)) {
    const sent = new Map([[`p:${BACKGROUND_IMAGE}`, s.edits.get(`p:${BACKGROUND_IMAGE}`) ?? 0]]);
    const image = rawGet(BACKGROUND_IMAGE_KEY);
    try {
      const { imageId } = await api.putBackgroundImage({ image });
      if (rawGet(BACKGROUND_IMAGE_KEY) === image) rawSet(BACKGROUND_IMAGE_ID_KEY, imageId);
      settle(s, sent);
    } catch (err) {
      if (!refusedForGood(err)) throw err;
      settle(s, sent);
    }
  }
}

async function sendDrafts(s: SyncState): Promise<void> {
  const writes: Array<[key: string, value: unknown]> = [];
  const sent = new Map<string, number>();
  for (const key of s.drafts) {
    const cacheKey = cacheKeyOf(key, s.userId);
    const cached = cacheKey === null ? null : rawGet(cacheKey);
    // Too large for the account: it stays pending, and so stays in this browser.
    if (cached !== null && cached.length > DRAFT_VALUE_MAX_CHARS) continue;
    const value = cached === null ? null : accountValueOf(cached);
    sent.set(`d:${key}`, s.edits.get(`d:${key}`) ?? 0);
    // Not JSON: nothing any browser could restore. Forgotten rather than sent.
    if (value === undefined) continue;
    writes.push([key, value]);
  }
  for (let at = 0; at < writes.length; at += DRAFTS_PATCH_MAX_ENTRIES) {
    const chunk = writes.slice(at, at + DRAFTS_PATCH_MAX_ENTRIES);
    try {
      await api.patchDrafts({ drafts: Object.fromEntries(chunk) });
    } catch (err) {
      if (!refusedForGood(err)) throw err;
    }
  }
  settle(s, sent);
}

/** Sends every pending edit; a failure that may pass is retried later, with backoff. */
function send(s: SyncState): Promise<void> {
  if (s.sending !== null) {
    s.again = true;
    return s.sending;
  }
  s.sending = (async () => {
    try {
      await sendPrefs(s);
      await sendDrafts(s);
      s.failures = 0;
    } catch (err) {
      // Signed out underneath (401): the journal keeps the edits for the next sign-in.
      if (err instanceof ApiError && err.status === 401) return;
      if (state !== s) return;
      schedule(s, RETRY_MS[Math.min(s.failures, RETRY_MS.length - 1)]!);
      s.failures += 1;
    } finally {
      s.sending = null;
    }
    if (s.again && state === s) {
      s.again = false;
      await send(s);
    }
  })();
  return s.sending;
}

// ---------------------------------------------------------------------------- reading

/**
 * Writes the account's preferences into the cache. Resolves once the account's background image
 * is in too, when the cached one was not it, so the first screen a new browser shows already has
 * the image (the caller's wait bounds this like the reads).
 */
function applyPrefs(s: SyncState, account: UiPrefs): Promise<void> {
  const plan = planPrefs(
    account,
    { getItem: rawGet },
    {
      importing: rawGet(PREFS_IMPORTED_KEY) === null,
      pending: s.prefs,
    },
  );
  for (const [key, value] of plan.cache) rawSet(key, value);
  if (plan.image === "drop") {
    rawSet(BACKGROUND_IMAGE_KEY, null);
    rawSet(BACKGROUND_IMAGE_ID_KEY, null);
  }
  for (const field of plan.upload) {
    s.prefs.add(field);
    markEdit(s, `p:${field}`);
  }
  rawSet(PREFS_IMPORTED_KEY, "1");
  writeJournal(s);
  noteAccountApplied();
  return plan.image === "fetch" ? fetchImage(s) : Promise.resolve();
}

/** The account's image, fetched only when the one cached here is not it. */
async function fetchImage(s: SyncState): Promise<void> {
  try {
    const { image, imageId } = await api.getBackgroundImage();
    // Signed out meanwhile, or an image picked here since: neither may be overwritten.
    if (state !== s || s.prefs.has(BACKGROUND_IMAGE)) return;
    rawSet(BACKGROUND_IMAGE_KEY, image);
    rawSet(BACKGROUND_IMAGE_ID_KEY, image === null ? null : imageId);
    noteAccountApplied();
  } catch {
    // Not this time: the cached image stays, and the next sign-in compares again.
  }
}

function applyDrafts(s: SyncState, account: Record<string, unknown>): void {
  const plan = planDrafts(account, cachedEntries(), {
    userId: s.userId,
    importing: rawGet(draftsImportedKey(s.userId)) === null,
    pending: s.drafts,
  });
  for (const [key, value] of plan.cache) rawSet(key, value);
  for (const key of plan.upload) {
    s.drafts.add(key);
    markEdit(s, `d:${key}`);
  }
  rawSet(draftsImportedKey(s.userId), "1");
  writeJournal(s);
  noteAccountApplied();
}

// ------------------------------------------------------------------------- lifecycle

/**
 * Brings the cache in step with `userId`'s account and starts carrying edits to it. Resolves once
 * both reads are applied or {@link SYNC_WAIT_MS} has passed, whichever is first, to whether the
 * session still stands: false when a read was refused as signed out (401), so the caller does not
 * adopt a user the client has just signed out. Never rejects.
 */
export async function startAccountSync(userId: string): Promise<boolean> {
  stopAccountSync();
  const journal = readJournal(userId);
  const s: SyncState = {
    userId,
    prefs: new Set([...journal.prefs, ...signedOutEdits]),
    drafts: new Set(journal.drafts),
    edits: new Map(),
    draftsOpen: true,
    timer: null,
    dueAt: 0,
    sending: null,
    again: false,
    failures: 0,
  };
  signedOutEdits.clear();
  state = s;
  writeJournal(s);

  // A read that fails, or answers with something malformed, leaves the cache as it is: the app
  // renders from it, and the next sign-in tries again.
  let signedOut = false;
  const failed = (err: unknown): void => {
    if (err instanceof ApiError && err.status === 401) signedOut = true;
  };
  const prefsRead = api
    .getPrefs()
    .then((res) => (state === s ? applyPrefs(s, res.prefs) : undefined))
    .catch(failed);
  const draftsRead = api
    .getDrafts()
    .then((res) => {
      if (state === s && s.draftsOpen) applyDrafts(s, res.drafts);
    })
    .catch(failed);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all([prefsRead, draftsRead]),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, SYNC_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
  s.draftsOpen = false;
  if (signedOut) {
    if (state === s) stopAccountSync();
    return false;
  }
  if (state === s && (s.prefs.size > 0 || s.drafts.size > 0)) schedule(s, 0);
  return true;
}

/** Sends what is pending now (before signing out, or when the page is hidden). Never rejects. */
export async function flushAccountSync(): Promise<void> {
  const s = state;
  if (s === null) return;
  if (s.timer !== null) {
    clearTimeout(s.timer);
    s.timer = null;
  }
  await send(s);
}

/** Stops carrying edits (signed out). The journal stays, for this account's next sign-in here. */
export function stopAccountSync(): void {
  if (state !== null && state.timer !== null) clearTimeout(state.timer);
  state = null;
}

if (typeof document !== "undefined") {
  // Leaving the tab: what is pending goes now rather than after its debounce. The journal
  // covers a page that closes before the send lands.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushAccountSync();
  });
}
if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flushAccountSync());
}
