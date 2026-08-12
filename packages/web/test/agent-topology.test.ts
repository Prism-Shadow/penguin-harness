/**
 * agent-topology.ts unit tests: latest-Task extraction (spawns, deep spawns, dedupe on a
 * repolled child, the task boundary at a new user message), the historical-Task variant
 * (extractTopologyForChild slicing around an older chip's child), per-node elapsed-time
 * sources (live wall-clock stamps vs. message timestamps across a history replay), identity
 * resolution (session_meta capture vs. the run_subagent agent_id argument, agent_state path
 * parsing), the pending-approval subtree predicate, and layered-tree layout
 * determinism/geometry.
 */
import { describe, expect, it, vi } from "vitest";
import {
  approvalDecision,
  assistantText,
  imageUrlMessage,
  sessionMeta,
  toolCall,
  toolCallOutput,
  userText,
  withOrigin,
} from "@prismshadow/penguin-core/omnimessage";
import type { OmniMessage, SessionMetaPayload } from "@prismshadow/penguin-core/omnimessage";
import {
  agentIdFromStatePath,
  approvalKey,
  createStreamModel,
  hasPendingWithinOrigin,
  pushMessage,
} from "../src/lib/omni/stream-model";
import type { StreamModel, SubagentItem } from "../src/lib/omni/stream-model";
import {
  agentIdFromRunSubagentArgs,
  extractTopology,
  extractTopologyForChild,
  GAP_X,
  GAP_Y,
  latestTaskHasSubagent,
  latestTaskStart,
  layoutTopology,
  modelAtOrigin,
  NODE_H,
  NODE_W,
  PAD,
  resolveAgentLabel,
  shortSessionId,
  taskStartCount,
} from "../src/features/chat/agent-topology";

function meta(sessionId: string, agentState = "/a"): OmniMessage<SessionMetaPayload> {
  return sessionMeta({
    session_id: sessionId,
    model_id: "m",
    provider: "custom",
    model_context_window: 200000,
    system_prompt: "",
    agent_state: agentState,
    workspace: "/w",
    source: "subagent",
  });
}

/** Spawn a child bound to a run_subagent card: card + allow + first child-origin message. */
function spawnChild(m: StreamModel, toolCallId: string, sessionId: string, args = "{}"): void {
  pushMessage(m, toolCall({ name: "run_subagent", arguments: args, toolCallId }));
  pushMessage(m, approvalDecision("allow", toolCallId));
  pushMessage(m, withOrigin(meta(sessionId), sessionId));
}

/** Override a message timestamp (the builders default to the current time). */
function at<M extends OmniMessage>(msg: M, ts: string): M {
  return { ...msg, timestamp: ts };
}

