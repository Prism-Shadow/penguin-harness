/**
 * session-order.ts unit tests: the sidebar's row sort mode and manual drag order. The
 * sort mode is one global preference defaulting to "recent" (a fresh profile looks
 * unchanged); the manual order is one per-Project id array where only the relative
 * order of ids co-rendered in a partition matters. Ordering composes with the row
 * pins: the pinned cluster is always first, manual order applies within each pin
 * partition independently, and a drop commits the partition's sequence to the front
 * of the stored array without disturbing other groups' relative order. Newcomers
 * (ids not stored) surface at the TOP of their partition in recency order; stale
 * stored ids are inert; deletion prunes with a same-reference fast path.
 */
import { describe, expect, it } from "vitest";
import {
  SESSION_SORT_MODE_KEY,
  applyManualOrder,
  applyManualReorder,
  initialSessionSortMode,
  loadSessionOrder,
  moveInSequence,
  orderSessionRows,
  removeFromSessionOrder,
  saveSessionOrder,
  sessionOrderKey,
  storeSessionSortMode,
} from "../src/lib/session-order";
import type { SessionOrderStorage } from "../src/lib/session-order";

/** In-memory storage (vitest runs in a Node environment, no localStorage; draft-cache.test.ts convention). */
function memStorage(): SessionOrderStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

const id = (x: string) => x;

describe("sort-mode store (one global preference)", () => {
  it("default is recent: nothing stored, unrecognized values, and throwing storage all read as recent", () => {
    const s = memStorage();
    expect(initialSessionSortMode(s)).toBe("recent");
    for (const raw of ["", "MANUAL", "drag", "true"]) {
      s.map.set(SESSION_SORT_MODE_KEY, raw);
      expect(initialSessionSortMode(s)).toBe("recent");
    }
    const broken: SessionOrderStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(initialSessionSortMode(broken)).toBe("recent");
    expect(() => storeSessionSortMode("manual", broken)).not.toThrow();
  });

  it("round-trips manual and back", () => {
    const s = memStorage();
    storeSessionSortMode("manual", s);
    expect(s.map.get(SESSION_SORT_MODE_KEY)).toBe("manual");
    expect(initialSessionSortMode(s)).toBe("manual");
    storeSessionSortMode("recent", s);
    expect(initialSessionSortMode(s)).toBe("recent");
  });
});

