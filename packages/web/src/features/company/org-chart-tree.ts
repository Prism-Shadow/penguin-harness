/**
 * The org chart's tree and layout (pure, unit tested): the reporting line as a tree rooted at
 * the CEO, laid out as a layered tree — depth = column, leaves take successive rows, a parent
 * centres on its children, edges are orthogonal elbows between node midlines. The same
 * algorithm the subagent topology view uses, over employees instead of sessions; node boxes
 * are fixed-size so the layout needs no text measurement.
 */

export interface ChartTreeNode {
  id: string;
  parentId: string | null;
  depth: number;
}

/**
 * The tree in DFS preorder from the CEO (children in the chart's own order), plus the
 * employees whose reporting chain never reaches the CEO — a cycle, or a manager that left
 * the chart — listed apart so the page can show them with a danger mark instead of dropping
 * them.
 */
export function buildChartTree(
  employees: ReadonlyArray<{ agentId: string; reportsTo: string | null }>,
  ceoAgentId: string,
): { nodes: ChartTreeNode[]; orphans: string[] } {
  const childrenOf = new Map<string, string[]>();
  for (const e of employees) {
    if (e.reportsTo === null || e.agentId === ceoAgentId) continue;
    const list = childrenOf.get(e.reportsTo);
    if (list) list.push(e.agentId);
    else childrenOf.set(e.reportsTo, [e.agentId]);
  }
  const nodes: ChartTreeNode[] = [];
  const seen = new Set<string>();
  const hasCeo = employees.some((e) => e.agentId === ceoAgentId);
  const walk = (id: string, parentId: string | null, depth: number): void => {
    if (seen.has(id)) return;
    seen.add(id);
    nodes.push({ id, parentId, depth });
    for (const child of childrenOf.get(id) ?? []) walk(child, id, depth + 1);
  };
  if (hasCeo) walk(ceoAgentId, null, 0);
  const orphans = employees.map((e) => e.agentId).filter((id) => !seen.has(id));
  return { nodes, orphans };
}

/** Every employee in `rootId`'s subtree, itself included — the ids a reporting-line change must not pick as the new manager. */
export function subtreeIds(
  employees: ReadonlyArray<{ agentId: string; reportsTo: string | null }>,
  rootId: string,
): Set<string> {
  const out = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of employees) {
      if (e.reportsTo !== null && out.has(e.reportsTo) && !out.has(e.agentId)) {
        out.add(e.agentId);
        grew = true;
      }
    }
  }
  return out;
}

/** Managers an employee may be moved under: anyone outside its own subtree (a report cannot manage its manager's manager's… self). */
export function managerCandidates<T extends { agentId: string; reportsTo: string | null }>(
  employees: readonly T[],
  agentId: string,
): T[] {
  const excluded = subtreeIds(employees, agentId);
  return employees.filter((e) => !excluded.has(e.agentId));
}

export const CHART_NODE_W = 236;
export const CHART_NODE_H = 66;
export const CHART_GAP_X = 44;
export const CHART_GAP_Y = 12;
export const CHART_PAD = 8;

export interface PlacedChartNode {
  node: ChartTreeNode;
  x: number;
  y: number;
}

export interface PlacedChartEdge {
  fromId: string;
  toId: string;
  path: string;
}

export interface ChartLayout {
  width: number;
  height: number;
  nodes: PlacedChartNode[];
  edges: PlacedChartEdge[];
}

/** Layered tree layout over buildChartTree's nodes (root included; child order = node order). */
export function layoutChart(nodes: readonly ChartTreeNode[]): ChartLayout {
  const childrenOf = new Map<string, ChartTreeNode[]>();
  for (const n of nodes) {
    if (n.parentId === null) continue;
    const list = childrenOf.get(n.parentId);
    if (list) list.push(n);
    else childrenOf.set(n.parentId, [n]);
  }
  const rowOf = new Map<string, number>();
  let nextLeafRow = 0;
  const assignRow = (node: ChartTreeNode): number => {
    const kids = childrenOf.get(node.id) ?? [];
    let row: number;
    if (kids.length === 0) {
      row = nextLeafRow++;
    } else {
      const rows = kids.map(assignRow);
      row = (rows[0]! + rows[rows.length - 1]!) / 2;
    }
    rowOf.set(node.id, row);
    return row;
  };
  for (const n of nodes) if (n.parentId === null) assignRow(n);

  const placed: PlacedChartNode[] = nodes.map((node) => ({
    node,
    x: CHART_PAD + node.depth * (CHART_NODE_W + CHART_GAP_X),
    y: CHART_PAD + (rowOf.get(node.id) ?? 0) * (CHART_NODE_H + CHART_GAP_Y),
  }));
  const byId = new Map(placed.map((p) => [p.node.id, p]));
  const edges: PlacedChartEdge[] = [];
  for (const p of placed) {
    if (p.node.parentId === null) continue;
    const from = byId.get(p.node.parentId);
    if (!from) continue;
    const x1 = from.x + CHART_NODE_W;
    const y1 = from.y + CHART_NODE_H / 2;
    const x2 = p.x;
    const y2 = p.y + CHART_NODE_H / 2;
    const midX = x1 + CHART_GAP_X / 2;
    edges.push({
      fromId: from.node.id,
      toId: p.node.id,
      path: y1 === y2 ? `M ${x1} ${y1} H ${x2}` : `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`,
    });
  }
  const maxDepth = nodes.reduce((acc, n) => Math.max(acc, n.depth), 0);
  const rows = Math.max(1, nextLeafRow);
  return {
    width: CHART_PAD * 2 + (maxDepth + 1) * CHART_NODE_W + maxDepth * CHART_GAP_X,
    height: CHART_PAD * 2 + rows * CHART_NODE_H + (rows - 1) * CHART_GAP_Y,
    nodes: placed,
    edges,
  };
}

/** The last path segment of a workspace (`.` and the root stay as they are): the node's workspace tail. */
export function workspaceTail(workspace: string): string {
  const trimmed = workspace.trim();
  if (trimmed === "" || trimmed === ".") return ".";
  const parts = trimmed.split(/[/\\]+/).filter(Boolean);
  return parts[parts.length - 1] ?? "/";
}
