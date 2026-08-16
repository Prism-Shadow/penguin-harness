/**
 * Accounts remembered on this browser (known-accounts.ts), the memory behind "switch
 * account": sign-ins move to the front without duplicating, the list is capped, removals
 * are idempotent and clear the key when the list empties, repeat sign-ins of the current
 * account write nothing (the effect behind it runs on every resolved /api/me), and
 * corrupted storage degrades to an empty list instead of crashing the login page.
 */
import { describe, expect, it } from "vitest";
import {
  KNOWN_ACCOUNTS_KEY,
  MAX_KNOWN_ACCOUNTS,
  forgetAccount,
  loadKnownAccounts,
  rememberAccount,
} from "../src/lib/known-accounts";
import type { AccountStorage } from "../src/lib/known-accounts";

/** In-memory storage (vitest runs in a Node environment, no localStorage) counting writes. */
function memStorage(): AccountStorage & { map: Map<string, string>; writes: number } {
  const map = new Map<string, string>();
  const s = {
    map,
    writes: 0,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      s.writes += 1;
      map.set(k, v);
    },
    removeItem: (k: string) => {
      s.writes += 1;
      map.delete(k);
    },
  };
  return s;
}

describe("rememberAccount", () => {
  it("keeps the most recent sign-in first, without duplicating an earlier one", () => {
    const s = memStorage();
    rememberAccount("alice", s);
    rememberAccount("bob", s);
    expect(loadKnownAccounts(s)).toEqual(["bob", "alice"]);
    // A returning account moves back to the front instead of being appended again.
    rememberAccount("alice", s);
    expect(loadKnownAccounts(s)).toEqual(["alice", "bob"]);
  });

  it("writes nothing when the account is already the most recent one", () => {
    const s = memStorage();
    rememberAccount("alice", s);
    const writes = s.writes;
    rememberAccount("alice", s);
    rememberAccount("alice", s);
    expect(s.writes).toBe(writes);
  });

  it("caps the list, dropping the least recently used account", () => {
    const s = memStorage();
    for (let i = 0; i <= MAX_KNOWN_ACCOUNTS; i += 1) rememberAccount(`user${i}`, s);
    const accounts = loadKnownAccounts(s);
    expect(accounts).toHaveLength(MAX_KNOWN_ACCOUNTS);
    expect(accounts[0]).toBe(`user${MAX_KNOWN_ACCOUNTS}`);
    expect(accounts).not.toContain("user0"); // the oldest fell off the end
  });

  it("ignores a blank id", () => {
    const s = memStorage();
    rememberAccount("", s);
    rememberAccount("   ", s);
    expect(loadKnownAccounts(s)).toEqual([]);
    expect(s.map.has(KNOWN_ACCOUNTS_KEY)).toBe(false);
  });
});

describe("forgetAccount", () => {
  it("removes one account, leaves the rest ordered, and is idempotent", () => {
    const s = memStorage();
    rememberAccount("alice", s);
    rememberAccount("bob", s);
    rememberAccount("carol", s);
    forgetAccount("bob", s);
    expect(loadKnownAccounts(s)).toEqual(["carol", "alice"]);
    const writes = s.writes;
    forgetAccount("bob", s); // already gone: no throw, no write
    expect(s.writes).toBe(writes);
  });

  it("clears the storage key when the last account is removed", () => {
    const s = memStorage();
    rememberAccount("alice", s);
    forgetAccount("alice", s);
    expect(loadKnownAccounts(s)).toEqual([]);
    expect(s.map.has(KNOWN_ACCOUNTS_KEY)).toBe(false);
  });
});

describe("stored-list validation", () => {
  it("corrupted or foreign storage degrades to an empty list", () => {
    const s = memStorage();
    s.map.set(KNOWN_ACCOUNTS_KEY, "{not json");
    expect(loadKnownAccounts(s)).toEqual([]);
    const s2 = memStorage();
    s2.map.set(KNOWN_ACCOUNTS_KEY, JSON.stringify({ alice: true }));
    expect(loadKnownAccounts(s2)).toEqual([]);
  });

  it("drops non-string, blank and duplicate entries and applies the cap on read", () => {
    const s = memStorage();
    s.map.set(
      KNOWN_ACCOUNTS_KEY,
      JSON.stringify([
        "alice",
        42,
        "  ",
        "alice",
        " bob ",
        null,
        ...Array.from({ length: MAX_KNOWN_ACCOUNTS }, (_, i) => `extra${i}`),
      ]),
    );
    const accounts = loadKnownAccounts(s);
    expect(accounts.slice(0, 2)).toEqual(["alice", "bob"]); // trimmed, deduped, order kept
    expect(accounts).toHaveLength(MAX_KNOWN_ACCOUNTS);
  });

  it("a remember on top of corrupted storage starts a clean list", () => {
    const s = memStorage();
    s.map.set(KNOWN_ACCOUNTS_KEY, "{not json");
    rememberAccount("alice", s);
    expect(loadKnownAccounts(s)).toEqual(["alice"]);
  });
});
