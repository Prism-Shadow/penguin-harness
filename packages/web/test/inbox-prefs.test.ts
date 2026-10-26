/**
 * The inbox's reading state (features/company/inbox-prefs.ts), driven against stubbed
 * localStorage: the filter chip in force and which categories feed the list, both per
 * organization. Each case pins the tolerant shape — a value naming nothing real reads as the
 * default, and an entry that will not parse starts over rather than blocking the write, so
 * one corrupt value can never brick the feature.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryStorage, stubLocalStorage } from "./helpers/storage";
import {
  INBOX_CATEGORIES,
  INBOX_FILTER_KEY,
  INBOX_PREFS_KEY,
  readInboxFilter,
  readInboxPrefs,
  resolveInboxFilter,
  writeInboxFilter,
  writeInboxPrefs,
} from "../src/features/company/inbox-prefs";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("inbox filter chip", () => {
  it("reads back what was written, per organization", () => {
    stubLocalStorage();
    writeInboxFilter("acme", "blocked");
    writeInboxFilter("other", "done");
    expect(readInboxFilter("acme")).toBe("blocked");
    expect(readInboxFilter("other")).toBe("done");
  });

  it("reads no entry as all", () => {
    stubLocalStorage();
    expect(readInboxFilter("acme")).toBe("all");
  });

  it("reads a value naming no real chip as all", () => {
    stubLocalStorage(memoryStorage({ [INBOX_FILTER_KEY]: JSON.stringify({ acme: "bogus" }) }));
    expect(readInboxFilter("acme")).toBe("all");
  });

  it("reads a corrupt entry as all, and the next write starts over", () => {
    const storage = stubLocalStorage(memoryStorage({ [INBOX_FILTER_KEY]: "{oops" }));
    expect(readInboxFilter("acme")).toBe("all");
    writeInboxFilter("acme", "mention");
    expect(readInboxFilter("acme")).toBe("mention");
    expect(storage.map.get(INBOX_FILTER_KEY)).toBe(JSON.stringify({ acme: "mention" }));
  });

  it("keeps the other organizations on a write", () => {
    stubLocalStorage(
      memoryStorage({ [INBOX_FILTER_KEY]: JSON.stringify({ acme: "blocked", other: "done" }) }),
    );
    writeInboxFilter("acme", "mention");
    expect(readInboxFilter("acme")).toBe("mention");
    expect(readInboxFilter("other")).toBe("done");
  });

  it("reads no organization as all and writes nothing for it", () => {
    const storage = stubLocalStorage();
    expect(readInboxFilter(null)).toBe("all");
    writeInboxFilter(undefined, "blocked");
    expect(storage.map.has(INBOX_FILTER_KEY)).toBe(false);
  });
});

describe("inbox category preferences", () => {
  it("defaults to every category", () => {
    stubLocalStorage();
    expect(readInboxPrefs("acme")).toEqual([...INBOX_CATEGORIES]);
  });

  it("reads back a subset, and an empty array mutes everything", () => {
    stubLocalStorage();
    writeInboxPrefs("acme", ["mention"]);
    expect(readInboxPrefs("acme")).toEqual(["mention"]);
    writeInboxPrefs("acme", []);
    expect(readInboxPrefs("acme")).toEqual([]);
  });

  it("drops entries naming no real category", () => {
    stubLocalStorage(
      memoryStorage({
        [INBOX_PREFS_KEY]: JSON.stringify({ acme: ["mention", "bogus", 42, null] }),
      }),
    );
    expect(readInboxPrefs("acme")).toEqual(["mention"]);
  });

  it("reads a non-array or corrupt entry as every category", () => {
    stubLocalStorage(memoryStorage({ [INBOX_PREFS_KEY]: JSON.stringify({ acme: "mention" }) }));
    expect(readInboxPrefs("acme")).toEqual([...INBOX_CATEGORIES]);
    vi.unstubAllGlobals();
    stubLocalStorage(memoryStorage({ [INBOX_PREFS_KEY]: "{oops" }));
    expect(readInboxPrefs("acme")).toEqual([...INBOX_CATEGORIES]);
  });

  it("keeps the other organizations on a write", () => {
    stubLocalStorage(
      memoryStorage({
        [INBOX_PREFS_KEY]: JSON.stringify({ acme: ["mention"], other: ["done"] }),
      }),
    );
    writeInboxPrefs("acme", ["blocked"]);
    expect(readInboxPrefs("acme")).toEqual(["blocked"]);
    expect(readInboxPrefs("other")).toEqual(["done"]);
  });
});

describe("resolveInboxFilter", () => {
  it("keeps all and an enabled category, and settles a muted one to all", () => {
    expect(resolveInboxFilter("all", ["mention"])).toBe("all");
    expect(resolveInboxFilter("mention", ["mention", "done"])).toBe("mention");
    expect(resolveInboxFilter("blocked", ["mention", "done"])).toBe("all");
    expect(resolveInboxFilter("done", [])).toBe("all");
  });
});
