/**
 * group-order.ts unit tests: the sidebar's manual order of the GROUPS themselves
 * (Workspace folders / Agents), one axis up from session-order.ts's row order.
 *
 * The mode is implicit — there is no second sort toggle — so an empty stored order must
 * be the identity: a Project that has never been dragged keeps the automatic sort
 * exactly. Beyond that: one array per Project AND grouping mode, "time" refused at the
 * store because its buckets are a fixed chronological ladder, groups with no stored
 * place surfacing at the TOP (including the merged temporary-workspace group, which is
 * otherwise forced last), stale keys inert, and pruning gated on a complete live set.
 */
import { describe, expect, it } from "vitest";
import {
  ORDERABLE_GROUP_MODES,
  groupOrderKey,
  isOrderableGroupMode,
  loadGroupOrder,
  orderGroups,
  pruneGroupOrder,
  saveGroupOrder,
} from "../src/lib/group-order";
import type { GroupOrderStorage } from "../src/lib/group-order";
import { applyManualReorder, moveInSequence } from "../src/lib/session-order";
import {
  TEMP_WORKSPACE_GROUP_KEY,
  groupSessionsByWorkspace,
  groupSessionsByTime,
  timeGroupKey,
} from "../src/lib/session-grouping";

/** In-memory storage (vitest runs in a Node environment, no localStorage; session-order.test.ts convention). */
function memStorage(): GroupOrderStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

const id = (x: string) => x;
const noPins = { pinned: new Set<string>() };

/** Minimal row shape groupSessionsByWorkspace needs. */
const row = (workspace: string, createdAt: string) => ({ workspace, createdAt });

describe("orderable modes (time is excluded, at the store)", () => {
  it("exactly Workspace and Agent mode are orderable", () => {
    expect([...ORDERABLE_GROUP_MODES]).toEqual(["workspace", "agent"]);
    expect(isOrderableGroupMode("workspace")).toBe(true);
    expect(isOrderableGroupMode("agent")).toBe(true);
    expect(isOrderableGroupMode("time")).toBe(false);
  });

  it("time mode cannot store an order: saving writes nothing and loading stays empty", () => {
    const s = memStorage();
    saveGroupOrder("p1", "time", ["\0time-earlier", "\0time-day"], s);
    expect(s.map.size).toBe(0);
    expect(loadGroupOrder("p1", "time", s)).toEqual([]);
  });

  it("a stored key smuggled under a time-shaped key is still never read back for time mode", () => {
    const s = memStorage();
    // Write through the workspace key, then ask for time: the gate is on the mode, not the value.
    saveGroupOrder("p1", "workspace", ["/a"], s);
    expect(loadGroupOrder("p1", "workspace", s)).toEqual(["/a"]);
    expect(loadGroupOrder("p1", "time", s)).toEqual([]);
  });

  it("the time buckets keep their fixed chronological ladder — nothing in this module touches them", () => {
    const buckets = groupSessionsByTime(
      [
        { lastActiveAt: "2020-01-01T00:00:00Z" },
        { lastActiveAt: "2026-08-24T11:00:00Z" },
        { lastActiveAt: "2026-08-10T00:00:00Z" },
      ],
      Date.parse("2026-08-24T12:00:00Z"),
    );
    expect(buckets.map((b) => b.bucket)).toEqual(["day", "month", "earlier"]);
    // Even an order naming those keys cannot reach them: time mode never loads one.
    const s = memStorage();
    saveGroupOrder("p1", "time", [timeGroupKey("earlier"), timeGroupKey("day")], s);
    expect(loadGroupOrder("p1", "time", s)).toEqual([]);
  });
});

