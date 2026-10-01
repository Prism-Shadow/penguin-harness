/**
 * The sidebar's manual order of its groups (Workspace folders / Agents), lib/group-order.ts.
 *
 * - Given time mode, an order is neither stored nor read back: its buckets are a fixed ladder.
 * - Given no Project or nothing stored, the order is empty and reading writes nothing.
 * - An order saved for one Project and mode reads back for exactly that pair.
 * - A malformed stored value reads as empty, keeping the well-formed keys.
 * - Given a storage that throws (or no storage at all in node), reads and writes degrade quietly.
 * - With nothing stored, the automatic sort is kept (temp group last, pins first).
 * - With a stored order, stored groups take their places, unstored ones surface on top, stale
 *   keys are inert, and the pin boundary is never crossed; neither input is mutated.
 * - The merged temporary-workspace group can be dragged anywhere, like any other group.
 * - A drop splices the rendered list into the stored order: an unmoved drop writes nothing,
 *   unloaded groups keep their places, pins and unpins do not fling groups, stale keys stay.
 * - The group order and each group's row order are independent.
 * - Folder-only groups sort last, never when pinned, keeping the manual order in each block.
 */
import { describe, expect, it } from "vitest";
import {
  commitGroupOrder,
  groupOrderKey,
  loadGroupOrder,
  orderGroups,
  saveGroupOrder,
} from "../src/lib/group-order";
import type { GroupOrderStorage } from "../src/lib/group-order";
import {
  TEMP_WORKSPACE_GROUP_KEY,
  foldedShare,
  groupSessionsByWorkspace,
  isFolderOnly,
} from "../src/lib/session-grouping";
import { blockedStorage, memoryStorage } from "./helpers/storage";

const id = (x: string) => x;
const noPins = { pinned: new Set<string>() };

/** Minimal row shape groupSessionsByWorkspace needs. */
const row = (workspace: string, createdAt: string) => ({ workspace, createdAt });

describe("time mode (excluded at the store)", () => {
  it("time mode neither stores an order nor reads back one planted under its key", () => {
    const s = memoryStorage();
    saveGroupOrder("p1", "time", ["\0time-earlier", "\0time-day"], s);
    expect(s.map.size).toBe(0);
    // Hand-edited storage, or an older build: the gate is on the mode, so the read never
    // reaches the value.
    s.map.set("penguin.groupOrder.p1.time", JSON.stringify(["\u0000time-earlier"]));
    expect(loadGroupOrder("p1", "time", s)).toEqual([]);
    // And the workspace key of the same Project is unaffected either way.
    saveGroupOrder("p1", "workspace", ["/a"], s);
    expect(loadGroupOrder("p1", "workspace", s)).toEqual(["/a"]);
  });
});

describe("group-order store (per-Project × grouping-mode localStorage)", () => {
  it("nothing stored — or no Project yet — is empty, reading never writes, saving without a Project is a no-op", () => {
    const s = memoryStorage();
    expect(loadGroupOrder("p1", "workspace", s)).toEqual([]);
    expect(loadGroupOrder(null, "workspace", s)).toEqual([]);
    expect(s.map.size).toBe(0);
    saveGroupOrder(null, "workspace", ["/a"], s);
    expect(s.map.size).toBe(0);
  });

  it("save → load round-trips per Project, the temp group's key included; Projects are isolated", () => {
    const s = memoryStorage();
    saveGroupOrder("p1", "workspace", ["/b", TEMP_WORKSPACE_GROUP_KEY, "/a"], s);
    saveGroupOrder("p2", "workspace", ["/c"], s);
    expect(loadGroupOrder("p1", "workspace", s)).toEqual(["/b", TEMP_WORKSPACE_GROUP_KEY, "/a"]);
    expect(loadGroupOrder("p2", "workspace", s)).toEqual(["/c"]);
    expect(loadGroupOrder("p3", "workspace", s)).toEqual([]);
  });

  it("the two orderable modes keep separate orders (their group lists are unrelated)", () => {
    const s = memoryStorage();
    saveGroupOrder("p1", "workspace", ["/b", "/a"], s);
    saveGroupOrder("p1", "agent", ["a2", "a1"], s);
    expect(loadGroupOrder("p1", "workspace", s)).toEqual(["/b", "/a"]);
    expect(loadGroupOrder("p1", "agent", s)).toEqual(["a2", "a1"]);
    expect(groupOrderKey("p1", "workspace")).not.toBe(groupOrderKey("p1", "agent"));
  });

  it("malformed JSON / non-array shapes degrade to empty; junk array elements are dropped", () => {
    const s = memoryStorage();
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
    expect(() => saveGroupOrder("p1", "workspace", ["/a"], blockedStorage())).not.toThrow();
  });

  it("with NO storage injected, resolving localStorage is itself inside the try", () => {
    // vitest runs this package in Node, where `localStorage` is not defined at all — the
    // same shape as a browser that throws on touching it (blocked site data, partitioned
    // iframe). Omitting the argument is the only way to reach that branch, and it is the
    // one that runs from the sidebar's useState initializer, where an escaping throw takes
    // the first render down. Resolve it as a default parameter instead and this fails.
    expect(() => loadGroupOrder("p1", "workspace")).not.toThrow();
    expect(loadGroupOrder("p1", "workspace")).toEqual([]);
    expect(() => saveGroupOrder("p1", "workspace", ["/a"])).not.toThrow();
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
    const stored = commitGroupOrder([], keys, TEMP_WORKSPACE_GROUP_KEY, "/home/b", false);
    expect(
      orderGroups(groups, (g) => g.key, { ...noPins, order: stored }).map((g) => g.key),
    ).toEqual([TEMP_WORKSPACE_GROUP_KEY, "/home/b", "/home/a"]);
  });

  it("it can be dropped anywhere, including back into the middle", () => {
    const stored = commitGroupOrder([], keys, TEMP_WORKSPACE_GROUP_KEY, "/home/b", true);
    expect(
      orderGroups(groups, (g) => g.key, { ...noPins, order: stored }).map((g) => g.key),
    ).toEqual(["/home/b", TEMP_WORKSPACE_GROUP_KEY, "/home/a"]);
  });
});

