import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetSession,
  forgetSessionSeen,
  isSessionUnread,
  markSessionSeen,
  noteSessionSeen,
  parseSessionSeen,
  dropSessionSeenCache,
  readSessionSeen,
  resetSessionSeenCache,
  serializeSessionSeen,
  sessionSeenKey,
} from "../src/lib/session-seen";
import type { SessionSeenState, SessionSeenStorage } from "../src/lib/session-seen";

const AT = (iso: string) => Date.parse(iso);
// Fixtures sit safely in the past: noteSessionSeen seeds from the real clock, so a "future"
// fixture would read as activity newer than the seed and flip these expectations.
const T0 = "2020-01-01T10:00:00.000Z";
const T1 = "2020-01-01T11:00:00.000Z";
const T2 = "2020-01-01T12:00:00.000Z";

const state = (seededAt: number, seen: Record<string, number> = {}): SessionSeenState => ({
  seededAt,
  seen: new Map(Object.entries(seen)),
});

/** In-memory localStorage stand-in (vitest runs in Node). */
function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    read: (k: string) => map.get(k) ?? null,
  } satisfies SessionSeenStorage & { read: (k: string) => string | null };
}

describe("isSessionUnread", () => {
  it("treats activity after the marker as unread and activity before it as read", () => {
    const s = state(0, { a: AT(T1) });
    expect(isSessionUnread(s, "a", T2)).toBe(true);
    expect(isSessionUnread(s, "a", T0)).toBe(false);
    // Exactly the moment it was seen: read, not unread (the user was there for it).
    expect(isSessionUnread(s, "a", T1)).toBe(false);
  });

  it("falls back to the seed so pre-existing conversations do not all start unread", () => {
    const seeded = state(AT(T1));
    expect(isSessionUnread(seeded, "never-opened", T0)).toBe(false);
    // ...but anything that runs AFTER the seed is genuinely new and does flag.
    expect(isSessionUnread(seeded, "never-opened", T2)).toBe(true);
  });

  it("flags everything as unread only when nothing has ever been seeded", () => {
    expect(isSessionUnread(state(0), "a", T0)).toBe(true);
  });

  it("never invents an alert from an unparseable timestamp", () => {
    expect(isSessionUnread(state(0), "a", "not-a-date")).toBe(false);
  });
});

describe("markSessionSeen", () => {
  it("stamps the wall clock when it is ahead of the Session's last activity", () => {
    const next = markSessionSeen(state(1), "a", T0, AT(T2));
    expect(next.seen.get("a")).toBe(AT(T2));
  });

  it("stamps lastActiveAt when the local clock lags the server, so opening always marks read", () => {
    // Browser clock an hour behind: a naive Date.now() marker would leave the row stuck unread.
    const next = markSessionSeen(state(1), "a", T2, AT(T1));
    expect(next.seen.get("a")).toBe(AT(T2));
    expect(isSessionUnread(next, "a", T2)).toBe(false);
  });

  it("returns the same state when nothing changes, so no write and no re-render happen", () => {
    const s = state(1, { a: AT(T2) });
    expect(markSessionSeen(s, "a", T0, AT(T2))).toBe(s);
  });

  it("leaves other Sessions' markers alone", () => {
    const next = markSessionSeen(state(1, { a: AT(T0) }), "b", T1, AT(T1));
    expect(next.seen.get("a")).toBe(AT(T0));
    expect(next.seen.get("b")).toBe(AT(T1));
  });
});

describe("forgetSessionSeen", () => {
  it("drops one marker and returns the input unchanged when there was none", () => {
    const s = state(1, { a: AT(T0), b: AT(T1) });
    expect([...forgetSessionSeen(s, "a").seen.keys()]).toEqual(["b"]);
    expect(forgetSessionSeen(s, "missing")).toBe(s);
  });
});

describe("storage round-trip", () => {
  it("survives a serialize/parse cycle", () => {
    const s = state(AT(T0), { a: AT(T1), b: AT(T2) });
    const back = parseSessionSeen(serializeSessionSeen(s));
    expect(back.seededAt).toBe(AT(T0));
    expect(back.seen.get("a")).toBe(AT(T1));
    expect(back.seen.get("b")).toBe(AT(T2));
  });

  it("degrades to nothing remembered on junk, rather than throwing into a render", () => {
    for (const junk of ["", "{", "null", "[]", '"nope"']) {
      const back = parseSessionSeen(junk);
      expect(back.seededAt).toBe(0);
      expect(back.seen.size).toBe(0);
    }
  });

  it("keeps well-formed markers and drops malformed ones", () => {
    const back = parseSessionSeen(
      JSON.stringify({ seededAt: "nope", seen: { a: AT(T1), b: "later", c: null } }),
    );
    expect(back.seededAt).toBe(0);
    expect([...back.seen.keys()]).toEqual(["a"]);
  });

  it("caps stored markers, evicting the least recently seen", () => {
    const seen: Record<string, number> = {};
    for (let i = 0; i < 600; i++) seen[`s${i}`] = i;
    const written = parseSessionSeen(serializeSessionSeen(state(1, seen)));
    expect(written.seen.size).toBe(500);
    expect(written.seen.has("s599")).toBe(true); // Most recent kept.
    expect(written.seen.has("s0")).toBe(false); // Oldest evicted.
  });
});

describe("another tab's write", () => {
  beforeEach(resetSessionSeenCache);

  it("is served once its key is dropped from the cache, and not before", () => {
    const storage = memoryStorage();
    const key = sessionSeenKey("proj");
    storage.setItem(key, serializeSessionSeen(state(AT(T0), { a: AT(T1) })));
    expect(readSessionSeen("proj", storage).seen.get("a")).toBe(AT(T1));
    // The other tab opened `a` later; this tab's parsed copy does not know.
    storage.setItem(key, serializeSessionSeen(state(AT(T0), { a: AT(T2) })));
    expect(readSessionSeen("proj", storage).seen.get("a")).toBe(AT(T1));
    // What the storage event does for that key.
    dropSessionSeenCache(key);
    expect(readSessionSeen("proj", storage).seen.get("a")).toBe(AT(T2));
    expect(isSessionUnread(readSessionSeen("proj", storage), "a", T2)).toBe(false);
  });
});

describe("noteSessionSeen", () => {
  beforeEach(resetSessionSeenCache);

  it("seeds on the first write so existing conversations start out read", () => {
    const storage = memoryStorage();
    noteSessionSeen("proj", "a", T1, storage);
    const stored = parseSessionSeen(storage.read(sessionSeenKey("proj")));
    expect(stored.seededAt).toBeGreaterThan(0);
    // A different Session that last ran before the seed reads as read.
    expect(isSessionUnread(stored, "other", T0)).toBe(false);
    expect(stored.seen.get("a")).toBeDefined();
  });

  it("scopes markers per Project", () => {
    const storage = memoryStorage();
    noteSessionSeen("one", "a", T1, storage);
    expect(storage.read(sessionSeenKey("one"))).not.toBeNull();
    expect(storage.read(sessionSeenKey("two"))).toBeNull();
  });

  it("is a no-op without a Project", () => {
    const storage = memoryStorage();
    noteSessionSeen(null, "a", T1, storage);
    expect(storage.read(sessionSeenKey("proj"))).toBeNull();
  });

  it("prunes a deleted Session's marker", () => {
    const storage = memoryStorage();
    noteSessionSeen("proj", "a", T1, storage);
    forgetSession("proj", "a", storage);
    expect(parseSessionSeen(storage.read(sessionSeenKey("proj"))).seen.has("a")).toBe(false);
  });
});