describe("group-order store (per-Project × grouping-mode localStorage)", () => {
  it("nothing stored — or no Project yet — is empty, reading never writes, saving without a Project is a no-op", () => {
    const s = memStorage();
    expect(loadGroupOrder("p1", "workspace", s)).toEqual([]);
    expect(loadGroupOrder(null, "workspace", s)).toEqual([]);
    expect(s.map.size).toBe(0);
    saveGroupOrder(null, "workspace", ["/a"], s);
    expect(s.map.size).toBe(0);
  });

  it("save → load round-trips per Project; Projects are isolated", () => {
    const s = memStorage();
    saveGroupOrder("p1", "workspace", ["/b", "/a"], s);
    saveGroupOrder("p2", "workspace", ["/c"], s);
    expect(loadGroupOrder("p1", "workspace", s)).toEqual(["/b", "/a"]);
    expect(loadGroupOrder("p2", "workspace", s)).toEqual(["/c"]);
    expect(loadGroupOrder("p3", "workspace", s)).toEqual([]);
  });

  it("the two orderable modes keep separate orders (their group lists are unrelated)", () => {
    const s = memStorage();
    saveGroupOrder("p1", "workspace", ["/b", "/a"], s);
    saveGroupOrder("p1", "agent", ["a2", "a1"], s);
    expect(loadGroupOrder("p1", "workspace", s)).toEqual(["/b", "/a"]);
    expect(loadGroupOrder("p1", "agent", s)).toEqual(["a2", "a1"]);
    expect(groupOrderKey("p1", "workspace")).not.toBe(groupOrderKey("p1", "agent"));
  });

  it("the group order lives under its own key namespace, clear of the row order's", () => {
    expect(groupOrderKey("p1", "workspace")).toBe("penguin.groupOrder.p1.workspace");
  });

  it("malformed JSON / non-array shapes degrade to empty; junk array elements are dropped", () => {
    const s = memStorage();
    for (const raw of ["{not json", '"/a"', "42", "null", "{}", ""]) {
      s.map.set(groupOrderKey("p1", "workspace"), raw);
      expect(loadGroupOrder("p1", "workspace", s)).toEqual([]);
    }
    s.map.set(groupOrderKey("p1", "workspace"), '["/a", 7, null, {"x": 1}, "/b"]');
    expect(loadGroupOrder("p1", "workspace", s)).toEqual(["/a", "/b"]);
  });

  it("storage whose GETTER throws (blocked site data / partitioned iframe) degrades instead of escaping — this runs from a useState initializer", () => {
    const hostile = {
      get getItem(): never {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
    } as unknown as GroupOrderStorage;
    expect(() => loadGroupOrder("p1", "workspace", hostile)).not.toThrow();
    expect(loadGroupOrder("p1", "workspace", hostile)).toEqual([]);
    const broken: GroupOrderStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => saveGroupOrder("p1", "workspace", ["/a"], broken)).not.toThrow();
  });
});

describe("orderGroups with nothing stored = today's automatic sort", () => {
  it("workspace groups keep newest-Session-first with the temp group forced last", () => {
    const groups = groupSessionsByWorkspace([
      row("/home/old", "2026-08-01T00:00:00Z"),
      row("/home/agent/workspaces/tmp-0123abcd", "2026-08-23T00:00:00Z"),
      row("/home/new", "2026-08-20T00:00:00Z"),
    ]);
    const auto = groups.map((g) => g.key);
    expect(auto).toEqual(["/home/new", "/home/old", TEMP_WORKSPACE_GROUP_KEY]);
    // Empty order is the identity: the sidebar renders exactly what it did before.
    expect(orderGroups(groups, (g) => g.key, { ...noPins, order: [] }).map((g) => g.key)).toEqual(
      auto,
    );
  });

  it("the pinned cluster still comes first, each partition keeping its automatic order", () => {
    const out = orderGroups(["a", "b", "c", "d"], id, {
      pinned: new Set(["c", "b"]),
      order: [],
    });
    expect(out).toEqual(["b", "c", "a", "d"]);
  });
});

