/**
 * The org chart's tree and layout (pure, unit tested): the reporting line as a tree rooted at
 * the CEO, laid out top-down the way an org chart reads — the root at the top centre, each
 * depth one row lower, siblings side by side, a parent centred over its children. Every
 * subtree owns a horizontal band as wide as its widest generation, so bands never overlap
 * and a deep subtree pushes its cousins outward instead of stacking on them. Node boxes are
 * fixed-size, so the layout needs no text measurement and is the same in a test as on screen.
 *
 * Employees whose reporting line never reaches the CEO — the manager left, or the line loops —
 * are not dropped: they go to a "detached" row under the tree, without edges, so the page can
 * mark them and offer the reporting-line fix.
 */

export interface ChartTreeNode {
  id: string;
  parentId: string | null;
  depth: number;
}

/**
 * The tree in DFS preorder from the CEO (children in the chart's own order), plus the
 * employees whose reporting chain never reaches the CEO — a cycle, or a manager that left
 * the chart — listed apart. A missing CEO leaves everyone detached rather than inventing a
 * root.
 */
export function buildChartTree(
  employees: ReadonlyArray<{ agentId: string; reportsTo: string | null }>,
  ceoAgentId: string,
): { nodes: ChartTreeNode[]; detached: string[] } {
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
  const detached = employees.map((e) => e.agentId).filter((id) => !seen.has(id));
  return { nodes, detached };
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

/** Card box (px). Fixed so the layout is text-free; the card fits name + title, state + workspace + spend, and a ratio bar. */
export const CHART_NODE_W = 240;
export const CHART_NODE_H = 92;
/** Between sibling cards, and between one generation's bottom and the next one's top. */
export const CHART_GAP_X = 48;
export const CHART_GAP_Y = 64;
/** Breathing room around the whole drawing. */
export const CHART_PAD = 16;
/** Corner radius of a connector's two elbows (shrinks when the horizontal run is shorter). */
export const CHART_EDGE_RADIUS = 8;
/** Room above the detached row for its label. */
export const CHART_DETACHED_LABEL_H = 24;

export interface OrgTreeNode extends ChartTreeNode {
  /** Top-left corner of the card. */
  x: number;
  y: number;
  /** In the detached row rather than the tree. */
  detached: boolean;
}

export interface OrgTreeEdge {
  fromId: string;
  toId: string;
  /** SVG path: parent bottom centre, down to the rail, along it, down to the child's top centre. */
  path: string;
}

export interface OrgTreeLayout {
  width: number;
  height: number;
  nodes: OrgTreeNode[];
  edges: OrgTreeEdge[];
  /** Ids in the detached row, in chart order (empty when every employee hangs off the CEO). */
  detached: string[];
  /** The detached row's top edge; null without one. */
  detachedTop: number | null;
}

/** An orthogonal connector with rounded elbows: down from (x1, y1) to the rail, along it, down to (x2, y2). */
export function connectorPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  railY: number,
): string {
  if (x1 === x2) return `M ${x1} ${y1} V ${y2}`;
  const dir = x2 > x1 ? 1 : -1;
  const r = Math.min(CHART_EDGE_RADIUS, Math.abs(x2 - x1) / 2, (railY - y1) / 2, (y2 - railY) / 2);
  return (
    `M ${x1} ${y1} V ${railY - r} Q ${x1} ${railY} ${x1 + dir * r} ${railY}` +
    ` H ${x2 - dir * r} Q ${x2} ${railY} ${x2} ${railY + r} V ${y2}`
  );
}

/**
 * Top-down layout of the reporting tree. Widths first: a leaf is one card wide, a parent as
 * wide as its children's bands plus the gaps between them. Then positions: children are
 * placed left to right inside the parent's band, and the parent's x is the midpoint of its
 * first and last child's, so its stem meets the rail in the middle. The tree and the
 * detached row are each centred on the wider of the two.
 */
