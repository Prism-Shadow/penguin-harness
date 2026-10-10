/**
 * The dismissible hints on company pages (features/company/page-hints.ts), remembered per
 * user, Project, organization and page.
 *
 * - Each of those scopes separates the hint, and a signed-out browser gets its own bucket.
 * - A hint nobody dismissed stands; a dismissal is remembered for that hint alone, and a
 *   second dismissal changes nothing.
 * - A storage that throws, or one that silently drops the write, reads as "not dismissed"
 *   without costing the click anything.
 */
import { describe, expect, it } from "vitest";
import type { HintStorage } from "../src/features/company/page-hints";
import { dismissHint, hintKey, isHintDismissed } from "../src/features/company/page-hints";
import { blockedStorage, memoryStorage } from "./helpers/storage";

const throwingStorage = blockedStorage();

describe("hintKey", () => {
  it("separates every scope it carries, and gives a signed-out browser its own bucket", () => {
    const key = hintKey("alice", "p1", "acme", "calendar");
    expect(key).not.toBe(hintKey("bob", "p1", "acme", "calendar"));
    expect(key).not.toBe(hintKey("alice", "p2", "acme", "calendar"));
    expect(key).not.toBe(hintKey("alice", "p1", "other", "calendar"));
    expect(key).not.toBe(hintKey("alice", "p1", "acme", "tickets"));
    expect(hintKey(null, "p1", "acme", "calendar")).not.toBe(key);
  });
});

describe("isHintDismissed / dismissHint", () => {
  it("reads a hint nobody has dismissed as still standing", () => {
    const storage = memoryStorage();
    expect(isHintDismissed(hintKey("alice", "p1", "acme", "calendar"), storage)).toBe(false);
  });

  it("remembers the dismissal, and only for the hint that was dismissed", () => {
    const storage = memoryStorage();
    const calendar = hintKey("alice", "p1", "acme", "calendar");
    const tickets = hintKey("alice", "p1", "acme", "tickets");
    dismissHint(calendar, storage);
    expect(isHintDismissed(calendar, storage)).toBe(true);
    expect(isHintDismissed(tickets, storage)).toBe(false);
    expect(isHintDismissed(hintKey("bob", "p1", "acme", "calendar"), storage)).toBe(false);
  });

  it("stays dismissed when it is dismissed twice", () => {
    const storage = memoryStorage();
    const key = hintKey("alice", "p1", "acme", "tickets");
    dismissHint(key, storage);
    dismissHint(key, storage);
    expect(storage.map.size).toBe(1);
    expect(isHintDismissed(key, storage)).toBe(true);
  });

  it("degrades to 'not dismissed' when storage throws, and the write costs the click nothing", () => {
    const key = hintKey("alice", "p1", "acme", "calendar");
    expect(() => dismissHint(key, throwingStorage)).not.toThrow();
    expect(isHintDismissed(key, throwingStorage)).toBe(false);
  });

  it("degrades to 'not dismissed' when a write is silently dropped", () => {
    const dropping: HintStorage = { getItem: () => null, setItem: () => undefined };
    const key = hintKey("alice", "p1", "acme", "tickets");
    dismissHint(key, dropping);
    expect(isHintDismissed(key, dropping)).toBe(false);
  });
});