describe("commitGroupOrder (a drop is a splice, not a rewrite)", () => {
  it("with nothing stored, the drop records the rendered list in the order it now reads", () => {
    expect(commitGroupOrder([], ["a", "b", "c"], "c", "a", false)).toEqual(["c", "a", "b"]);
  });

  it("a drop that moves nothing returns the INPUT array, so no write happens", () => {
    const order: readonly string[] = ["a", "b", "c"];
    expect(commitGroupOrder(order, ["a", "b", "c"], "a", "a", true)).toBe(order);
    expect(commitGroupOrder(order, ["a", "b", "c"], "a", "b", false)).toBe(order);
    expect(commitGroupOrder(order, ["a", "b", "c"], "b", "a", true)).toBe(order);
  });

  it("a group that has not loaded yet KEEPS its stored place instead of being demoted", () => {
    // A Workspace group exists only once one of its Sessions has paged in, so /w4../w6
    // are stored but not rendered. Dragging among the rendered three must not push them
    // behind the ones on screen.
    const stored = ["/w6", "/w5", "/w4", "/w3", "/w2", "/w1"];
    const rendered = ["/w3", "/w2", "/w1"];
    const next = commitGroupOrder(stored, rendered, "/w1", "/w3", false);
    expect(next).toEqual(["/w6", "/w5", "/w4", "/w1", "/w3", "/w2"]);
    // The drag did what it said on screen …
    expect(orderGroups(rendered, id, { ...noPins, order: next })).toEqual(["/w1", "/w3", "/w2"]);
    // … and the three that were merely unloaded come back exactly where they were.
    expect(orderGroups(["/w6", "/w5", "/w4", ...rendered], id, { ...noPins, order: next })).toEqual(
      ["/w6", "/w5", "/w4", "/w1", "/w3", "/w2"],
    );
  });

  it("a drop commits the FULL group list, so groups past the display cap keep their places", () => {
    // 15 groups, only 10 rendered: the display cap is a render concern, so the caller
    // hands the whole sequence and every key keeps an index.
    const all = Array.from({ length: 15 }, (_, i) => `g${i + 1}`);
    const next = commitGroupOrder([], all, "g3", "g1", false);
    expect(orderGroups(all, id, { ...noPins, order: next })).toEqual([
      "g3",
      "g1",
      "g2",
      ...all.slice(3),
    ]);
  });

  it("groups with no stored place are folded in where they RENDER — at the top", () => {
    // "fresh" has never been dragged, so it renders first; the commit must record that
    // rather than inventing a position for it.
    const next = commitGroupOrder(["b", "a"], ["fresh", "b", "a"], "a", "b", false);
    expect(next).toEqual(["fresh", "a", "b"]);
    expect(orderGroups(["fresh", "b", "a"], id, { ...noPins, order: next })).toEqual([
      "fresh",
      "a",
      "b",
    ]);
  });

  it("pinning and then unpinning does not fling a group down the list", () => {
    // The two pin partitions share one array, so a commit that front-loaded the dragged
    // partition used to bury the other one. Walk the whole gesture.
    let order = commitGroupOrder([], ["A", "B", "C", "D"], "D", "A", false);
    expect(order).toEqual(["D", "A", "B", "C"]);
    const pinnedD = { pinned: new Set(["D"]), order };
    expect(orderGroups(["A", "B", "C", "D"], id, pinnedD)).toEqual(["D", "A", "B", "C"]);
    // Drag C to the top of the UNPINNED cluster while D is pinned.
    order = commitGroupOrder(order, ["D", "A", "B", "C"], "C", "A", false);
    expect(orderGroups(["A", "B", "C", "D"], id, { pinned: new Set(["D"]), order })).toEqual([
      "D",
      "C",
      "A",
      "B",
    ]);
    // Unpin D: it must stay where the user last put it, not fall to the end.
    expect(orderGroups(["A", "B", "C", "D"], id, { ...noPins, order })).toEqual([
      "D",
      "C",
      "A",
      "B",
    ]);
  });

  it("stale keys are carried along untouched — nothing prunes them", () => {
    // A Workspace whose Sessions are all CLI Sessions, or an Agent deleted elsewhere:
    // the client cannot prove a key is dead, so it stays and simply matches nothing.
    const next = commitGroupOrder(["ghost", "w2", "w1"], ["w2", "w1"], "w1", "w2", false);
    expect(next).toEqual(["ghost", "w1", "w2"]);
    expect(orderGroups(["w2", "w1"], id, { ...noPins, order: next })).toEqual(["w1", "w2"]);
    // And if that group ever comes back under the same key, it resumes its place.
    expect(orderGroups(["ghost", "w2", "w1"], id, { ...noPins, order: next })).toEqual([
      "ghost",
      "w1",
      "w2",
    ]);
  });
});

