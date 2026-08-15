/**
 * Dev console pure-logic tests: the sessionStorage-backed event feed that carries a
 * web_updated notice across the reload it triggers (see src/lib/dev-console.ts's
 * module doc for why the feed has to be storage-backed instead of live).
 */
import { describe, expect, it } from "vitest";
import type { DevConsoleEvent, StorageLike } from "../src/lib/dev-console";
import { readDevConsoleEvents, recordDevConsoleEvent } from "../src/lib/dev-console";

/** Minimal in-memory Storage fake — vitest runs in node, no real sessionStorage exists. */
function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("dev console event feed", () => {
  it("starts empty when nothing was persisted", () => {
    expect(readDevConsoleEvents(fakeStorage())).toEqual([]);
  });

  it("records an event and reads it back", () => {
    const storage = fakeStorage();
    const event: DevConsoleEvent = {
      type: "web_updated",
      rev: "abc123",
      at: "2026-08-15T00:00:00.000Z",
    };
    const fed = recordDevConsoleEvent(storage, event);
    expect(fed).toEqual([event]);
    expect(readDevConsoleEvents(storage)).toEqual([event]);
  });

  it("accumulates events in order across separate calls (a second reload after the first)", () => {
    const storage = fakeStorage();
    recordDevConsoleEvent(storage, { type: "web_updated", rev: "rev1", at: "t1" });
    recordDevConsoleEvent(storage, { type: "web_updated", rev: "rev2", at: "t2" });
    expect(readDevConsoleEvents(storage).map((e) => e.rev)).toEqual(["rev1", "rev2"]);
  });

  it("caps the feed at 20, dropping the oldest first", () => {
    const storage = fakeStorage();
    for (let i = 0; i < 25; i++) {
      recordDevConsoleEvent(storage, { type: "web_updated", rev: `rev${i}`, at: `t${i}` });
    }
    const feed = readDevConsoleEvents(storage);
    expect(feed).toHaveLength(20);
    expect(feed[0]!.rev).toBe("rev5"); // the oldest 5 (rev0..rev4) were dropped
    expect(feed[19]!.rev).toBe("rev24");
  });

  it("tolerates corrupt JSON in storage (never throws, treats it as empty)", () => {
    const storage = fakeStorage();
    storage.setItem("penguin.devConsole.events", "{not json");
    expect(readDevConsoleEvents(storage)).toEqual([]);
  });

  it("tolerates a non-array value in storage", () => {
    const storage = fakeStorage();
    storage.setItem("penguin.devConsole.events", JSON.stringify({ not: "an array" }));
    expect(readDevConsoleEvents(storage)).toEqual([]);
  });

  it("filters out malformed entries mixed into an otherwise valid array", () => {
    const storage = fakeStorage();
    storage.setItem(
      "penguin.devConsole.events",
      JSON.stringify([
        { type: "web_updated", rev: "ok", at: "t" },
        { type: "web_updated", rev: 5 }, // rev not a string, and no `at`
        "garbage",
        null,
      ]),
    );
    expect(readDevConsoleEvents(storage)).toEqual([{ type: "web_updated", rev: "ok", at: "t" }]);
  });
});
