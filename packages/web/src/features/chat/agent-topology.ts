/**
 * Subagent topology of one Task: pure extraction + layout, no React/DOM (unit-tested in
 * test/agent-topology.test.ts; rendering lives in agent-topology-view.tsx — same split as the
 * usage charts' chart-geom.ts / chart-svg.tsx).
 *
 * Extraction walks a single Task's slice of the main model — by default the LATEST Task (from
 * the last user_text / user_image item — the same "starts a new Task" predicate the reducer
 * uses; user_steering never starts one), or, for a chip clicked on an older turn, the
 * HISTORICAL Task slice containing that chip's child (extractTopologyForChild). It collects
 * spawned children from bound run_subagent tool cards and standalone SubagentItems, then
 * recurses into each child model's own items for deeper spawns. Nodes are deduped by session id
 * (an input_subagent repoll can reference the same child twice); a new Task therefore starts
 * from a graph of just the root again. Each child node also carries its elapsed-time sources
 * (from the nested model's activity stamps — wall clock of the whole spawn, never a sum of its
 * items).
 *
 * Layout is a simple layered tree: depth = column (left to right), leaves get successive rows
 * and a parent centers on its children; edges are orthogonal elbows between node midlines.
 * Node boxes are fixed-size (labels truncate inside them), which keeps the layout free of any
 * text measurement; graphs are small (≲15 nodes) and the view scrolls horizontally on overflow.
 */
import type { ChatItem, StreamModel } from "../../lib/omni/stream-model";
import { parseBackgroundTaskDoneMessage } from "./agent-handoff";

export interface TopologyNode {
  sessionId: string;
  /** Agent running this node: the child's session_meta capture first, else the run_subagent `agent_id` argument; null when unknown (root: filled by the view from the Session DTO). */
  agentId: string | null;
  /** The spawning call's model-written `description` — what this child was asked to do; null for the root, a standalone item, or when the model omitted it. */
  description: string | null;
  /** Still running — the spawning card's output hasn't completed (root: the Task's own running state; a standalone item has no card, so it reads as done). */
  running: boolean;
  /** 0 = the main session; +1 per spawn hop. */
  depth: number;
  /** Origin chain used to render this node's conversation as ctx.origin (ends with this node's own session id; empty for the root). */
  origin: string[];
  /** Parent node's session id; null for the root. */
  parentId: string | null;
  /**
   * Tick baseline while the node runs: when the child first appeared, preferring its first
   * message timestamp (survives a reload — a mid-run refresh keeps counting from the real spawn
   * moment) over the live wall-clock stamp (only meaningful while this client watched live).
   * Undefined for the root (it carries no stamps) and when nothing is known — the view then
   * omits the duration.
   */
  startedMs?: number;
  /**
   * Settled span for a finished node: first→last activity of the child's subtree, derived from
   * message timestamps so a history reload reproduces the same value (the local stamp pair is
   * only a fallback for unparseable timestamps — after a replay it would collapse to ~0).
   * Undefined for the root/unknown — omitted by the view.
   */
  elapsedMs?: number;
}

/**
 * Whether an item opens a new PANEL scope. The reducer's "starts a new Task" predicate
 * (user_text/user_image), minus one exception: a `[background_task_done]` harness notice does
 * start a chat Task (its auto-run answers it), but for the topology it belongs to the Task
 * that launched the background work — slicing there would split a background subagent's spawn
 * from its completion and reset the panel the moment the report lands.
 */
function isScopeStart(item: ChatItem): boolean {
  if (item.kind === "user_image") return true;
  if (item.kind !== "user_text") return false;
  return parseBackgroundTaskDoneMessage(item.text) === null;
}

/** Index of the latest Task's first item (see isScopeStart); 0 when there is none (mid-stream join). */
export function latestTaskStart(items: readonly ChatItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (isScopeStart(items[i]!)) return i;
  }
  return 0;
}

/**
 * Count of Task-starting user items (the reducer's startTask predicate: user_text/user_image —
 * steering chips and internal injections such as compaction summaries never become such items,
 * so they never count). The subagents panel's task-boundary signal: an INCREASE means the user
 * started a new Task in this session (see advancePanelTaskScope in use-subagents-panel.ts).
 */
export function taskStartCount(items: readonly ChatItem[]): number {
  let n = 0;
  for (const item of items) {
    if (isScopeStart(item)) n += 1;
  }
  return n;
}