describe("orderGroups with a stored order", () => {
  it("listed groups take their stored position; groups with NO stored place go to the TOP keeping their automatic order", () => {
    // Automatic order is w1, w2, w3, w4; only w3 and w1 have been dragged.
    expect(orderGroups(["w1", "w2", "w3", "w4"], id, { ...noPins, order: ["w3", "w1"] })).toEqual([
      "w2",
      "w4",
      "w3",
      "w1",
    ]);
  });

  it("a dragged order survives unknown and stale keys in storage", () => {
    // "ghost" was a Workspace that lost its last Session; "w9" has not loaded yet.
    const out = orderGroups(["w1", "w2", "w3"], id, {
      ...noPins,
      order: ["ghost", "w3", "w9", "w1", "gone"],
    });
    expect(out).toEqual(["w2", "w3", "w1"]);
  });

  it("the stored order applies WITHIN each pin partition; the pin boundary is never crossed", () => {
    const out = orderGroups(["a", "p2", "b", "p1"], id, {
      pinned: new Set(["p1", "p2"]),
      // The stored sequence interleaves pinned and unpinned keys: the cluster split still wins.
      order: ["b", "p1", "a", "p2"],
    });
    expect(out).toEqual(["p1", "p2", "b", "a"]);
  });

  it("a newly created group surfaces at the top of its own partition rather than hiding at the bottom", () => {
    const out = orderGroups(["fresh", "a", "pFresh", "p1", "b"], id, {
      pinned: new Set(["p1", "pFresh"]),
      order: ["b", "a", "p1"],
    });
    expect(out).toEqual(["pFresh", "p1", "fresh", "b", "a"]);
  });

  it("neither input array is mutated", () => {
    const groups = ["a", "b", "c"];
    const order = ["c", "a"];
    orderGroups(groups, id, { ...noPins, order });
    expect(groups).toEqual(["a", "b", "c"]);
    expect(order).toEqual(["c", "a"]);
  });
});

describe("the merged temporary-workspace group is draggable like any other", () => {
  const groups = groupSessionsByWorkspace([
    row("/home/a", "2026-08-01T00:00:00Z"),
    row("/home/b", "2026-08-20T00:00:00Z"),
    row("/home/agent/workspaces/tmp-0123abcd", "2026-08-23T00:00:00Z"),
  ]);
  const keys = groups.map((g) => g.key);

  it("its forced-last position is only the DEFAULT: dragging it to the front wins", () => {
    expect(keys).toEqual(["/home/b", "/home/a", TEMP_WORKSPACE_GROUP_KEY]);
    // Drag the temp group above /home/b, exactly as the sidebar commits a drop.
    const seq = moveInSequence(keys, TEMP_WORKSPACE_GROUP_KEY, "/home/b", false);
    const stored = applyManualReorder([], seq);
    expect(
      orderGroups(groups, (g) => g.key, { ...noPins, order: stored }).map((g) => g.key),
    ).toEqual([TEMP_WORKSPACE_GROUP_KEY, "/home/b", "/home/a"]);
  });

  it("it can be dropped anywhere, including back into the middle", () => {
    const seq = moveInSequence(keys, TEMP_WORKSPACE_GROUP_KEY, "/home/b", true);
    const stored = applyManualReorder([], seq);
    expect(
      orderGroups(groups, (g) => g.key, { ...noPins, order: stored }).map((g) => g.key),
    ).toEqual(["/home/b", TEMP_WORKSPACE_GROUP_KEY, "/home/a"]);
  });

  it("its key round-trips through storage like any other group key", () => {
    const s = memStorage();
    saveGroupOrder("p1", "workspace", [TEMP_WORKSPACE_GROUP_KEY, "/home/a"], s);
    expect(loadGroupOrder("p1", "workspace", s)).toEqual([TEMP_WORKSPACE_GROUP_KEY, "/home/a"]);
  });
});

