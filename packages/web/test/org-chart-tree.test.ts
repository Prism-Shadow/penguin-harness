/**
 * org-chart-tree.ts unit tests: the reporting line as a DFS tree from the CEO with the
 * detached set apart, the subtree an employee may not be moved under, and the top-down
 * layout — the root at the top centre, one row per depth, siblings a gap apart, a parent
 * centred over its children, a deep subtree widening its parent's band, the detached row
 * beneath, and the connectors from a parent's bottom centre to a child's top centre.
 */
import { describe, expect, it } from "vitest";
import {
  CHART_DETACHED_LABEL_H,
  CHART_EDGE_RADIUS,
  CHART_GAP_X,
  CHART_GAP_Y,
  CHART_NODE_H,
  CHART_NODE_W,
  CHART_PAD,
  buildChartTree,
  connectorPath,
  layoutOrgTree,
  managerCandidates,
  subtreeIds,
  workspaceTail,
} from "../src/features/company/org-chart-tree";
import type { OrgTreeLayout, OrgTreeNode } from "../src/features/company/org-chart-tree";

const employees = [
  { agentId: "ceo", reportsTo: null },
  { agentId: "cto", reportsTo: "ceo" },
  { agentId: "dev1", reportsTo: "cto" },
  { agentId: "dev2", reportsTo: "cto" },
  { agentId: "cfo", reportsTo: "ceo" },
];

const W = CHART_NODE_W;
const H = CHART_NODE_H;
const GX = CHART_GAP_X;
const GY = CHART_GAP_Y;
const PAD = CHART_PAD;

const at = (layout: OrgTreeLayout, id: string): OrgTreeNode =>
  layout.nodes.find((n) => n.id === id)!;
const centre = (n: OrgTreeNode): number => n.x + W / 2;
const row = (depth: number): number => PAD + depth * (H + GY);

describe("buildChartTree", () => {
  it("walks the tree in DFS preorder from the CEO with depths", () => {
    const { nodes, detached } = buildChartTree(employees, "ceo");
    expect(nodes.map((n) => [n.id, n.depth])).toEqual([
      ["ceo", 0],
      ["cto", 1],
      ["dev1", 2],
      ["dev2", 2],
      ["cfo", 1],
    ]);
    expect(detached).toEqual([]);
  });

  it("lists employees whose chain never reaches the CEO as detached, cycles included", () => {
    const { nodes, detached } = buildChartTree(
      [...employees, { agentId: "x", reportsTo: "y" }, { agentId: "y", reportsTo: "x" }],
      "ceo",
    );
    expect(nodes.map((n) => n.id)).toEqual(["ceo", "cto", "dev1", "dev2", "cfo"]);
    expect(detached).toEqual(["x", "y"]);
  });

  it("a missing CEO leaves everyone detached rather than inventing a root", () => {
    expect(buildChartTree(employees.slice(1), "ceo")).toEqual({
      nodes: [],
      detached: ["cto", "dev1", "dev2", "cfo"],
    });
  });
});

describe("subtreeIds and managerCandidates", () => {
  it("collects an employee and every descendant, which are exactly who it may not report to", () => {
    expect([...subtreeIds(employees, "cto")].sort()).toEqual(["cto", "dev1", "dev2"]);
    expect(managerCandidates(employees, "cto").map((e) => e.agentId)).toEqual(["ceo", "cfo"]);
    expect(managerCandidates(employees, "dev1").map((e) => e.agentId)).toEqual([
      "ceo",
      "cto",
      "dev2",
      "cfo",
    ]);
  });
});