export function layoutOrgTree(
  employees: ReadonlyArray<{ agentId: string; reportsTo: string | null }>,
  ceoAgentId: string,
): OrgTreeLayout {
  const { nodes, detached } = buildChartTree(employees, ceoAgentId);
  const childrenOf = new Map<string, ChartTreeNode[]>();
  for (const n of nodes) {
    if (n.parentId === null) continue;
    const list = childrenOf.get(n.parentId);
    if (list) list.push(n);
    else childrenOf.set(n.parentId, [n]);
  }

  const bandOf = new Map<string, number>();
  const measure = (node: ChartTreeNode): number => {
    const kids = childrenOf.get(node.id) ?? [];
    const band =
      kids.length === 0
        ? CHART_NODE_W
        : kids.reduce((acc, k) => acc + measure(k), 0) + (kids.length - 1) * CHART_GAP_X;
    bandOf.set(node.id, band);
    return band;
  };
  const root = nodes.find((n) => n.parentId === null);
  const treeW = root === undefined ? 0 : measure(root);
  const maxDepth = nodes.reduce((acc, n) => Math.max(acc, n.depth), 0);
  const treeH = root === undefined ? 0 : (maxDepth + 1) * CHART_NODE_H + maxDepth * CHART_GAP_Y;

  const rowW =
    detached.length === 0
      ? 0
      : detached.length * CHART_NODE_W + (detached.length - 1) * CHART_GAP_X;
  const innerW = Math.max(treeW, rowW);
  const treeLeft = CHART_PAD + (innerW - treeW) / 2;
  const rowLeft = CHART_PAD + (innerW - rowW) / 2;

  const xOf = new Map<string, number>();
  const place = (node: ChartTreeNode, left: number): void => {
    const kids = childrenOf.get(node.id) ?? [];
    if (kids.length === 0) {
      xOf.set(node.id, left);
      return;
    }
    let cursor = left;
    for (const k of kids) {
      place(k, cursor);
      cursor += bandOf.get(k.id)! + CHART_GAP_X;
    }
    const first = xOf.get(kids[0]!.id)!;
    const last = xOf.get(kids[kids.length - 1]!.id)!;
    xOf.set(node.id, (first + last) / 2);
  };
  if (root !== undefined) place(root, treeLeft);

  const detachedTop =
    detached.length === 0
      ? null
      : CHART_PAD + treeH + (treeH > 0 ? CHART_GAP_Y : 0) + CHART_DETACHED_LABEL_H;

  const placed: OrgTreeNode[] = nodes.map((node) => ({
    ...node,
    x: Math.round(xOf.get(node.id) ?? treeLeft),
    y: CHART_PAD + node.depth * (CHART_NODE_H + CHART_GAP_Y),
    detached: false,
  }));
  detached.forEach((id, i) => {
    placed.push({
      id,
      parentId: null,
      depth: maxDepth + 1,
      x: Math.round(rowLeft + i * (CHART_NODE_W + CHART_GAP_X)),
      y: detachedTop!,
      detached: true,
    });
  });

  const byId = new Map(placed.map((p) => [p.id, p]));
  const edges: OrgTreeEdge[] = [];
  for (const p of placed) {
    if (p.parentId === null) continue;
    const from = byId.get(p.parentId);
    if (!from) continue;
    const x1 = from.x + CHART_NODE_W / 2;
    const y1 = from.y + CHART_NODE_H;
    const x2 = p.x + CHART_NODE_W / 2;
    const y2 = p.y;
    edges.push({
      fromId: from.id,
      toId: p.id,
      path: connectorPath(x1, y1, x2, y2, y1 + CHART_GAP_Y / 2),
    });
  }

  const bottom = detachedTop === null ? CHART_PAD + treeH : detachedTop + CHART_NODE_H;
  return {
    width: innerW + CHART_PAD * 2,
    height: (innerW === 0 ? 0 : bottom) + CHART_PAD,
    nodes: placed,
    edges,
    detached,
    detachedTop,
  };
}

/** The last path segment of a workspace (`.` and the root stay as they are): the node's workspace tail. */
export function workspaceTail(workspace: string): string {
  const trimmed = workspace.trim();
  if (trimmed === "" || trimmed === ".") return ".";
  const parts = trimmed.split(/[/\\]+/).filter(Boolean);
  return parts[parts.length - 1] ?? "/";
}