describe("drop commit (the sequence algebra shared with the rows)", () => {
  it("a drop commits the FULL group list, so groups past the display cap keep their places", () => {
    // 15 groups, only 10 rendered: committing the visible slice would drop g11..g15 out
    // of the stored order and applyManualOrder would front them as newcomers.
    const all = Array.from({ length: 15 }, (_, i) => `g${i + 1}`);
    const moved = moveInSequence(all, "g3", "g1", false);
    const stored = applyManualReorder([], moved);
    expect(orderGroups(all, id, { ...noPins, order: stored })).toEqual([
      "g3",
      "g1",
      "g2",
      ...all.slice(3),
    ]);
  });

  it("a drop that changes nothing returns the input reference, so no write happens", () => {
    const seq: readonly string[] = ["a", "b", "c"];
    expect(moveInSequence(seq, "a", "a", true)).toBe(seq);
    expect(moveInSequence(seq, "a", "b", false)).toBe(seq);
    expect(moveInSequence(seq, "b", "a", true)).toBe(seq);
  });

  it("re-dragging keeps the previous arrangement of groups that were not on screen", () => {
    let stored: readonly string[] = ["gone-a", "w2", "w1", "gone-b"];
    stored = applyManualReorder(stored, ["w1", "w2"]);
    expect(stored).toEqual(["w1", "w2", "gone-a", "gone-b"]);
    expect(orderGroups(["w2", "w1"], id, { ...noPins, order: stored })).toEqual(["w1", "w2"]);
  });
});

describe("group order and row order are independent axes", () => {
  it("a group order names only group keys, so committing one cannot touch a row order array", () => {
    const s = memStorage();
    // Same Project, same mode, different key namespaces.
    saveGroupOrder("p1", "workspace", ["/w2", "/w1"], s);
    s.map.set("penguin.sessionOrder.p1.workspace", JSON.stringify(["s2", "s1"]));
    saveGroupOrder("p1", "workspace", ["/w1", "/w2"], s);
    expect(s.map.get("penguin.sessionOrder.p1.workspace")).toBe(JSON.stringify(["s2", "s1"]));
    expect(loadGroupOrder("p1", "workspace", s)).toEqual(["/w1", "/w2"]);
  });

  it("reordering the groups leaves each group's own Session sequence untouched", () => {
    const groups = groupSessionsByWorkspace([
      { workspace: "/w1", createdAt: "2026-08-02T00:00:00Z", sessionId: "s1b" },
      { workspace: "/w1", createdAt: "2026-08-03T00:00:00Z", sessionId: "s1a" },
      { workspace: "/w2", createdAt: "2026-08-01T00:00:00Z", sessionId: "s2a" },
    ]);
    const before = groups.map((g) => g.sessions.map((x) => x.sessionId));
    const reordered = orderGroups(groups, (g) => g.key, { ...noPins, order: ["/w2", "/w1"] });
    expect(reordered.map((g) => g.key)).toEqual(["/w2", "/w1"]);
    // Same group objects, same member sequences — orderGroups only permutes the outer list.
    expect(reordered.map((g) => g.sessions.map((x) => x.sessionId)).sort()).toEqual(before.sort());
    expect(reordered.find((g) => g.key === "/w1")?.sessions.map((x) => x.sessionId)).toEqual([
      "s1a",
      "s1b",
    ]);
  });
});

describe("pruneGroupOrder", () => {
  it("drops keys outside the live set and returns the SAME array when every key is live", () => {
    const order: readonly string[] = ["/a", "/b"];
    expect(pruneGroupOrder(order, new Set(["/a", "/b", "/c"]))).toBe(order);
    expect(pruneGroupOrder(order, new Set(["/b"]))).toEqual(["/b"]);
  });

  it("an empty live set clears the array; an empty order is inert", () => {
    expect(pruneGroupOrder(["/a"], new Set())).toEqual([]);
    const empty: readonly string[] = [];
    expect(pruneGroupOrder(empty, new Set(["/a"]))).toBe(empty);
  });

  it("pruning preserves the relative order of the keys it keeps", () => {
    expect(pruneGroupOrder(["/c", "/gone", "/a", "/b"], new Set(["/a", "/b", "/c"]))).toEqual([
      "/c",
      "/a",
      "/b",
    ]);
  });
});
