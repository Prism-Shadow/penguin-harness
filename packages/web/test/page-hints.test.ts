/**
 * page-hints.ts unit tests: the key's user / Project / organization / page scope, the round
 * trip through an injected storage, and the two ways a browser refuses to cooperate — a
 * storage that throws, and one that silently drops the write. Both must read as "not
 * dismissed" rather than throwing while an empty page renders.
 */
import { describe, expect, it } from "vitest";
import type { HintStorage } from "../src/features/company/page-hints";
import { dismissHint, hintKey, isHintDismissed } from "../src/features/company/page-hints";

function memoryStorage(initial: Record<string, string> = {}): HintStorage & {
  map: Map<string, string>;
} {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

const throwingStorage: HintStorage = {
  getItem: () => {
    throw new Error("private mode");
  },
  setItem: () => {
    throw new Error("quota");
  },
};

describe("hintKey", () => {
  it("names the user, the Project, the organization and the page", () => {
    expect(hintKey("alice", "p1", "acme", "calendar")).toBe(
      "penguin.orgPageHint.alice.p1.acme.calendar",
    );
  });

  it("separates every scope it carries, and gives a signed-out browser its own bucket", () => {
    const key = hintKey("alice", "p1", "acme", "calendar");
    expect(key).not.toBe(hintKey("bob", "p1", "acme", "calendar"));
    expect(key).not.toBe(hintKey("alice", "p2", "acme", "calendar"));
    expect(key).not.toBe(hintKey("alice", "p1", "other", "calendar"));
    expect(key).not.toBe(hintKey("alice", "p1", "acme", "tickets"));
    expect(hintKey(null, "p1", "acme", "calendar")).toBe("penguin.orgPageHint..p1.acme.calendar");
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
