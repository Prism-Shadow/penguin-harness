/**
 * Per-Workspace memory of what a new draft opens (surface-memory.ts): a pick recorded
 * against the Workspace it was made in, isolated by "user × Project", validated on read,
 * and best-effort on write.
 */
import { describe, expect, it } from "vitest";
import {
  applicableSurfaceKind,
  recallSurfaceKind,
  rememberSurfaceKind,
  surfaceMemoryKey,
  workspaceKey,
} from "../src/features/chat/surface-memory";
import type { DraftStorage } from "../src/features/chat/draft-cache";

/** In-memory storage (vitest runs in a Node environment, no localStorage). */
function memStorage(): DraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("workspaceKey", () => {
  it("carries the machine, so the same path on two machines is two Workspaces", () => {
    expect(workspaceKey("/srv/app", null)).not.toBe(workspaceKey("/srv/app", "m1"));
  });

  it("the temporary Workspace ('') is a Workspace like any other", () => {
    expect(workspaceKey("", null)).not.toBe(workspaceKey("/srv/app", null));
  });
});

describe("remember / recall", () => {
  it("recalls the kind picked for that Workspace, and nothing for any other", () => {
    const storage = memStorage();
    rememberSurfaceKind("u1", "p1", "/srv/app", null, "claude-code", storage);
    expect(recallSurfaceKind("u1", "p1", "/srv/app", null, storage)).toBe("claude-code");
    expect(recallSurfaceKind("u1", "p1", "/srv/other", null, storage)).toBeNull();
    expect(recallSurfaceKind("u1", "p1", "/srv/app", "m1", storage)).toBeNull();
  });

  it("keeps one Workspace's pick while another changes", () => {
    const storage = memStorage();
    rememberSurfaceKind("u1", "p1", "/srv/app", null, "claude-code", storage);
    rememberSurfaceKind("u1", "p1", "/srv/other", null, "other-surface", storage);
    expect(recallSurfaceKind("u1", "p1", "/srv/app", null, storage)).toBe("claude-code");
    expect(recallSurfaceKind("u1", "p1", "/srv/other", null, storage)).toBe("other-surface");
  });

  it("choosing the conversation drops the entry rather than storing a value", () => {
    const storage = memStorage();
    rememberSurfaceKind("u1", "p1", "/srv/app", null, "claude-code", storage);
    rememberSurfaceKind("u1", "p1", "/srv/app", null, null, storage);
    expect(recallSurfaceKind("u1", "p1", "/srv/app", null, storage)).toBeNull();
    expect(JSON.parse(storage.map.get(surfaceMemoryKey("u1", "p1"))!)).toEqual({});
  });

  it("never writes a Workspace the conversation was chosen in", () => {
    const storage = memStorage();
    rememberSurfaceKind("u1", "p1", "/srv/app", null, null, storage);
    expect(storage.map.size).toBe(0);
  });

  it("is isolated by user and by Project (#68)", () => {
    const storage = memStorage();
    rememberSurfaceKind("u1", "p1", "/srv/app", null, "claude-code", storage);
    expect(recallSurfaceKind("u2", "p1", "/srv/app", null, storage)).toBeNull();
    expect(recallSurfaceKind("u1", "p2", "/srv/app", null, storage)).toBeNull();
  });
});

describe("reading what something else wrote", () => {
  const cases: Array<[string, string]> = [
    ["bad JSON", "{not json"],
    ["a non-object", "42"],
    ["an array", "[1,2]"],
    ["null", "null"],
  ];
  for (const [name, raw] of cases) {
    it(`${name} reads as no memory at all`, () => {
      const storage = memStorage();
      storage.map.set(surfaceMemoryKey("u1", "p1"), raw);
      expect(recallSurfaceKind("u1", "p1", "/srv/app", null, storage)).toBeNull();
    });
  }

  it("drops the entries that are not a kind, keeping the ones that are", () => {
    const storage = memStorage();
    storage.map.set(
      surfaceMemoryKey("u1", "p1"),
      JSON.stringify({
        [workspaceKey("/srv/app", null)]: "claude-code",
        [workspaceKey("/srv/bad", null)]: 7,
        [workspaceKey("/srv/empty", null)]: "",
      }),
    );
    expect(recallSurfaceKind("u1", "p1", "/srv/app", null, storage)).toBe("claude-code");
    expect(recallSurfaceKind("u1", "p1", "/srv/bad", null, storage)).toBeNull();
    expect(recallSurfaceKind("u1", "p1", "/srv/empty", null, storage)).toBeNull();
  });

  it("a rewrite of one entry does not carry the invalid ones back", () => {
    const storage = memStorage();
    storage.map.set(
      surfaceMemoryKey("u1", "p1"),
      JSON.stringify({ [workspaceKey("/srv/bad", null)]: 7 }),
    );
    rememberSurfaceKind("u1", "p1", "/srv/app", null, "claude-code", storage);
    expect(JSON.parse(storage.map.get(surfaceMemoryKey("u1", "p1"))!)).toEqual({
      [workspaceKey("/srv/app", null)]: "claude-code",
    });
  });
});

describe("storage that refuses", () => {
  it("a failing write is swallowed (quota / private browsing)", () => {
    const storage: DraftStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    expect(() =>
      rememberSurfaceKind("u1", "p1", "/srv/app", null, "claude-code", storage),
    ).not.toThrow();
  });

  it("a failing read is no memory, not a crash", () => {
    const storage: DraftStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(recallSurfaceKind("u1", "p1", "/srv/app", null, storage)).toBeNull();
  });
});

describe("applicableSurfaceKind", () => {
  it("keeps a kind the server still contributes", () => {
    expect(applicableSurfaceKind("claude-code", ["claude-code", "other"])).toBe("claude-code");
  });

  it("falls back to the conversation when its plugin is gone", () => {
    expect(applicableSurfaceKind("claude-code", ["other"])).toBeNull();
    expect(applicableSurfaceKind("claude-code", [])).toBeNull();
  });

  it("no pick is the conversation", () => {
    expect(applicableSurfaceKind(null, ["claude-code"])).toBeNull();
  });
});