describe("extractTopology", () => {
  it("returns only the root (with the Task's running state) when nothing is spawned", () => {
    const m = createStreamModel();
    pushMessage(m, userText("hello"));
    const nodes = extractTopology(m, "root", true);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      sessionId: "root",
      depth: 0,
      origin: [],
      parentId: null,
      running: true,
      agentId: null,
    });
    expect(extractTopology(m, "root", false)[0]!.running).toBe(false);
  });

  it("collects a bound spawn with agent_id from the call arguments; running follows the card's output state", () => {
    const m = createStreamModel();
    pushMessage(m, userText("go"));
    spawnChild(m, "t1", "child1", '{"prompt": "count", "agent_id": "researcher"}');
    let nodes = extractTopology(m, "root", true);
    expect(nodes).toHaveLength(2);
    expect(nodes[1]).toMatchObject({
      sessionId: "child1",
      agentId: "researcher",
      running: true,
      depth: 1,
      origin: ["child1"],
      parentId: "root",
    });

    pushMessage(m, toolCallOutput({ output: "done", toolCallId: "t1" }));
    nodes = extractTopology(m, "root", false);
    expect(nodes[1]!.running).toBe(false);
  });

  it("prefers the child's own session_meta capture (agent_state path) over the call-argument agent id", () => {
    const m = createStreamModel();
    pushMessage(m, userText("go"));
    pushMessage(
      m,
      toolCall({ name: "run_subagent", arguments: '{"agent_id": "arg_agent"}', toolCallId: "t1" }),
    );
    pushMessage(m, approvalDecision("allow", "t1"));
    pushMessage(
      m,
      withOrigin(meta("child1", "/data/proj/agents/meta_agent/agent_state"), "child1"),
    );
    const nodes = extractTopology(m, "root", true);
    expect(nodes[1]!.agentId).toBe("meta_agent");
  });

  it("recurses into a child's own items for deeper spawns (bound grandchild: depth 2, full origin chain)", () => {
    const m = createStreamModel();
    pushMessage(m, userText("go"));
    spawnChild(m, "t1", "child1");
    // The child spawns its own subagent: run_subagent card + allow + first grandchild message, all inside child1.
    pushMessage(
      m,
      withOrigin(toolCall({ name: "run_subagent", arguments: "{}", toolCallId: "s1" }), "child1"),
    );
    pushMessage(m, withOrigin(approvalDecision("allow", "s1"), "child1"));
    pushMessage(m, withOrigin(withOrigin(assistantText("gc reply"), "gc1"), "child1"));

    const nodes = extractTopology(m, "root", true);
    expect(nodes.map((n) => n.sessionId)).toEqual(["root", "child1", "gc1"]);
    expect(nodes[2]).toMatchObject({
      depth: 2,
      origin: ["child1", "gc1"],
      parentId: "child1",
      running: true,
    });
  });

  it("collects a standalone SubagentItem (no bindable card) as a done node and dedupes a second reference to the same child", () => {
    const m = createStreamModel();
    pushMessage(m, userText("go"));
    // Denied card never binds -> the child lands as a standalone item.
    pushMessage(m, toolCall({ name: "run_subagent", arguments: "{}", toolCallId: "t1" }));
    pushMessage(m, approvalDecision("deny", "t1"));
    pushMessage(m, withOrigin(meta("childX"), "childX"));
    const standalone = m.items.find((i) => i.kind === "subagent") as SubagentItem;
    // A repoll referencing the same child again (defensive: extraction must not duplicate the node).
    m.items.push({ kind: "subagent", id: 999, sessionId: "childX", model: standalone.model });

    const nodes = extractTopology(m, "root", true);
    expect(nodes.filter((n) => n.sessionId === "childX")).toHaveLength(1);
    expect(nodes[1]).toMatchObject({ sessionId: "childX", running: false, parentId: "root" });
  });

  it("shows only the latest Task's spawns: a new user message resets the graph to the root", () => {
    const m = createStreamModel();
    pushMessage(m, userText("task 1"));
    spawnChild(m, "t1", "child1");
    pushMessage(m, toolCallOutput({ output: "done", toolCallId: "t1" }));

    pushMessage(m, userText("task 2"));
    expect(extractTopology(m, "root", true).map((n) => n.sessionId)).toEqual(["root"]);

    spawnChild(m, "t2", "child2");
    expect(extractTopology(m, "root", true).map((n) => n.sessionId)).toEqual(["root", "child2"]);
  });
});