describe("manual-order store (per-Project × grouping-mode localStorage)", () => {
  it("nothing stored — or no Project yet — is empty, reading never writes, saving without a Project is a no-op", () => {
    const s = memStorage();
    expect(loadSessionOrder("p1", "workspace", s)).toEqual([]);
    expect(loadSessionOrder(null, "workspace", s)).toEqual([]);
    expect(s.map.size).toBe(0);
    saveSessionOrder(null, "workspace", ["a"], s);
    expect(s.map.size).toBe(0);
  });

  it("save → load round-trips per Project; Projects are isolated", () => {
    const s = memStorage();
    saveSessionOrder("p1", "workspace", ["b", "a"], s);
    saveSessionOrder("p2", "workspace", ["c"], s);
    expect(loadSessionOrder("p1", "workspace", s)).toEqual(["b", "a"]);
    expect(loadSessionOrder("p2", "workspace", s)).toEqual(["c"]);
    expect(loadSessionOrder("p3", "workspace", s)).toEqual([]);
  });

  it("the two grouping modes keep separate orders (their partitions differ, so one array would scramble the other)", () => {
    const s = memStorage();
    saveSessionOrder("p1", "workspace", ["b", "a"], s);
    saveSessionOrder("p1", "agent", ["a", "b"], s);
    expect(loadSessionOrder("p1", "workspace", s)).toEqual(["b", "a"]);
    expect(loadSessionOrder("p1", "agent", s)).toEqual(["a", "b"]);
    expect(sessionOrderKey("p1", "workspace")).not.toBe(sessionOrderKey("p1", "agent"));
  });

  it("malformed JSON / non-array shapes degrade to empty; junk array elements are dropped", () => {
    const s = memStorage();
    for (const raw of ["{not json", '"a"', "42", "null", "{}", ""]) {
      s.map.set(sessionOrderKey("p1", "workspace"), raw);
      expect(loadSessionOrder("p1", "workspace", s)).toEqual([]);
    }
    s.map.set(sessionOrderKey("p1", "workspace"), '["a", 7, null, {"x": 1}, "b"]');
    expect(loadSessionOrder("p1", "workspace", s)).toEqual(["a", "b"]);
  });

  it("storage whose GETTER throws (blocked site data / partitioned iframe) degrades instead of escaping — these run from useState initializers", () => {
    // The throw must be caught even when it comes from resolving the store itself, which
    // is why localStorage is never a default parameter here.
    const hostile = {
      get getItem(): never {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
    } as unknown as SessionOrderStorage;
    expect(() => loadSessionOrder("p1", "workspace", hostile)).not.toThrow();
    expect(loadSessionOrder("p1", "workspace", hostile)).toEqual([]);
    expect(() => initialSessionSortMode(hostile)).not.toThrow();
    expect(initialSessionSortMode(hostile)).toBe("recent");
  });
});

describe("applyManualOrder", () => {
  it("orders listed rows by their stored position; unlisted newcomers come FIRST keeping recency order", () => {
    // Input arrives newest-first; stored order says c before a; b and d are new.
    expect(applyManualOrder(["b", "a", "d", "c"], id, ["c", "a"])).toEqual(["b", "d", "c", "a"]);
  });

  it("an empty stored order leaves the input order untouched (fresh copy); stale stored ids are inert", () => {
    const rows = ["x", "y"];
    const out = applyManualOrder(rows, id, []);
    expect(out).toEqual(rows);
    expect(out).not.toBe(rows);
    expect(applyManualOrder(["x", "y"], id, ["ghost", "y", "gone"])).toEqual(["x", "y"]);
  });
});

describe("orderSessionRows recency (最近更新 = last ACTIVITY, not creation)", () => {
  /** Rows whose activity order deliberately disagrees with their creation order. */
  const rows = [
    { id: "old-but-busy", createdAt: "2026-01-01T00:00:00Z", lastActiveAt: "2026-08-14T09:00:00Z" },
    { id: "new-but-idle", createdAt: "2026-08-13T00:00:00Z", lastActiveAt: "2026-08-13T00:00:00Z" },
    { id: "middle", createdAt: "2026-06-01T00:00:00Z", lastActiveAt: "2026-08-14T08:00:00Z" },
  ];
  const key = (r: (typeof rows)[number]) => r.id;
  const plain = { pinned: new Set<string>(), order: [] as string[] };

  it("sorts by lastActiveAt desc — the createdAt order the old code produced is NOT the answer", () => {
    const out = orderSessionRows(rows, key, {
      ...plain,
      sortMode: "recent",
      recencyOf: (r) => r.lastActiveAt,
    });
    expect(out.map(key)).toEqual(["old-but-busy", "middle", "new-but-idle"]);
    // Sorting the same rows by creation would put the freshly created idle one on top.
    expect(
      orderSessionRows(rows, key, {
        ...plain,
        sortMode: "recent",
        recencyOf: (r) => r.createdAt,
      }).map(key),
    ).toEqual(["new-but-idle", "middle", "old-but-busy"]);
  });

  it("ties break by key descending (the store's stable tiebreaker) and the input array is never mutated", () => {
    const tied = [
      { id: "a", lastActiveAt: "2026-08-14T09:00:00Z" },
      { id: "c", lastActiveAt: "2026-08-14T09:00:00Z" },
      { id: "b", lastActiveAt: "2026-08-14T09:00:00Z" },
    ];
    const out = orderSessionRows(tied, (r) => r.id, {
      ...plain,
      sortMode: "recent",
      recencyOf: (r) => r.lastActiveAt,
    });
    expect(out.map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(tied.map((r) => r.id)).toEqual(["a", "c", "b"]); // input untouched
  });

  it("recency also decides where manual-mode newcomers land, and never crosses the pin boundary", () => {
    const out = orderSessionRows(rows, key, {
      pinned: new Set(["new-but-idle"]),
      sortMode: "manual",
      order: ["middle"], // only `middle` has a stored place
      recencyOf: (r) => r.lastActiveAt,
    });
    // Pinned cluster first; among the rest the unlisted newcomer (most recently active)
    // precedes the stored one.
    expect(out.map(key)).toEqual(["new-but-idle", "old-but-busy", "middle"]);
  });

  it("omitting recencyOf keeps the caller's order (the composition tests below rely on it)", () => {
    const out = orderSessionRows(rows, key, { ...plain, sortMode: "recent" });
    expect(out.map(key)).toEqual(["old-but-busy", "new-but-idle", "middle"]);
  });
});

describe("orderSessionRows (pin × sort composition)", () => {
  const pinned = new Set(["p1", "p2"]);

  it("recent mode is exactly pinnedFirst: pinned cluster first, each partition keeping input order", () => {
    const out = orderSessionRows(["a", "p2", "b", "p1"], id, {
      pinned,
      sortMode: "recent",
      order: ["b", "a"], // present but ignored in recent mode
    });
    expect(out).toEqual(["p2", "p1", "a", "b"]);
  });

  it("manual mode applies the stored order WITHIN each pin partition; the pin boundary is never crossed", () => {
    const out = orderSessionRows(["a", "p2", "b", "p1"], id, {
      pinned,
      sortMode: "manual",
      // Stored order interleaves pinned and unpinned ids: the cluster split still wins.
      order: ["b", "p1", "a", "p2"],
    });
    expect(out).toEqual(["p1", "p2", "b", "a"]);
  });

  it("manual mode surfaces unlisted newcomers at the top of THEIR partition", () => {
    const out = orderSessionRows(["new1", "a", "pNew", "p1", "b"], id, {
      pinned: new Set(["p1", "pNew"]),
      sortMode: "manual",
      order: ["b", "a", "p1"],
    });
    // Pinned partition: newcomer pNew first, then stored p1; rest: newcomer new1 first, then b, a.
    expect(out).toEqual(["pNew", "p1", "new1", "b", "a"]);
  });
});

describe("moveInSequence / applyManualReorder (drop commit)", () => {
  it("moves the dragged id before or after the target", () => {
    expect(moveInSequence(["a", "b", "c"], "c", "a", false)).toEqual(["c", "a", "b"]);
    expect(moveInSequence(["a", "b", "c"], "a", "c", true)).toEqual(["b", "c", "a"]);
  });

  it("every no-op returns the INPUT reference, so the caller skips the state + storage write", () => {
    const seq: readonly string[] = ["a", "b", "c"];
    expect(moveInSequence(seq, "a", "a", true)).toBe(seq); // self-drop
    expect(moveInSequence(seq, "zzz", "a", true)).toBe(seq); // dragged id absent
    expect(moveInSequence(seq, "a", "zzz", true)).toBe(seq); // target absent
    // Landing exactly where the row already sat, from either side of the neighbour.
    expect(moveInSequence(seq, "a", "b", false)).toBe(seq);
    expect(moveInSequence(seq, "b", "a", true)).toBe(seq);
    // A real move still allocates.
    expect(moveInSequence(seq, "c", "a", false)).not.toBe(seq);
  });

  it("a drop commits the FULL partition, so display-capped rows keep their places (the reordering regression)", () => {
    // 15 loaded rows, only 10 visible: committing the visible slice used to drop s11..s15
    // out of the stored order, and applyManualOrder then fronted them as "newcomers".
    const all = Array.from({ length: 15 }, (_, i) => `s${i + 1}`);
    const moved = moveInSequence(all, "s3", "s1", false); // drag s3 above s1
    const stored = applyManualReorder([], moved);
    expect(applyManualOrder(all, id, stored)).toEqual([
      "s3",
      "s1",
      "s2",
      ...all.slice(3), // s4…s15 untouched, none promoted to the top
    ]);
  });

  it("committing a partition sequence fronts it and keeps every other stored id's relative order", () => {
    const stored = ["x", "a", "y", "b", "z"];
    // The partition (a, b) was reordered to (b, a): x/y/z keep their relative order behind it.
    expect(applyManualReorder(stored, ["b", "a"])).toEqual(["b", "a", "x", "y", "z"]);
  });

  it("a drop in one group leaves another group's relative order readable", () => {
    let stored: readonly string[] = ["g1a", "g1b", "g2a", "g2b"];
    stored = applyManualReorder(stored, ["g2b", "g2a"]);
    // Group 2 flipped; group 1's pair still reads g1a before g1b.
    const g1 = applyManualOrder(["g1b", "g1a"], id, stored);
    expect(g1).toEqual(["g1a", "g1b"]);
  });
});

describe("removeFromSessionOrder", () => {
  it("prunes a present id and returns the SAME array when absent (delete-path fast exit)", () => {
    const order: readonly string[] = ["a", "b"];
    expect(removeFromSessionOrder(order, "a")).toEqual(["b"]);
    expect(removeFromSessionOrder(order, "zzz")).toBe(order);
  });
});