describe("group order and row order are independent axes", () => {
  it("a group order names only group keys, so committing one cannot touch a row order array", () => {
    const s = memoryStorage();
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
    // Same group objects, same member sequences — orderGroups only permutes the outer
    // list, so compare each group's sequence by key rather than sorting both sides (which
    // would pass even if a member list had been reversed).
    const byKey = (gs: typeof groups) =>
      Object.fromEntries(gs.map((g) => [g.key, g.sessions.map((x) => x.sessionId)]));
    expect(byKey(reordered)).toEqual(byKey(groups));
    expect(before).toEqual(groups.map((g) => g.sessions.map((x) => x.sessionId)));
    expect(reordered.find((g) => g.key === "/w1")?.sessions.map((x) => x.sessionId)).toEqual([
      "s1a",
      "s1b",
    ]);
  });
});

describe("folder-only groups sort last (demote)", () => {
  /** Stands in for the sidebar's own predicate: these keys are the groups holding only folded rows. */
  const isFolded = (key: string) => key.startsWith("f");

  it("sends the demoted groups behind the rest, each block keeping its order", () => {
    const out = orderGroups(["a", "f1", "b", "f2", "c"], id, {
      ...noPins,
      order: [],
      demote: isFolded,
    });
    expect(out).toEqual(["a", "b", "c", "f1", "f2"]);
    // Demoting nothing is the identity — what a Project with no evaluations still renders.
    const plain = { ...noPins, order: [], demote: () => false };
    expect(orderGroups(["a", "b", "c"], id, plain)).toEqual(["a", "b", "c"]);
  });

  it("never demotes a pinned group — a pin is how a folder-only group is kept up top", () => {
    const out = orderGroups(["a", "f1", "pf", "b"], id, {
      pinned: new Set(["pf"]),
      order: [],
      // "pf" is folder-only AND pinned: the pin wins, as it does over every other sort.
      demote: isFolded,
    });
    expect(out).toEqual(["pf", "a", "b", "f1"]);
  });

  it("the manual order still applies inside each of the two blocks", () => {
    // Stored: f2, b, f1, a. The demotion splits that sequence without reshuffling either
    // half, so a drag survives a group becoming — or ceasing to be — folder-only.
    const out = orderGroups(["a", "f1", "b", "f2"], id, {
      ...noPins,
      order: ["f2", "b", "f1", "a"],
      demote: isFolded,
    });
    expect(out).toEqual(["b", "a", "f2", "f1"]);
  });

  it("is folder-only when the active share is zero and something is folded away", () => {
    // One Workspace of an evaluation: a single Test Session, inside the Evaluations folder.
    const evaluation = { active: 0, subagent: 0, schedule: 0, benchmark: 1, archived: 0 };
    expect(foldedShare(evaluation)).toBe(1);
    expect(isFolderOnly(0, foldedShare(evaluation))).toBe(true);
    // Every folded category counts; the active one never does.
    const mixed = { active: 7, subagent: 2, schedule: 1, benchmark: 3, archived: 4 };
    expect(foldedShare(mixed)).toBe(10);
    // A registered but still unused Workspace has nothing folded away to fold up …
    expect(isFolderOnly(0, 0)).toBe(false);
    // … and one active conversation makes a group an ordinary one again.
    expect(isFolderOnly(1, 9)).toBe(false);
  });
});