describe("extractTopologyForChild (historical Task slice)", () => {
  /** Task 1 spawns child1 (finished), then Task 2 spawns child2 (still running). */
  const twoTasks = (): StreamModel => {
    const m = createStreamModel();
    pushMessage(m, userText("task 1"));
    spawnChild(m, "t1", "child1");
    pushMessage(m, toolCallOutput({ output: "done", toolCallId: "t1" }));
    pushMessage(m, userText("task 2"));
    spawnChild(m, "t2", "child2");
    return m;
  };

  it("a chip from an older Task yields THAT Task's tree while the default extraction stays on the latest", () => {
    const m = twoTasks();
    expect(extractTopology(m, "root", true).map((n) => n.sessionId)).toEqual(["root", "child2"]);
    const historical = extractTopologyForChild(m, "root", true, "child1")!;
    expect(historical.map((n) => n.sessionId)).toEqual(["root", "child1"]);
    // An older Task has ended by definition (the next user message closed it): its root reads
    // done even while the LATEST Task is running.
    expect(historical[0]!.running).toBe(false);
    expect(historical[1]!.running).toBe(false);
  });

  it("anchoring on a latest-Task child returns the live latest slice (root keeps the running state)", () => {
    const latest = extractTopologyForChild(twoTasks(), "root", true, "child2")!;
    expect(latest.map((n) => n.sessionId)).toEqual(["root", "child2"]);
    expect(latest[0]!.running).toBe(true);
    expect(latest[1]!.running).toBe(true);
  });

  it("an unreferenced anchor gives null — the caller falls back to the latest Task", () => {
    expect(extractTopologyForChild(twoTasks(), "root", true, "ghost")).toBeNull();
  });

  it("anchors on a standalone SubagentItem; a mid-stream join with no leading user item slices from the start, bounded by the next Task", () => {
    const m = createStreamModel();
    // Mid-stream join: the child appears before any user item (no bindable card either).
    pushMessage(m, withOrigin(meta("childX"), "childX"));
    pushMessage(m, userText("next task"));
    spawnChild(m, "t9", "childY");
    const nodes = extractTopologyForChild(m, "root", true, "childX")!;
    // The slice runs from the stream start to the next user item: childY never leaks in.
    expect(nodes.map((n) => n.sessionId)).toEqual(["root", "childX"]);
    expect(nodes[0]!.running).toBe(false);
  });
});

describe("latestTaskHasSubagent (auto-open trigger)", () => {
  it("true only while the LATEST Task references a spawn; a plain follow-up Task resets it", () => {
    const m = createStreamModel();
    pushMessage(m, userText("task 1"));
    expect(latestTaskHasSubagent(m)).toBe(false);
    spawnChild(m, "t1", "child1");
    expect(latestTaskHasSubagent(m)).toBe(true);
    // A new Task without spawns: the earlier child must not keep the trigger armed.
    pushMessage(m, userText("task 2, no spawns"));
    expect(latestTaskHasSubagent(m)).toBe(false);
  });

  it("counts a standalone SubagentItem (unbindable spawn) too", () => {
    const m = createStreamModel();
    pushMessage(m, userText("go"));
    pushMessage(m, withOrigin(meta("childX"), "childX")); // no bindable card -> standalone item
    expect(latestTaskHasSubagent(m)).toBe(true);
  });
});