describe("layoutOrgTree", () => {
  it("puts a lone root at the top with the padding around it and no edges", () => {
    const layout = layoutOrgTree([{ agentId: "ceo", reportsTo: null }], "ceo");
    expect(at(layout, "ceo")).toMatchObject({ x: PAD, y: PAD, depth: 0, detached: false });
    expect(layout.width).toBe(W + 2 * PAD);
    expect(layout.height).toBe(H + 2 * PAD);
    expect(layout.edges).toEqual([]);
    expect(layout.detached).toEqual([]);
    expect(layout.detachedTop).toBeNull();
  });

  it("two levels: siblings sit one gap apart on the second row and the root is centred over them", () => {
    const layout = layoutOrgTree(
      [
        { agentId: "ceo", reportsTo: null },
        { agentId: "a", reportsTo: "ceo" },
        { agentId: "b", reportsTo: "ceo" },
        { agentId: "c", reportsTo: "ceo" },
      ],
      "ceo",
    );
    expect(at(layout, "a")).toMatchObject({ x: PAD, y: row(1) });
    expect(at(layout, "b")).toMatchObject({ x: PAD + W + GX, y: row(1) });
    expect(at(layout, "c")).toMatchObject({ x: PAD + 2 * (W + GX), y: row(1) });
    // The root's centre is the midpoint of its first and last child's centres — here, b's.
    expect(at(layout, "ceo")).toMatchObject({ x: at(layout, "b").x, y: row(0) });
    expect(centre(at(layout, "ceo"))).toBe((centre(at(layout, "a")) + centre(at(layout, "c"))) / 2);
    expect(layout.width).toBe(3 * W + 2 * GX + 2 * PAD);
    expect(layout.height).toBe(2 * H + GY + 2 * PAD);
  });

  it("three levels: a deeper subtree widens its parent's band and pushes the parent's siblings outward", () => {
    const layout = layoutOrgTree(employees, "ceo");
    const [ceo, cto, dev1, dev2, cfo] = ["ceo", "cto", "dev1", "dev2", "cfo"].map((id) =>
      at(layout, id),
    ) as [OrgTreeNode, OrgTreeNode, OrgTreeNode, OrgTreeNode, OrgTreeNode];
    expect([ceo.y, cto.y, dev1.y, dev2.y, cfo.y]).toEqual([row(0), row(1), row(2), row(2), row(1)]);
    // cto's band is two cards wide; cto is centred over dev1 and dev2.
    expect(dev1.x).toBe(PAD);
    expect(dev2.x).toBe(PAD + W + GX);
    expect(centre(cto)).toBe((centre(dev1) + centre(dev2)) / 2);
    // cfo starts after cto's whole band, not after cto's own card.
    expect(cfo.x).toBe(dev2.x + W + GX);
    expect(cfo.x - cto.x).toBeGreaterThan(W + GX);
    // The root is centred between its first and last child.
    expect(centre(ceo)).toBe((centre(cto) + centre(cfo)) / 2);
    expect(layout.width).toBe(3 * W + 2 * GX + 2 * PAD);
    expect(layout.height).toBe(3 * H + 2 * GY + 2 * PAD);
  });

  it("an uneven fan keeps every parent over the midpoint of its children and no row overlapping", () => {
    const layout = layoutOrgTree(
      [
        { agentId: "ceo", reportsTo: null },
        { agentId: "m1", reportsTo: "ceo" },
        { agentId: "l1", reportsTo: "m1" },
        { agentId: "l2", reportsTo: "m1" },
        { agentId: "l3", reportsTo: "m1" },
        { agentId: "m2", reportsTo: "ceo" },
        { agentId: "l4", reportsTo: "m2" },
        { agentId: "m3", reportsTo: "ceo" },
      ],
      "ceo",
    );
    const parents = [
      ["ceo", ["m1", "m2", "m3"]],
      ["m1", ["l1", "l2", "l3"]],
      ["m2", ["l4"]],
    ] as const;
    for (const [parent, kids] of parents) {
      const first = at(layout, kids[0]);
      const last = at(layout, kids[kids.length - 1]!);
      // Within half a pixel: x is rounded to whole pixels so cards render crisp.
      expect(
        Math.abs(centre(at(layout, parent)) - (centre(first) + centre(last)) / 2),
      ).toBeLessThanOrEqual(0.5);
    }
    const byRow = new Map<number, OrgTreeNode[]>();
    for (const n of layout.nodes) byRow.set(n.y, [...(byRow.get(n.y) ?? []), n]);
    for (const nodes of byRow.values()) {
      const xs = nodes.map((n) => n.x).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++)
        expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(W + GX);
    }
    for (const n of layout.nodes) {
      expect(Number.isInteger(n.x)).toBe(true);
      expect(n.x).toBeGreaterThanOrEqual(PAD);
      expect(n.x + W).toBeLessThanOrEqual(layout.width - PAD);
    }
  });

  it("puts an employee whose manager is missing in a detached row under the tree, with no edge", () => {
    const layout = layoutOrgTree(
      [
        { agentId: "ceo", reportsTo: null },
        { agentId: "a", reportsTo: "ceo" },
        { agentId: "x", reportsTo: "ghost" },
        { agentId: "y", reportsTo: "x" },
      ],
      "ceo",
    );
    expect(layout.detached).toEqual(["x", "y"]);
    const treeH = 2 * H + GY;
    const detachedTop = PAD + treeH + GY + CHART_DETACHED_LABEL_H;
    expect(layout.detachedTop).toBe(detachedTop);
    expect(at(layout, "x")).toMatchObject({
      x: PAD,
      y: detachedTop,
      detached: true,
      parentId: null,
    });
    expect(at(layout, "y")).toMatchObject({ x: PAD + W + GX, y: detachedTop, detached: true });
    expect(layout.edges.map((e) => e.toId)).toEqual(["a"]);
    // The row is the wider block, so the one-card-wide tree is centred on it.
    expect(layout.width).toBe(2 * W + GX + 2 * PAD);
    expect(centre(at(layout, "ceo"))).toBe(layout.width / 2);
    expect(at(layout, "a").x).toBe(at(layout, "ceo").x);
    expect(layout.height).toBe(detachedTop + H + PAD);
  });

  it("a missing CEO gives a detached row alone, with room for its label and no tree above", () => {
    const layout = layoutOrgTree(employees.slice(1), "ceo");
    expect(layout.nodes.every((n) => n.detached)).toBe(true);
    expect(layout.detachedTop).toBe(PAD + CHART_DETACHED_LABEL_H);
    expect(layout.edges).toEqual([]);
    expect(layout.width).toBe(4 * W + 3 * GX + 2 * PAD);
    expect(layout.height).toBe(PAD + CHART_DETACHED_LABEL_H + H + PAD);
  });

  it("nobody at all is an empty drawing", () => {
    expect(layoutOrgTree([], "ceo")).toMatchObject({
      width: 2 * PAD,
      height: PAD,
      nodes: [],
      edges: [],
      detached: [],
      detachedTop: null,
    });
  });

  it("draws every connector from the parent's bottom centre through the rail to the child's top centre", () => {
    const layout = layoutOrgTree(employees, "ceo");
    expect(layout.edges.map((e) => `${e.fromId}>${e.toId}`).sort()).toEqual([
      "ceo>cfo",
      "ceo>cto",
      "cto>dev1",
      "cto>dev2",
    ]);
    for (const edge of layout.edges) {
      const from = at(layout, edge.fromId);
      const to = at(layout, edge.toId);
      const railY = from.y + H + GY / 2;
      expect(edge.path.startsWith(`M ${centre(from)} ${from.y + H} V `)).toBe(true);
      expect(edge.path.endsWith(` V ${to.y}`)).toBe(true);
      expect(edge.path.includes(` ${railY} `)).toBe(true);
      // The horizontal run stops a corner short of the child's centre on the child's side.
      const dir = centre(to) > centre(from) ? 1 : -1;
      expect(edge.path.includes(` H ${centre(to) - dir * CHART_EDGE_RADIUS} `)).toBe(true);
    }
  });

  it("is deterministic", () => {
    expect(layoutOrgTree(employees, "ceo")).toEqual(layoutOrgTree(employees, "ceo"));
  });
});

