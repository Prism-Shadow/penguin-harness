/**
 * Accounts remembered on this browser (known-accounts.ts), the memory behind "switch
 * account". Entries are (machine, userId) tuples, where machine is the SSH identity of a
 * server (`root@gpu-1` — Linux account included) and userId is an account inside it; the
 * fixtures below keep the two deliberately unrelated, since neither implies the other.
 * Sign-ins move to the front without duplicating, one machine's list never leaks into
 * another's — the case that matters once two SSH targets reach the same local origin,
 * sharing one localStorage bucket — removals are idempotent and clear the key
 * when the list empties, repeat sign-ins of the current account write nothing (the effect
 * behind it runs on every resolved /api/me), and corrupted storage degrades to an empty
 * list instead of crashing the login page.
 */
import { describe, expect, it } from "vitest";
import {
  KNOWN_ACCOUNTS_KEY,
  MAX_KNOWN_ACCOUNTS,
  accountsForMachine,
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

/** The userIds of one machine's remembered accounts, newest first. */
const idsOn = (machine: string, s: AccountStorage) =>
  accountsForMachine(machine, s).map((a) => a.userId);

describe("rememberAccount", () => {
  it("keeps the most recent sign-in first, without duplicating an earlier one", () => {
    const s = memStorage();
    rememberAccount({ machine: "deploy@build-box", userId: "alice" }, s);
    rememberAccount({ machine: "deploy@build-box", userId: "bob" }, s);
    expect(idsOn("deploy@build-box", s)).toEqual(["bob", "alice"]);
    // A returning account moves back to the front instead of being appended again.
    rememberAccount({ machine: "deploy@build-box", userId: "alice" }, s);
    expect(idsOn("deploy@build-box", s)).toEqual(["alice", "bob"]);
  });

  it("writes nothing when the account is already the most recent one", () => {
    const s = memStorage();
    rememberAccount({ machine: "deploy@build-box", userId: "alice" }, s);
    const writes = s.writes;
    rememberAccount({ machine: "deploy@build-box", userId: "alice" }, s);
    rememberAccount({ machine: "deploy@build-box", userId: "alice" }, s);
    expect(s.writes).toBe(writes);
  });

  it("caps the list, dropping the least recently used account", () => {
    const s = memStorage();
    for (let i = 0; i <= MAX_KNOWN_ACCOUNTS; i += 1) {
      rememberAccount({ machine: "deploy@build-box", userId: `user${i}` }, s);
    }
    const ids = idsOn("deploy@build-box", s);
    expect(ids).toHaveLength(MAX_KNOWN_ACCOUNTS);
    expect(ids[0]).toBe(`user${MAX_KNOWN_ACCOUNTS}`);
    expect(ids).not.toContain("user0"); // the oldest fell off the end
  });

  it("ignores a blank id", () => {
    const s = memStorage();
    rememberAccount({ machine: "deploy@build-box", userId: "" }, s);
    rememberAccount({ machine: "deploy@build-box", userId: "   " }, s);
    expect(loadKnownAccounts(s)).toEqual([]);
    expect(s.map.has(KNOWN_ACCOUNTS_KEY)).toBe(false);
  });
});

describe("machine scoping", () => {
  it("keeps two machines' accounts apart in one storage bucket", () => {
    // The tunnel case: both targets are http://localhost:<same port>, so they share a
    // localStorage bucket and only the machine tag tells their accounts apart.
    const s = memStorage();
    rememberAccount({ machine: "deploy@build-box", userId: "alice" }, s);
    rememberAccount({ machine: "root@gpu-1", userId: "admin" }, s);
    rememberAccount({ machine: "deploy@build-box", userId: "bob" }, s);
    expect(idsOn("deploy@build-box", s)).toEqual(["bob", "alice"]);
    expect(idsOn("root@gpu-1", s)).toEqual(["admin"]);
    expect(idsOn("deploy@laptop", s)).toEqual([]);
  });

  it("treats the same id on two machines as two accounts", () => {
    const s = memStorage();
    rememberAccount({ machine: "deploy@build-box", userId: "admin" }, s);
    rememberAccount({ machine: "root@gpu-1", userId: "admin" }, s);
    expect(loadKnownAccounts(s)).toHaveLength(2);
    // Forgetting one leaves the other machine's entry untouched.
    forgetAccount({ machine: "root@gpu-1", userId: "admin" }, s);
    expect(idsOn("root@gpu-1", s)).toEqual([]);
    expect(idsOn("deploy@build-box", s)).toEqual(["admin"]);
  });
});

describe("forgetAccount", () => {
  it("removes one account, leaves the rest ordered, and is idempotent", () => {
    const s = memStorage();
    for (const userId of ["alice", "bob", "carol"]) {
      rememberAccount({ machine: "deploy@build-box", userId }, s);
    }
    forgetAccount({ machine: "deploy@build-box", userId: "bob" }, s);
    expect(idsOn("deploy@build-box", s)).toEqual(["carol", "alice"]);
    const writes = s.writes;
    forgetAccount({ machine: "deploy@build-box", userId: "bob" }, s); // already gone: no throw, no write
    expect(s.writes).toBe(writes);
  });

  it("clears the storage key when the last account is removed", () => {
    const s = memStorage();
    rememberAccount({ machine: "deploy@build-box", userId: "alice" }, s);
    forgetAccount({ machine: "deploy@build-box", userId: "alice" }, s);
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

  it("drops malformed, blank and duplicate entries and applies the cap on read", () => {
    const s = memStorage();
    s.map.set(
      KNOWN_ACCOUNTS_KEY,
      JSON.stringify([
        { machine: "deploy@build-box", userId: "alice" },
        "alice", // pre-tuple entry: dropped, not adopted by the current machine
        42,
        { machine: "deploy@build-box", userId: "  " },
        { machine: "deploy@build-box", userId: "alice" },
        { machine: " deploy@build-box ", userId: " bob " },
        { userId: "no-machine" },
        null,
        ...Array.from({ length: MAX_KNOWN_ACCOUNTS }, (_, i) => ({
          machine: "deploy@build-box",
          userId: `extra${i}`,
        })),
      ]),
    );
    const all = loadKnownAccounts(s);
    expect(all.slice(0, 2)).toEqual([
      { machine: "deploy@build-box", userId: "alice" },
      { machine: "deploy@build-box", userId: "bob" }, // trimmed, deduped, order kept
    ]);
    expect(all).toHaveLength(MAX_KNOWN_ACCOUNTS);
  });

  it("a remember on top of corrupted storage starts a clean list", () => {
    const s = memStorage();
    s.map.set(KNOWN_ACCOUNTS_KEY, "{not json");
    rememberAccount({ machine: "deploy@build-box", userId: "alice" }, s);
    expect(loadKnownAccounts(s)).toEqual([{ machine: "deploy@build-box", userId: "alice" }]);
  });
});