describe("per-node elapsed time (wall clock of the spawn, never a sum of items)", () => {
  const T0 = Date.parse("2026-07-25T10:00:00.000Z");
  const iso = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString();

  it("live: a running child ticks from its first message timestamp; done freezes at its last activity", () => {
    const m = createStreamModel();
    pushMessage(m, at(userText("go"), iso(0)), 1_000);
    pushMessage(
      m,
      at(toolCall({ name: "run_subagent", arguments: "{}", toolCallId: "t1" }), iso(1_000)),
      2_000,
    );
    pushMessage(m, at(approvalDecision("allow", "t1"), iso(1_500)), 2_500);
    pushMessage(m, at(withOrigin(meta("child1"), "child1"), iso(2_000)), 3_000);
    let node = extractTopology(m, "root", true)[1]!;
    expect(node.running).toBe(true);
    expect(node.startedMs).toBe(T0 + 2_000);

    pushMessage(m, at(withOrigin(assistantText("report"), "child1"), iso(9_000)), 10_000);
    pushMessage(m, at(toolCallOutput({ output: "done", toolCallId: "t1" }), iso(9_500)), 10_500);
    node = extractTopology(m, "root", false)[1]!;
    expect(node.running).toBe(false);
    expect(node.elapsedMs).toBe(7_000); // child first appeared at +2s, last acted at +9s
    // The live wall-clock stamps recorded the same lifecycle in local time.
    const sub = m.subagents.get("child1")!;
    expect(sub.firstSeenLocalMs).toBe(3_000);
    expect(sub.lastActivityLocalMs).toBe(10_000);
  });

  it("history replay: local stamps collapse to the load instant, so the span comes from message timestamps", () => {
    // One synchronous replay: every push shares the same local `now` (pushMessages evaluates it once).
    const LOAD = 5_000_000;
    const m = createStreamModel();
    pushMessage(m, at(userText("go"), iso(0)), LOAD);
    pushMessage(
      m,
      at(toolCall({ name: "run_subagent", arguments: "{}", toolCallId: "t1" }), iso(1_000)),
      LOAD,
    );
    pushMessage(m, at(approvalDecision("allow", "t1"), iso(1_500)), LOAD);
    pushMessage(m, at(withOrigin(meta("child1"), "child1"), iso(2_000)), LOAD);
    pushMessage(m, at(withOrigin(assistantText("report"), "child1"), iso(60_000)), LOAD);
    pushMessage(m, at(toolCallOutput({ output: "done", toolCallId: "t1" }), iso(61_000)), LOAD);

    // The trap this design avoids: after a replay the local pair spans ~0 (load-relative).
    const sub = m.subagents.get("child1")!;
    expect(sub.lastActivityLocalMs! - sub.firstSeenLocalMs!).toBe(0);
    const node = extractTopology(m, "root", false)[1]!;
    expect(node.elapsedMs).toBe(58_000); // +2s → +60s in message time, reproduced after reload
    expect(node.startedMs).toBe(T0 + 2_000);
  });

  it("unparseable timestamps fall back to the local wall-clock pair; the root never carries a duration", () => {
    const m = createStreamModel();
    pushMessage(m, at(userText("go"), "not-a-date"), 1_000);
    pushMessage(
      m,
      at(toolCall({ name: "run_subagent", arguments: "{}", toolCallId: "t1" }), "not-a-date"),
      1_100,
    );
    pushMessage(m, at(approvalDecision("allow", "t1"), "not-a-date"), 1_200);
    pushMessage(m, at(withOrigin(meta("child1"), "child1"), "not-a-date"), 2_000);
    pushMessage(m, at(withOrigin(assistantText("r"), "child1"), "not-a-date"), 6_000);
    const nodes = extractTopology(m, "root", true);
    expect(nodes[0]!.startedMs).toBeUndefined();
    expect(nodes[0]!.elapsedMs).toBeUndefined();
    expect(nodes[1]!.startedMs).toBe(2_000); // firstSeenLocalMs fallback
    expect(nodes[1]!.elapsedMs).toBe(4_000); // local pair span
  });
});

