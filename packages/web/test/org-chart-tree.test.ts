/**
 * org-chart-tree.ts unit tests: the reporting line as a DFS tree from the CEO with orphans
 * set apart, the subtree an employee may not be moved under, and the layered layout — one
 * column per depth, leaves on successive rows, a parent centred on its children, elbow edges.
 */
import { describe, expect, it } from "vitest";
import {
  CHART_GAP_X,
  CHART_GAP_Y,
  CHART_NODE_H,
  CHART_NODE_W,
  CHART_PAD,
  buildChartTree,
  layoutChart,
  managerCandidates,
  subtreeIds,
  workspaceTail,
} from "../src/features/company/org-chart-tree";

const employees = [
  { agentId: "ceo", reportsTo: null },
  { agentId: "cto", reportsTo: "ceo" },
  { agentId: "dev1", reportsTo: "cto" },
  { agentId: "dev2", reportsTo: "cto" },
  { agentId: "cfo", reportsTo: "ceo" },
];

describe("buildChartTree", () => {
  it("walks the tree in DFS preorder from the CEO with depths", () => {
    const { nodes, orphans } = buildChartTree(employees, "ceo");
    expect(nodes.map((n) => [n.id, n.depth])).toEqual([
      ["ceo", 0],
      ["cto", 1],
      ["dev1", 2],
      ["dev2", 2],
      ["cfo", 1],
    ]);
    expect(orphans).toEqual([]);
  });

  it("lists employees whose chain never reaches the CEO as orphans, cycles included", () => {
    const { nodes, orphans } = buildChartTree(
      [...employees, { agentId: "x", reportsTo: "y" }, { agentId: "y", reportsTo: "x" }],
      "ceo",
    );
    expect(nodes.map((n) => n.id)).toEqual(["ceo", "cto", "dev1", "dev2", "cfo"]);
    expect(orphans).toEqual(["x", "y"]);
  });

  it("a missing CEO leaves everyone an orphan rather than inventing a root", () => {
    expect(buildChartTree(employees.slice(1), "ceo")).toEqual({
      nodes: [],
      orphans: ["cto", "dev1", "dev2", "cfo"],
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

describe("layoutChart", () => {
  it("puts depth in columns and leaves in rows, centring a parent on its children", () => {
    const { nodes } = buildChartTree(employees, "ceo");
    const layout = layoutChart(nodes);
    const at = (id: string) => layout.nodes.find((p) => p.node.id === id)!;
    const col = (depth: number) => CHART_PAD + depth * (CHART_NODE_W + CHART_GAP_X);
    const row = (r: number) => CHART_PAD + r * (CHART_NODE_H + CHART_GAP_Y);
    expect(at("ceo").x).toBe(col(0));
    expect(at("cto").x).toBe(col(1));
    expect(at("dev1").x).toBe(col(2));
    // Leaves dev1, dev2, cfo take rows 0, 1, 2; cto centres on rows 0–1; ceo on 0.5–2.
    expect(at("dev1").y).toBe(row(0));
    expect(at("dev2").y).toBe(row(1));
    expect(at("cfo").y).toBe(row(2));
    expect(at("cto").y).toBe(row(0.5));
    expect(at("ceo").y).toBe(row(1.25));
    expect(layout.width).toBe(CHART_PAD * 2 + 3 * CHART_NODE_W + 2 * CHART_GAP_X);
    expect(layout.height).toBe(CHART_PAD * 2 + 3 * CHART_NODE_H + 2 * CHART_GAP_Y);
  });

  it("draws a straight edge when aligned and an elbow otherwise", () => {
    const layout = layoutChart([
      { id: "a", parentId: null, depth: 0 },
      { id: "b", parentId: "a", depth: 1 },
    ]);
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]!.path.startsWith("M ")).toBe(true);
    expect(layout.edges[0]!.path.includes(" V ")).toBe(false);
    const { nodes } = buildChartTree(employees, "ceo");
    const elbows = layoutChart(nodes).edges.filter((e) => e.path.includes(" V "));
    expect(elbows.map((e) => e.toId).sort()).toEqual(["cfo", "cto", "dev1", "dev2"]);
  });

  it("is deterministic", () => {
    const { nodes } = buildChartTree(employees, "ceo");
    expect(layoutChart(nodes)).toEqual(layoutChart(nodes));
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
