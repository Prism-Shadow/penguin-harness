/**
 * The company sidebar's Temporary group of ticket sessions (features/company/temp-session.ts).
 *
 * - Opening a session adds it at the top, or moves it there under the title it was opened
 *   with; the list has no cap and never holds a desk session.
 * - ✕ removes one entry (the rest keep their order; an unknown one changes nothing), and
 *   "Close all" every entry of that organization, telling subscribers once; nothing else
 *   removes any: going elsewhere only moves the on-screen mark.
 * - A missing or malformed stored value reads as an empty list.
 * - A reload reads the list back from storage, and the stored key goes once the last entry does.
 * - Each user, Project and organization has its own list.
 * - Subscribers hear of changes and nothing else, and the same array is handed out until one.
 * - A list another tab changed is reread, so an entry removed there is not written back.
 * - A storage that throws lists nothing stored and keeps what this tab opened.
 */
import { describe, expect, it } from "vitest";
import {
  createTempSessionStore,
  parseTempSessions,
  tempSessionRows,
  tempSessionsKey,
  withDismissed,
  withOpened,
} from "../src/features/company/temp-session";
import type { TempSessionEntry } from "../src/features/company/temp-session";
import { memoryStorage } from "./helpers/storage";

function entry(n: number | string, over: Partial<TempSessionEntry> = {}): TempSessionEntry {
  return { sessionId: `sess_${n}`, agentId: "acme_dev", title: `Ticket session ${n}`, ...over };
}

const ids = (list: readonly { sessionId: string }[]): string[] => list.map((e) => e.sessionId);

const KEY = tempSessionsKey("admin", "proj", "acme");

describe("temporary session list", () => {
  it("adds an opened session at the top", () => {
    const one = withOpened([], entry("a"));
    expect(one).toEqual([entry("a")]);
    expect(ids(withOpened(one, entry("b")))).toEqual(["sess_b", "sess_a"]);
  });

  it("moves a session opened again to the top, listed once and with the title it was opened under", () => {
    const list = [entry("c"), entry("b"), entry("a")];
    const next = withOpened(list, entry("a", { title: "Renamed" }));
    expect(ids(next)).toEqual(["sess_a", "sess_c", "sess_b"]);
    expect(next[0]!.title).toBe("Renamed");
  });

  it("removes a dismissed session and keeps the rest in order", () => {
    const list = [entry("c"), entry("b"), entry("a")];
    expect(ids(withDismissed(list, "sess_b"))).toEqual(["sess_c", "sess_a"]);
    // A session the list does not hold changes nothing, down to the array itself.
    expect(withDismissed(list, "sess_gone")).toBe(list);
  });

  it("has no cap: opening more sessions never drops an older one", () => {
    let list: readonly TempSessionEntry[] = [];
    for (let n = 1; n <= 50; n += 1) list = withOpened(list, entry(n));
    expect(list).toHaveLength(50);
    expect(list[0]!.sessionId).toBe("sess_50");
    expect(list[49]!.sessionId).toBe("sess_1");
  });

  it("never lists a desk session, which has its desk row", () => {
    const list = [entry("a")];
    expect(withOpened(list, entry("desk"), ["sess_desk", null])).toBe(list);
    // One recorded before its desk was known is still not drawn.
    const rows = tempSessionRows([entry("desk"), entry("a")], [null, "sess_desk"], null);
    expect(ids(rows)).toEqual(["sess_a"]);
  });

  it("keeps every entry wherever the reader goes; only the on-screen mark moves", () => {
    const list = [entry("b"), entry("a")];
    const onA = tempSessionRows(list, [], "sess_a");
    expect(onA.map((r) => [r.sessionId, r.active])).toEqual([
      ["sess_b", false],
      ["sess_a", true],
    ]);
    // Another conversation, a desk, or a page with no conversation at all.
    for (const elsewhere of ["sess_other", "sess_desk", null]) {
      const rows = tempSessionRows(list, ["sess_desk"], elsewhere);
      expect(ids(rows)).toEqual(["sess_b", "sess_a"]);
      expect(rows.every((r) => !r.active)).toBe(true);
    }
  });

  it("removes only the row when the session on screen is dismissed", () => {
    const list = withDismissed([entry("b"), entry("a")], "sess_a");
    expect(tempSessionRows(list, [], "sess_a")).toEqual([{ ...entry("b"), active: false }]);
  });
});

describe("stored temporary session list", () => {
  it("reads nothing from a missing, malformed or non-list value", () => {
    expect(parseTempSessions(null)).toEqual([]);
    expect(parseTempSessions("")).toEqual([]);
    expect(parseTempSessions("{not json")).toEqual([]);
    expect(parseTempSessions('{"sessionId":"sess_a"}')).toEqual([]);
  });
});