describe("identity helpers", () => {
  it("latestTaskStart finds the last user_text/user_image and falls back to 0 (user items only — steering never starts a Task)", () => {
    const m = createStreamModel();
    pushMessage(m, assistantText("orphan"));
    expect(latestTaskStart(m.items)).toBe(0);
    pushMessage(m, userText("t1"));
    expect(latestTaskStart(m.items)).toBe(1);
  });

  it("taskStartCount counts Task-starting user items (text and image); steering chips never count", () => {
    const m = createStreamModel();
    expect(taskStartCount(m.items)).toBe(0);
    pushMessage(m, userText("t1"));
    pushMessage(m, assistantText("r1"));
    // Mid-run steering renders as a user_steering item — inside the running Task, not a new one.
    pushMessage(m, userText("[user_steering]\nnudge\n[/user_steering]"));
    expect(taskStartCount(m.items)).toBe(1);
    // An image sent WITH that steering message follows it directly and joins its chip, so it
    // starts nothing either; the assistant reply then closes the chip's collection window.
    pushMessage(m, imageUrlMessage("data:image/png;base64,steered"));
    expect(taskStartCount(m.items)).toBe(1);
    pushMessage(m, assistantText("r2"));
    // A standalone Prompt image (no steering message in front of it) still starts a Task.
    pushMessage(m, imageUrlMessage("data:image/png;base64,xx"));
    expect(taskStartCount(m.items)).toBe(2);
    pushMessage(m, userText("t3"));
    expect(taskStartCount(m.items)).toBe(3);
  });

  it("agentIdFromStatePath takes the parent directory name; degenerate paths give null", () => {
    expect(agentIdFromStatePath("/data/proj/agents/researcher/agent_state")).toBe("researcher");
    expect(agentIdFromStatePath("C:\\data\\proj\\agents\\win_agent\\agent_state")).toBe(
      "win_agent",
    );
    expect(agentIdFromStatePath("agent_state")).toBeNull();
    expect(agentIdFromStatePath("")).toBeNull();
  });

  it("agentIdFromRunSubagentArgs reads agent_id from complete JSON only", () => {
    expect(agentIdFromRunSubagentArgs('{"prompt": "x", "agent_id": "helper"}')).toBe("helper");
    expect(agentIdFromRunSubagentArgs('{"prompt": "x"}')).toBeNull();
    expect(agentIdFromRunSubagentArgs('{"agent_id": "hel')).toBeNull();
    expect(agentIdFromRunSubagentArgs("")).toBeNull();
  });

  it("session_meta capture lands on the nested model (agent/provider/model/source), never on the main model", () => {
    const m = createStreamModel();
    pushMessage(m, meta("main", "/data/proj/agents/main_agent/agent_state"));
    expect(m.meta).toBeNull();
    pushMessage(m, withOrigin(meta("c1", "/data/proj/agents/child_agent/agent_state"), "c1"));
    expect(m.subagents.get("c1")!.meta).toEqual({
      agentId: "child_agent",
      provider: "custom",
      modelId: "m",
      source: "subagent",
    });
  });

  it("modelAtOrigin walks the nested chain; a missing hop or an empty chain gives null", () => {
    const m = createStreamModel();
    pushMessage(m, withOrigin(withOrigin(assistantText("deep"), "gc1"), "c1"));
    expect(modelAtOrigin(m, ["c1"])).toBe(m.subagents.get("c1"));
    expect(modelAtOrigin(m, ["c1", "gc1"])).toBe(m.subagents.get("c1")!.subagents.get("gc1"));
    expect(modelAtOrigin(m, ["c1", "nope"])).toBeNull();
    expect(modelAtOrigin(m, [])).toBeNull();
  });

  it("hasPendingWithinOrigin matches keys at or below the chain, never the main session's own keys", () => {
    const keys = [
      approvalKey([], "t-main"),
      approvalKey(["c1"], "t-child"),
      approvalKey(["c1", "gc1"], "t-deep"),
    ];
    expect(hasPendingWithinOrigin(keys, ["c1"])).toBe(true);
    expect(hasPendingWithinOrigin(keys, ["c1", "gc1"])).toBe(true);
    expect(hasPendingWithinOrigin(keys, ["c2"])).toBe(false);
    expect(hasPendingWithinOrigin([approvalKey([], "t-main")], ["c1"])).toBe(false);
  });

  it("resolveAgentLabel: agents list name -> bare agent id -> session row's agent -> session title -> null", () => {
    const agents = [
      { agentId: "researcher", name: "Researcher" },
      { agentId: "plain" },
      { agentId: "unnamed", name: "" },
    ];
    const sessions = [
      { sessionId: "s1", agentId: "researcher", title: "Row title" },
      { sessionId: "s2", agentId: "ghost" },
    ];
    expect(resolveAgentLabel({ sessionId: "x", agentId: "researcher" }, agents, sessions)).toBe(
      "Researcher",
    );
    expect(resolveAgentLabel({ sessionId: "x", agentId: "plain" }, agents, sessions)).toBe("plain");
    // An empty display name counts as missing, not as a real (blank) label.
    expect(resolveAgentLabel({ sessionId: "x", agentId: "unnamed" }, agents, sessions)).toBe(
      "unnamed",
    );
    // Agent unknown to the list: the id itself still beats nothing.
    expect(resolveAgentLabel({ sessionId: "x", agentId: "mystery" }, agents, sessions)).toBe(
      "mystery",
    );
    // No agent id on the node: the session row supplies it.
    expect(resolveAgentLabel({ sessionId: "s1", agentId: null }, agents, sessions)).toBe(
      "Researcher",
    );
    expect(resolveAgentLabel({ sessionId: "s2", agentId: null }, agents, sessions)).toBe("ghost");
    expect(resolveAgentLabel({ sessionId: "gone", agentId: null }, agents, sessions)).toBeNull();
  });

  it("shortSessionId keeps the distinctive tail", () => {
    expect(shortSessionId("session-2026-07-14-09-05-11-1a2b3c01")).toBe("1a2b3c01");
    expect(shortSessionId("short")).toBe("short");
  });
});

