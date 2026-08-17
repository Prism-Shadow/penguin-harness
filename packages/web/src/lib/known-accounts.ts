/**
 * Accounts remembered on this browser, most recently signed in first — the memory behind
 * "switch account": the sidebar's account menu ends the session and reloads into the login
 * page, where this list turns a second account into one click plus a password instead of
 * typing the id again.
 *
 * An entry is a **(machine, userId) tuple**, not a bare id. The two name different things
 * and neither implies the other: `machine` is the SSH identity of the penguin server this
 * window is talking to (`root@localhost`, `deploy@build-box` — the Linux account is part
 * of it, since each one has its own `~/.penguin`, hence its own server and its own user
 * table), while `userId` is an account inside that server.
 *
 * `userId` alone is therefore not an identity: once the shell can open a penguin server on
 * another machine over an SSH tunnel, the app origin is `http://localhost:<port>` for every
 * one of them, and localStorage is bucketed per origin — so two targets that are handed the
 * same local port (in sequence: ports are remembered per target, not reserved) land in ONE
 * bucket, and an untagged list would offer one server's account ids on another server's
 * login page. The machine tag keeps each server's accounts to itself; it is also what a
 * cross-machine account switcher would group by.
 *
 * Only ids are stored: no passwords, no tokens, nothing beyond what someone watching the
 * sign-in would already know. The session itself is untouched — one HttpOnly cookie, one
 * active account.
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

import { activeServerId } from "./server-context";

/** Minimal storage interface (the subset of localStorage this module uses). */
export interface AccountStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** One remembered account: the server it lives on, and the account id signed in there. */
export interface KnownAccount {
  /** SSH identity of the penguin server — `<linux user>@<ssh alias>`, e.g. `root@localhost` (see currentMachine). */
  machine: string;
  /** Account id inside that server (penguin's own user, e.g. `admin`) — unrelated to the Linux user above. */
  userId: string;
}

/** Storage key of the remembered-account list (a JSON array of tuples, newest first). */
export const KNOWN_ACCOUNTS_KEY = "penguin.knownAccounts";

/**
 * Newest-first cap: the list is a shortcut, not a directory. Past a handful of entries
 * scanning it costs more than typing the id, and the login page would grow a scrollbar.
 * The cap spans machines — the login page only ever renders one machine's share.
 */
export const MAX_KNOWN_ACCOUNTS = 8;

/**
 * Which server this window is talking to.
 *
 * The authoritative answer is the SSH identity the shell connected with — the Linux account
 * and the alias together (`root@localhost`), because the account decides which `~/.penguin`,
 * hence which server and which user table, is on the other end. Only the shell knows it
 * (aliases come from `~/.ssh/config` and the user from `ssh -G` or an explicit override;
 * neither the server nor this page can derive either), so it hands the string over as
 * `window.__PENGUIN_MACHINE__`. Until remote targets exist, the origin's host stands in,
 * which is exactly right for a browser against a server it reached directly.
 *
 * The fallback is NOT sufficient once tunnels are in play: two targets sharing a local port
 * produce the same `location.host`, which is the collision the machine tag exists to
 * resolve. Whatever opens a tunnel must set the identity here (or, if it is made to ride
 * `/api/me` instead, feed this from there).
 */
export function currentMachine(): string {
  const injected = typeof window === "undefined" ? undefined : window.__PENGUIN_MACHINE__;
  if (typeof injected === "string" && injected.trim() !== "") return injected.trim();
  // Same-origin proxying means one origin hosts MANY servers' accounts: the active
  // server's id is the machine, and only the local server falls back to the host.
  const active = activeServerId();
  if (active !== null) return active;
  return typeof location === "undefined" ? "" : location.host;
}

declare global {
  interface Window {
    /** SSH identity (`<linux user>@<alias>`) of the server this window was opened against; set by the shell (see currentMachine). */
    __PENGUIN_MACHINE__?: string;
  }
}

function storageOf(injected?: AccountStorage): AccountStorage | null {
  if (injected) return injected;
  try {
    return localStorage;
  } catch {
    return null; // No storage at all (privacy mode edge): the list silently stays empty.
  }
}

/** True when two entries name the same account (the list's identity, and its dedup key). */
const sameAccount = (a: KnownAccount, b: KnownAccount) =>
  a.machine === b.machine && a.userId === b.userId;

/**
 * Parses, validates and normalizes the stored list (drops malformed entries, blanks and
 * duplicates, applies the cap). Entries from before the tuple shape — bare id strings —
 * are dropped rather than adopted by the current machine: the feature is unreleased, the
 * only such lists are dev ones, and the next sign-in re-records the account properly.
 */
function parseAccounts(raw: string | null): KnownAccount[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: KnownAccount[] = [];
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) continue;
      const o = item as Record<string, unknown>;
      if (typeof o.machine !== "string" || typeof o.userId !== "string") continue;
      const entry = { machine: o.machine.trim(), userId: o.userId.trim() };
      if (entry.userId === "") continue;
      if (out.some((e) => sameAccount(e, entry))) continue;
      out.push(entry);
    }
    return out.slice(0, MAX_KNOWN_ACCOUNTS);
  } catch {
    return [];
  }
}

function write(accounts: KnownAccount[], storage?: AccountStorage): void {
  const s = storageOf(storage);
  if (!s) return;
  try {
    if (accounts.length === 0) s.removeItem(KNOWN_ACCOUNTS_KEY);
    else s.setItem(KNOWN_ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    // Quota / private mode: remembering accounts is a convenience, never a hard failure.
  }
}

/** Every remembered account, most recently signed in first. */
export function loadKnownAccounts(storage?: AccountStorage): KnownAccount[] {
  const s = storageOf(storage);
  if (!s) return [];
  try {
    return parseAccounts(s.getItem(KNOWN_ACCOUNTS_KEY));
  } catch {
    return [];
  }
}

/** One machine's remembered accounts, newest first — what a login page may offer. */
export function accountsForMachine(machine: string, storage?: AccountStorage): KnownAccount[] {
  return loadKnownAccounts(storage).filter((a) => a.machine === machine);
}

/**
 * Records a signed-in account, moving it to the front. Called for every resolved session
 * (mount-time /api/me, a fresh login, refresh), so it must stay cheap: an account that is
 * already the most recent one writes nothing.
 */
export function rememberAccount(account: KnownAccount, storage?: AccountStorage): void {
  const entry = { machine: account.machine.trim(), userId: account.userId.trim() };
  if (entry.userId === "") return;
  const accounts = loadKnownAccounts(storage);
  if (accounts[0] && sameAccount(accounts[0], entry)) return;
  write(
    [entry, ...accounts.filter((a) => !sameAccount(a, entry))].slice(0, MAX_KNOWN_ACCOUNTS),
    storage,
  );
}

/** Drops one remembered account (the login page's per-row remove). Idempotent. */
export function forgetAccount(account: KnownAccount, storage?: AccountStorage): void {
  const accounts = loadKnownAccounts(storage);
  if (!accounts.some((a) => sameAccount(a, account))) return;
  write(
    accounts.filter((a) => !sameAccount(a, account)),
    storage,
  );
}