/** Lenient string-field read from run_subagent arguments (complete JSON by the time a child is bound; unparseable/absent → null). */
function runSubagentArg(argsJson: string, field: string): string | null {
  try {
    const parsed: unknown = JSON.parse(argsJson);
    if (parsed !== null && typeof parsed === "object") {
      const value = (parsed as Record<string, unknown>)[field];
      if (typeof value === "string" && value.length > 0) return value;
    }
  } catch {
    // Arguments still streaming or malformed: nothing to offer.
  }
  return null;
}

/** Lenient `agent_id` extraction from run_subagent arguments. */
export function agentIdFromRunSubagentArgs(argsJson: string): string | null {
  return runSubagentArg(argsJson, "agent_id");
}

/**
 * The model-written `description` argument of run_subagent — one sentence saying what this
 * child was spawned to do. It is the only human-readable statement of a subagent's purpose
 * (the agent name says who, not what), so the graph renders it as each node's second line and
 * repeats it untruncated in the node tooltip. Optional: a model may omit it, and
 * `call_description: false` removes the property from the schema entirely — both read as null.
 */
export function descriptionFromRunSubagentArgs(argsJson: string): string | null {
  return runSubagentArg(argsJson, "description");
}

/** Extract the latest Task's spawn tree: root first, then children in DFS preorder (document order). */
export function extractTopology(
  model: StreamModel,
  rootSessionId: string,
  taskRunning: boolean,
): TopologyNode[] {
  return extractFromSlice(model.items.slice(latestTaskStart(model.items)), rootSessionId, {
    running: taskRunning,
  });
}

/**
 * Historical variant: extract the spawn tree of the Task slice CONTAINING the given direct
 * child — the slice around the main-stream item that references it (a bound run_subagent card
 * or a standalone SubagentItem), bounded by the nearest user_text/user_image on either side.
 * Null when no main-stream item references the child (e.g. a resync swapped in a fresh model) —
 * the caller then falls back to the latest Task. The root's running state stays live only while
 * the slice is still the open-ended latest Task; an older Task has ended by definition (the
 * next user message closed it).
 */
export function extractTopologyForChild(
  model: StreamModel,
  rootSessionId: string,
  taskRunning: boolean,
  childSessionId: string,
): TopologyNode[] | null {
  const items = model.items;
  const at = items.findIndex(
    (it) =>
      (it.kind === "tool_call" && it.subagentSessionId === childSessionId) ||
      (it.kind === "subagent" && it.sessionId === childSessionId),
  );
  if (at === -1) return null;
  // Slice bounds: the nearest Task-starting user item at or before the reference (falling back
  // to 0 on a mid-stream join with no user item), and the next one after it (end of stream for
  // the latest Task). Same "starts a new Task" predicate as latestTaskStart.
  let start = 0;
  for (let i = at; i >= 0; i--) {
    if (isScopeStart(items[i]!)) {
      start = i;
      break;
    }
  }
  let end = items.length;
  for (let i = at + 1; i < items.length; i++) {
    if (isScopeStart(items[i]!)) {
      end = i;
      break;
    }
  }
  return extractFromSlice(items.slice(start, end), rootSessionId, {
    running: end === items.length && taskRunning,
  });
}