describe("layoutTopology", () => {
  const tree = () => {
    const m = createStreamModel();
    pushMessage(m, userText("go"));
    spawnChild(m, "t1", "child1");
    pushMessage(
      m,
      withOrigin(toolCall({ name: "run_subagent", arguments: "{}", toolCallId: "s1" }), "child1"),
    );
    pushMessage(m, withOrigin(approvalDecision("allow", "s1"), "child1"));
    pushMessage(m, withOrigin(withOrigin(assistantText("gc"), "gc1"), "child1"));
    spawnChild(m, "t2", "child2");
    return extractTopology(m, "root", true); // root -> child1 -> gc1, root -> child2
  };

  it("is deterministic (same tree, same layout)", () => {
    // Frozen clock: the fixture's node stamps (startedMs/elapsedMs) come from the wall clock and
    // message timestamps, so two separately BUILT trees only match with time stopped — the
    // layout itself is a pure function of the nodes.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-25T10:00:00.000Z"));
      expect(layoutTopology(tree())).toEqual(layoutTopology(tree()));
    } finally {
      vi.useRealTimers();
    }
  });

  it("columns follow depth, leaves take successive rows, and a parent centers on its children", () => {
    const layout = layoutTopology(tree());
    const at = (id: string) => layout.nodes.find((p) => p.node.sessionId === id)!;
    const colX = (depth: number) => PAD + depth * (NODE_W + GAP_X);
    expect(at("root").x).toBe(colX(0));
    expect(at("child1").x).toBe(colX(1));
    expect(at("child2").x).toBe(colX(1));
    expect(at("gc1").x).toBe(colX(2));
    // Leaves in DFS order: gc1 row 0, child2 row 1; child1 centers on its only child; root centers between its two children.
    expect(at("gc1").y).toBe(PAD);
    expect(at("child2").y).toBe(PAD + (NODE_H + GAP_Y));
    expect(at("child1").y).toBe(at("gc1").y);
    expect(at("root").y).toBe((at("child1").y + at("child2").y) / 2);
    // Canvas hugs the tree: 3 columns wide, 2 leaf rows tall.
    expect(layout.width).toBe(PAD * 2 + 3 * NODE_W + 2 * GAP_X);
    expect(layout.height).toBe(PAD * 2 + 2 * NODE_H + GAP_Y);
  });

  it("draws a straight edge between aligned nodes and an orthogonal elbow otherwise", () => {
    const layout = layoutTopology(tree());
    const edge = (to: string) => layout.edges.find((e) => e.toId === to)!;
    expect(layout.edges).toHaveLength(3);
    // child1 -> gc1 share a midline: single horizontal segment.
    expect(edge("gc1").path).toMatch(/^M \S+ \S+ H \S+$/);
    // root -> child2 offset rows: H mid, V to the child's midline, H into the box.
    expect(edge("child2").path).toMatch(/^M \S+ \S+ H \S+ V \S+ H \S+$/);
    expect(edge("child2").fromId).toBe("root");
  });

  it("lays out a lone root without edges", () => {
    const m = createStreamModel();
    pushMessage(m, userText("solo"));
    const layout = layoutTopology(extractTopology(m, "root", false));
    expect(layout.nodes).toHaveLength(1);
    expect(layout.edges).toHaveLength(0);
    expect(layout.height).toBe(PAD * 2 + NODE_H);
  });
});
