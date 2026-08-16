/**
 * Accounts remembered on THIS browser, most recently signed in first — the memory behind
 * "switch account": the sidebar's account menu ends the session and returns to the login
 * page, where this list turns a second account into one click plus a password instead of
 * typing the id again.
 *
 * Only userIds are stored: no passwords, no tokens, nothing beyond what someone watching
 * the sign-in would already know. The session itself stays exactly as it was — one
 * HttpOnly cookie, one active account.
 *
 * Deliberately browser-global rather than keyed per user, unlike the draft caches (#68 keys
 * those per account so typed content can't cross accounts): the list's whole job is to
 * survive the account switch it drives, and it holds only ids their owner typed. Entries are
 * removable one by one from the login page for a shared machine.
 *
 * Pure functions + injectable storage, like draft-cache.ts: vitest runs in Node (no
 * localStorage), and reads validate the parsed value entry by entry — storage may have been
 * corrupted externally, so bad entries are dropped rather than crashing the login page.
 */

/** Minimal storage interface (the subset of localStorage this module uses). */
export interface AccountStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Storage key of the remembered-account list (a JSON array of userIds, newest first). */
export const KNOWN_ACCOUNTS_KEY = "penguin.knownAccounts";

/**
 * Newest-first cap: the list is a shortcut, not a directory. Past a handful of entries
 * scanning it costs more than typing the id, and the login page would grow a scrollbar.
 */
export const MAX_KNOWN_ACCOUNTS = 8;

function storageOf(injected?: AccountStorage): AccountStorage | null {
  if (injected) return injected;
  try {
    return localStorage;
  } catch {
    return null; // No storage at all (privacy mode edge): the list silently stays empty.
  }
}

/** Parses, validates and normalizes the stored list (drops non-strings, blanks and duplicates, applies the cap). */
function parseAccounts(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const id = item.trim();
      if (id === "" || out.includes(id)) continue;
      out.push(id);
    }
    return out.slice(0, MAX_KNOWN_ACCOUNTS);
  } catch {
    return [];
  }
}

function write(accounts: string[], storage?: AccountStorage): void {
  const s = storageOf(storage);
  if (!s) return;
  try {
    if (accounts.length === 0) s.removeItem(KNOWN_ACCOUNTS_KEY);
    else s.setItem(KNOWN_ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    // Quota / private mode: remembering accounts is a convenience, never a hard failure.
  }
}

/** The accounts remembered on this browser, most recently signed in first. */
export function loadKnownAccounts(storage?: AccountStorage): string[] {
  const s = storageOf(storage);
  if (!s) return [];
  try {
    return parseAccounts(s.getItem(KNOWN_ACCOUNTS_KEY));
  } catch {
    return [];
  }
}

/**
 * Records a signed-in account, moving it to the front. Called for every resolved session
 * (mount-time /api/me, a fresh login, refresh), so it must stay cheap: an account that is
 * already the most recent one writes nothing.
 */
export function rememberAccount(userId: string, storage?: AccountStorage): void {
  const id = userId.trim();
  if (id === "") return;
  const accounts = loadKnownAccounts(storage);
  if (accounts[0] === id) return;
  write([id, ...accounts.filter((a) => a !== id)].slice(0, MAX_KNOWN_ACCOUNTS), storage);
}

/** Drops one remembered account (the login page's per-row remove). Idempotent. */
export function forgetAccount(userId: string, storage?: AccountStorage): void {
  const accounts = loadKnownAccounts(storage);
  if (!accounts.includes(userId)) return;
  write(
    accounts.filter((a) => a !== userId),
    storage,
  );
}