/** Launch note of a run_in_background subagent: binds the card to its registry handle. */
const BG_SUBAGENT_LAUNCH_RE =
  /\[subagent running in background with subagent_id (subagent-[0-9a-f]+)/;

/**
 * Terminal knowledge about background subagents in one scope slice, from the notes the
 * harness itself writes: the `[background_task_done]` notice (kind subagent), an
 * input_subagent poll reporting the session idle, and kill_subagent's removal notes all mean
 * "no longer running"; a later `still running` poll (or a follow-up round) flips it back.
 * Ids are the registry handles (`subagent-<hex8>`); last mention wins, in item order.
 */
function backgroundSubagentStates(slice: readonly ChatItem[]): Map<string, "running" | "done"> {
  const states = new Map<string, "running" | "done">();
  for (const item of slice) {
    if (item.kind === "user_text") {
      const done = parseBackgroundTaskDoneMessage(item.text);
      if (done !== null && done.done.kind === "subagent") states.set(done.done.id, "done");
      continue;
    }
    if (item.kind !== "tool_call" || item.output.length === 0) continue;
    for (const m of item.output.matchAll(
      /\[subagent (?:running in background|still running) with subagent_id (subagent-[0-9a-f]+)/g,
    )) {
      states.set(m[1]!, "running");
    }
    for (const m of item.output.matchAll(
      /\[subagent idle with subagent_id (subagent-[0-9a-f]+)|\[subagent (subagent-[0-9a-f]+) (?:aborted and removed|was idle; session removed)/g,
    )) {
      states.set(m[1] ?? m[2]!, "done");
    }
  }
  return states;
}

/** Shared walker behind both extractions: builds the node list from one Task slice of the main items. */
function extractFromSlice(
  slice: readonly ChatItem[],
  rootSessionId: string,
  root: { running: boolean },
): TopologyNode[] {
  const nodes: TopologyNode[] = [
    {
      sessionId: rootSessionId,
      agentId: null,
      // The root was not spawned by anyone, so there is no spawning call to describe.
      description: null,
      running: root.running,
      depth: 0,
      origin: [],
      parentId: null,
    },
  ];
  const seen = new Set<string>([rootSessionId]);

  const addChild = (
    sessionId: string,
    child: StreamModel,
    running: boolean,
    parentId: string,
    parentOrigin: string[],
    argsAgentId: string | null,
    argsDescription: string | null,
  ): void => {
    if (seen.has(sessionId)) return;
    seen.add(sessionId);
    const origin = [...parentOrigin, sessionId];
    // Elapsed-time sources (see the StreamModel stamp docs): message timestamps first — they
    // survive a reload — with the live wall-clock stamps as the unparseable-timestamp fallback.
    const startedMs = child.firstTsMs ?? child.firstSeenLocalMs;
    const elapsedMs =
      child.firstTsMs !== undefined && child.lastActivityTsMs !== undefined
        ? Math.max(0, child.lastActivityTsMs - child.firstTsMs)
        : child.firstSeenLocalMs !== undefined && child.lastActivityLocalMs !== undefined
          ? Math.max(0, child.lastActivityLocalMs - child.firstSeenLocalMs)
          : undefined;
    nodes.push({
      sessionId,
      agentId: child.meta?.agentId ?? argsAgentId,
      description: argsDescription,
      running,
      depth: origin.length,
      origin,
      parentId,
      ...(startedMs !== undefined ? { startedMs } : {}),
      ...(elapsedMs !== undefined ? { elapsedMs } : {}),
    });
    // Deeper spawns live in the child model's own items (a child conversation is never Task-sliced — all of it belongs to this spawn).
    walk(child.items, sessionId, origin);
  };

  const bgStates = backgroundSubagentStates(slice);
  const walk = (items: readonly ChatItem[], parentId: string, parentOrigin: string[]): void => {
    for (const item of items) {
      if (item.kind === "tool_call" && item.subagent && item.subagentSessionId) {
        // A background launch's card completes immediately, so its running state comes from
        // the harness's own notes about the handle instead of the card's output stream.
        const bgId = BG_SUBAGENT_LAUNCH_RE.exec(item.output)?.[1] ?? null;
        addChild(
          item.subagentSessionId,
          item.subagent,
          bgId !== null ? bgStates.get(bgId) !== "done" : !item.outputComplete,
          parentId,
          parentOrigin,
          agentIdFromRunSubagentArgs(item.argumentsText),
          descriptionFromRunSubagentArgs(item.argumentsText),
        );
      } else if (item.kind === "subagent") {
        // A standalone child has no spawning card in this stream, so neither argument is available.
        addChild(item.sessionId, item.model, false, parentId, parentOrigin, null, null);
      }
    }
  };

  walk(slice, rootSessionId, []);
  return nodes;
}

/**
 * Whether the LATEST Task's slice references any spawned child (a bound run_subagent card or a
 * standalone SubagentItem). The chat page's auto-open trigger: combined with the running task
 * state, it fires only for a LIVE spawn in the current turn — children from earlier Tasks (or a
 * finished conversation opened from history) never pop the panel open.
 */
export function latestTaskHasSubagent(model: StreamModel): boolean {
  const items = model.items;
  for (let i = latestTaskStart(items); i < items.length; i++) {
    const item = items[i]!;
    if ((item.kind === "tool_call" && item.subagent !== undefined) || item.kind === "subagent") {
      return true;
    }
  }
  return false;
}

/** Walk the nested-model chain (`origin` ends with the target's own session id); null when a hop is missing or the chain is empty. */
export function modelAtOrigin(model: StreamModel, origin: readonly string[]): StreamModel | null {
  if (origin.length === 0) return null;
  let cur: StreamModel = model;
  for (const hop of origin) {
    const next = cur.subagents.get(hop);
    if (!next) return null;
    cur = next;
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Fixed node box (avatar + truncated name + elapsed time + status glyph) — no text measurement, so the layout stays pure. */
// Node box: two stacked lines — the Agent name (with elapsed + status) over the spawning
// call's description. Sized uniformly rather than per-node: variable heights would have to be
// threaded through row placement and edge geometry below, for the sake of a few nodes that
// carry no description (the root never does) and simply center their single line instead.
export const NODE_W = 200;
export const NODE_H = 46;
export const GAP_X = 32;
export const GAP_Y = 10;
export const PAD = 6;

export interface PlacedNode {
  node: TopologyNode;
  /** Top-left corner of the node box (CSS pixels within the layout canvas). */
  x: number;
  y: number;
}

export interface PlacedEdge {
  fromId: string;
  toId: string;
  /** SVG path between the two node midlines: straight when aligned, orthogonal elbow otherwise. */
  path: string;
}

export interface TopologyLayout {
  width: number;
  height: number;
  nodes: PlacedNode[];
  edges: PlacedEdge[];
}

/** Layered tree layout over extractTopology's output (root included; child order = extraction order). */
export function layoutTopology(nodes: readonly TopologyNode[]): TopologyLayout {
  const childrenOf = new Map<string, TopologyNode[]>();
  for (const n of nodes) {
    if (n.parentId === null) continue;
    const list = childrenOf.get(n.parentId);
    if (list) list.push(n);
    else childrenOf.set(n.parentId, [n]);
  }

  // Leaves take successive rows; a parent centers on its first and last child (rows can be fractional).
  const rowOf = new Map<string, number>();
  let nextLeafRow = 0;
  const assignRow = (node: TopologyNode): number => {
    const kids = childrenOf.get(node.sessionId) ?? [];
    let row: number;
    if (kids.length === 0) {
      row = nextLeafRow++;
    } else {
      const rows = kids.map(assignRow);
      row = (rows[0]! + rows[rows.length - 1]!) / 2;
    }
    rowOf.set(node.sessionId, row);
    return row;
  };
  for (const n of nodes) if (n.parentId === null) assignRow(n);

  const placed: PlacedNode[] = nodes.map((node) => ({
    node,
    x: PAD + node.depth * (NODE_W + GAP_X),
    y: PAD + (rowOf.get(node.sessionId) ?? 0) * (NODE_H + GAP_Y),
  }));
  const byId = new Map(placed.map((p) => [p.node.sessionId, p]));

  const edges: PlacedEdge[] = [];
  for (const p of placed) {
    if (p.node.parentId === null) continue;
    const from = byId.get(p.node.parentId);
    if (!from) continue;
    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H / 2;
    const x2 = p.x;
    const y2 = p.y + NODE_H / 2;
    const midX = x1 + GAP_X / 2;
    edges.push({
      fromId: from.node.sessionId,
      toId: p.node.sessionId,
      path: y1 === y2 ? `M ${x1} ${y1} H ${x2}` : `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`,
    });
  }

  const maxDepth = nodes.reduce((acc, n) => Math.max(acc, n.depth), 0);
  const rows = Math.max(1, nextLeafRow);
  return {
    width: PAD * 2 + (maxDepth + 1) * NODE_W + maxDepth * GAP_X,
    height: PAD * 2 + rows * NODE_H + (rows - 1) * GAP_Y,
    nodes: placed,
    edges,
  };
}

// ---------------------------------------------------------------------------
// Display-name resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a node's display label from the loaded lists: agent id (session_meta capture /
 * run_subagent argument, else the session list row's agentId) → the project agents list's
 * display name (name, with an EMPTY name treated as missing, falling back to the agent id
 * itself) → the child session's title.
 * Null when nothing is known — the caller falls back to a generic label plus the short session id.
 */
export function resolveAgentLabel(
  node: { sessionId: string; agentId: string | null },
  agents: readonly { agentId: string; name?: string }[],
  sessions: readonly { sessionId: string; agentId: string; title?: string }[],
): string | null {
  const row = sessions.find((s) => s.sessionId === node.sessionId);
  const agentId = node.agentId ?? row?.agentId ?? null;
  if (agentId !== null) {
    const agent = agents.find((a) => a.agentId === agentId);
    return agent ? (agent.name?.length ? agent.name : agent.agentId) : agentId;
  }
  return row?.title ?? null;
}

/** Short session-id suffix for chips and node subtitles (ids end in a hex run — the tail is the distinctive part). */
export function shortSessionId(sessionId: string): string {
  return sessionId.length > 8 ? sessionId.slice(-8) : sessionId;
}