describe("temporary session store", () => {
  it("survives a reload: a new store over the same storage reads the list back", () => {
    const storage = memoryStorage();
    const before = createTempSessionStore(() => storage);
    before.open(KEY, entry("a"));
    before.open(KEY, entry("b"));
    before.open(KEY, entry("c"));
    before.dismiss(KEY, "sess_b");

    const after = createTempSessionStore(() => storage);
    expect(after.list(KEY)).toEqual([entry("c"), entry("a")]);
  });

  it("removes the stored key once the last entry is dismissed", () => {
    const storage = memoryStorage();
    const store = createTempSessionStore(() => storage);
    store.open(KEY, entry("a"));
    expect(storage.map.has(KEY)).toBe(true);
    store.dismiss(KEY, "sess_a");
    expect(storage.map.has(KEY)).toBe(false);
    expect(createTempSessionStore(() => storage).list(KEY)).toEqual([]);
  });

  it("closes every entry at once with Close all, and says so once", () => {
    const storage = memoryStorage();
    const store = createTempSessionStore(() => storage);
    const other = tempSessionsKey("admin", "proj", "globex");
    store.open(KEY, entry("a"));
    store.open(KEY, entry("b"));
    store.open(other, entry("c"));
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });

    store.dismissAll(KEY);
    expect(store.list(KEY)).toEqual([]);
    expect(notified).toBe(1);
    expect(storage.map.has(KEY)).toBe(false);
    // Another organization's list is its own.
    expect(store.list(other)).toEqual([entry("c")]);
    // And the next page load agrees.
    expect(createTempSessionStore(() => storage).list(KEY)).toEqual([]);

    // Nothing left to close: nobody is told.
    store.dismissAll(KEY);
    expect(notified).toBe(1);
  });

  it("keeps one list per user, Project and organization", () => {
    const keys = [
      tempSessionsKey("admin", "proj", "acme"),
      tempSessionsKey("admin", "proj", "globex"),
      tempSessionsKey("admin", "other_proj", "acme"),
      tempSessionsKey("dana", "proj", "acme"),
      tempSessionsKey(null, "proj", "acme"),
    ];
    expect(new Set(keys).size).toBe(keys.length);

    const storage = memoryStorage();
    const store = createTempSessionStore(() => storage);
    store.open(keys[0]!, entry("a"));
    store.open(keys[1]!, entry("b"));
    expect(store.list(keys[0]!)).toEqual([entry("a")]);
    expect(store.list(keys[1]!)).toEqual([entry("b")]);
    for (const key of keys.slice(2)) expect(store.list(key)).toEqual([]);
    // And the same after a reload.
    const reloaded = createTempSessionStore(() => storage);
    expect(reloaded.list(keys[0]!)).toEqual([entry("a")]);
    expect(reloaded.list(keys[3]!)).toEqual([]);
  });

  it("leaves a desk session out of the stored list", () => {
    const storage = memoryStorage();
    const store = createTempSessionStore(() => storage);
    store.open(KEY, entry("a"));
    store.open(KEY, entry("desk"), ["sess_desk"]);
    expect(store.list(KEY)).toEqual([entry("a")]);
  });

  it("tells subscribers about a change and nothing else, and hands out the same array until one", () => {
    const storage = memoryStorage();
    const store = createTempSessionStore(() => storage);
    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });
    const empty = store.list(KEY);
    expect(store.list(KEY)).toBe(empty);

    store.open(KEY, entry("a"));
    expect(notified).toBe(1);
    const one = store.list(KEY);
    expect(one).not.toBe(empty);
    expect(store.list(KEY)).toBe(one);

    store.open(KEY, entry("desk"), ["sess_desk"]);
    store.dismiss(KEY, "sess_gone");
    expect(notified).toBe(1);
    expect(store.list(KEY)).toBe(one);

    store.dismiss(KEY, "sess_a");
    expect(notified).toBe(2);
    unsubscribe();
    store.open(KEY, entry("b"));
    expect(notified).toBe(2);
  });

  it("rereads a list another tab changed, so an entry removed there is not written back", () => {
    const storage = memoryStorage();
    const here = createTempSessionStore(() => storage);
    const there = createTempSessionStore(() => storage);
    here.open(KEY, entry("a"));
    expect(there.list(KEY)).toEqual([entry("a")]);

    here.dismiss(KEY, "sess_a");
    let notified = 0;
    there.subscribe(() => {
      notified += 1;
    });
    there.reread(KEY);
    expect(notified).toBe(1);
    expect(there.list(KEY)).toEqual([]);
    there.open(KEY, entry("b"));
    expect(createTempSessionStore(() => storage).list(KEY)).toEqual([entry("b")]);

    // A key this store never read has nothing to drop, so nobody is told.
    const before = notified;
    there.reread(tempSessionsKey("admin", "proj", "globex"));
    expect(notified).toBe(before);
  });

  it("lists nothing from a storage that throws, and keeps what is opened for this tab", () => {
    const blocked = createTempSessionStore(() => {
      throw new Error("site data is blocked");
    });
    expect(blocked.list(KEY)).toEqual([]);
    blocked.open(KEY, entry("a"));
    expect(blocked.list(KEY)).toEqual([entry("a")]);
  });
});