describe("connectorPath", () => {
  it("is a straight drop when the two centres line up", () => {
    expect(connectorPath(100, 50, 100, 150, 100)).toBe("M 100 50 V 150");
  });

  it("turns twice with rounded corners otherwise, in either direction", () => {
    const r = CHART_EDGE_RADIUS;
    expect(connectorPath(100, 50, 300, 150, 100)).toBe(
      `M 100 50 V ${100 - r} Q 100 100 ${100 + r} 100 H ${300 - r} Q 300 100 300 ${100 + r} V 150`,
    );
    expect(connectorPath(300, 50, 100, 150, 100)).toBe(
      `M 300 50 V ${100 - r} Q 300 100 ${300 - r} 100 H ${100 + r} Q 100 100 100 ${100 + r} V 150`,
    );
  });

  it("shrinks the corners when the horizontal run is shorter than two radii", () => {
    expect(connectorPath(0, 0, 6, 100, 50)).toBe("M 0 0 V 47 Q 0 50 3 50 H 3 Q 6 50 6 53 V 100");
  });
});

describe("workspaceTail", () => {
  it("keeps `.` and returns the last segment of a path", () => {
    expect(workspaceTail(".")).toBe(".");
    expect(workspaceTail("")).toBe(".");
    expect(workspaceTail("docs/site")).toBe("site");
    expect(workspaceTail("/home/u/proj/")).toBe("proj");
    expect(workspaceTail("C:\\work\\repo")).toBe("repo");
  });
});
