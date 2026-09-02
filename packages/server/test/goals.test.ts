/**
 * Goal-mode server tests: SessionManager.startGoal running the goal plugin's user_prompt hook
 * on a fake Session (no real LLM requests, no scripts) and driving one `session.run` — the
 * round and terminal server events derived from the stream's harness-injected inputs and
 * goal hook events.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import {
  assistantText,
  buildSkillsMessage,
  emptyTokenCounts,
  hookEvent,
  imageUrlMessage,
  tokenUsage,
  userText,
} from "@prismshadow/penguin-core";
import type { OmniMessage, TokenCounts } from "@prismshadow/penguin-core";
import { openDatabase } from "../src/db/database.js";
import { SessionsRepo } from "../src/db/repos/sessions.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { ChannelHub } from "../src/runtime/channel.js";
import type { ChannelEvent } from "../src/runtime/channel.js";
import { SessionManager } from "../src/runtime/session-manager.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { SessionSources } from "../src/runtime/session-sources.js";
import { waitFor } from "./helpers.js";

const ROW: SessionRow = {
  sessionId: "session-1",
  projectId: "p1",
  agentId: "a1",
  modelId: "m1",
  provider: "custom",
  workspace: "/tmp/w",
  approvalMode: "allow-all",
  title: null,
  createdAt: "2026-07-06T00:00:00.000Z",
  lastActiveAt: "2026-07-06T00:00:00.000Z",
};

function usage(total: number): TokenCounts {
  return { cache_read: 0, cache_write: 0, output: 0, total };
}

/** A goal round's injected input, as the host records it: plain protocol text, stamped `sender: "harness"`. */
function roundInput(round: number): OmniMessage {
  return userText(`goal round ${round} protocol lines`, "harness");
}

/** The goal hook's answer, as core records it: the file's state after the decision. */
function goalHook(
  decision: "continue" | "stop",
  status: string,
  round: number,
  tokensUsed: number,
  budget = -1,
): OmniMessage {
  return hookEvent({
    hook: "stop",
    name: "goal",
    decision,
    output: { status, round, tokens_used: tokensUsed, budget },
  });
}

describe("SessionManager.startGoal", () => {
  let db: DatabaseSync;
  let sessions: SessionsRepo;
  let channels: ChannelHub;

  beforeEach(() => {
    db = openDatabase(":memory:");
    sessions = new SessionsRepo(db);
    sessions.insert(ROW);
    channels = new ChannelHub();
  });
  afterEach(() => {
    channels.dispose();
    db.close();
  });

  type RunOpts = Record<string, never>;

  /**
   * Fake session: `runUserPromptHook` answers the way the goal plugin's start script would
   * (round 1's protocol text, recorded with what it was asked), and `run` emits the goal
   * stream the way core would — the run's own initial input is NEVER yielded (startGoal
   * publishes it; the tap counts round 1 off the seeded input), later rounds'
   * harness-stamped injections and the goal hook's answers are (the hook loop is core's and
   * the decisions are the goal plugin's; both are tested where they live).
   */
  function goalFakeSession(stream: (input: OmniMessage[]) => OmniMessage[]): RuntimeSession & {
    runOpts: RunOpts[];
    runs: OmniMessage[][];
    starts: Array<{ name: string; prompt: string; extras: unknown }>;
  } {
    const runOpts: RunOpts[] = [];
    const runs: OmniMessage[][] = [];
    const starts: Array<{ name: string; prompt: string; extras: unknown }> = [];
    return {
      sessionId: ROW.sessionId,
      runOpts,
      runs,
      starts,
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok" as const,
      steer: () => false,
      skipReconnectWait: () => false,
      async runUserPromptHook(name, prompt, extras) {
        starts.push({ name, prompt, extras });
        return { context: "goal round 1 protocol lines" };
      },
      async *run(input: OmniMessage[], opts) {
        runs.push(input);
        void opts;
        runOpts.push({});
        yield* stream(input);
      },
      async *compact() {},
    };
  }

  function makeManager(session: RuntimeSession): SessionManager {
    return new SessionManager({
      sessions,
      channels,
      sources: new SessionSources(),
      loader: { load: async () => session },
      recorder: { record: async () => {} },
      log: () => {},
    });
  }

  function serverEvents(events: ChannelEvent[]) {
    return events
      .filter((e) => e.event === "server_event")
      .map((e) => JSON.parse(e.data) as { type: string; [k: string]: unknown });
  }

  it("drives one goal-mode run, mapping the round inputs and the hook's answers to goal events", async () => {
    const text = buildSkillsMessage(["web-design"], "make it work");
    const session = goalFakeSession(() => [
      assistantText("round 1 work"),
      tokenUsage(usage(100), usage(100)),
      goalHook("continue", "active", 2, 100),
      roundInput(2),
      assistantText("round 2 work"),
      tokenUsage(usage(200), usage(200)),
      goalHook("stop", "complete", 2, 300),
    ]);
    const manager = makeManager(session);
    const events: ChannelEvent[] = [];
    channels.get(ROW.sessionId).subscribe((e) => events.push(e));

    await manager.startGoal(ROW.sessionId, {
      messages: [userText(text)],
      objective: "make it work",
      budget: -1,
    });
    await waitFor(() => manager.statusOf(ROW.sessionId) === "idle");

    // The goal plugin's user_prompt hook is run with the objective and the budget, and one
    // run call carries the whole goal — the user's message then the hook's context stamped
    // as harness-injected, no extra run options: the plugin's stop hook drives the rounds
    // inside it, and the thinking level is the Session's own soft state rather than a
    // per-run parameter.
    expect(session.starts).toEqual([
      { name: "goal", prompt: "make it work", extras: { budget: -1 } },
    ]);
    expect(session.runs.map((run) => run.map((m) => m.payload))).toEqual([
      [userText(text).payload, roundInput(1).payload],
    ]);
    expect(session.runOpts).toEqual([{}]);

    const server = serverEvents(events);
    // The published objective is the one the route passed (the user's own text, markers stripped).
    expect(server.find((e) => e.type === "goal_started")).toMatchObject({
      objective: "make it work",
      budget: -1,
    });
    const rounds = server.filter((e) => e.type === "goal_round");
    expect(rounds).toHaveLength(2);
    // Round 2's `used` is what the hook recorded when it decided to continue.
    expect(rounds[0]).toMatchObject({ round: 1, used: 0 });
    expect(rounds[1]).toMatchObject({ round: 2, used: 100 });
    expect(server.find((e) => e.type === "goal_finished")).toMatchObject({
      outcome: "complete",
      rounds: 2,
      used: 300,
    });

    // The inputs were published on the message stream (no `event:` name) for live viewers —
    // round 1 by startGoal itself (core never yields a run's initial input, and a page
    // already subscribed would otherwise miss it until a reload), round 2 off the stream:
    // the user's own message verbatim — the [use_skills] block included — and both rounds'
    // harness-stamped protocol messages.
    const published = events
      .filter((e) => e.event === undefined)
      .map((e) => JSON.parse(e.data) as OmniMessage)
      .filter((m) => m.type === "model_msg" && (m.payload as { role?: string }).role === "user");
    expect(published).toHaveLength(3);
    expect((published[0]!.payload as { text: string }).text).toContain("[use_skills]");
    expect(published.map((m) => (m.payload as { sender?: string }).sender ?? "user")).toEqual([
      "user",
      "harness",
      "harness",
    ]);
  });

  it("records the objective without the attached images: the display copy stays path-free", async () => {
    // Core folds the attached images into `[attached image: …]` lines inside the objective it
    // re-injects each round. The objective published here is the one shown to people — status
    // card, goal_started, title material — so it keeps the user's words only.
    const session = goalFakeSession(() => [goalHook("stop", "complete", 1, 10)]);
    const manager = makeManager(session);
    const events: ChannelEvent[] = [];
    channels.get(ROW.sessionId).subscribe((e) => events.push(e));

    await manager.startGoal(ROW.sessionId, {
      messages: [userText("Match this mockup"), imageUrlMessage("data:image/png;base64,aGk=")],
      objective: "Match this mockup",
      budget: -1,
    });
    await waitFor(() => manager.statusOf(ROW.sessionId) === "idle");

    // The whole input reaches core (the images included, then the protocol message) — only
    // the published objective differs.
    expect(session.runs[0]).toHaveLength(3);
    expect(serverEvents(events).find((e) => e.type === "goal_started")?.objective).toBe(
      "Match this mockup",
    );
  });

  it("a background completion notice inside a round is not a round boundary", async () => {
    const notice = userText(
      "[background_task_done]\nkind: command\nid: proc-1\nstatus: completed\n[/background_task_done]\n\nBackground command finished",
      "harness",
    );
    const session = goalFakeSession(() => [
      assistantText("working"),
      notice,
      assistantText("absorbed"),
      goalHook("stop", "complete", 1, 10),
    ]);
    const manager = makeManager(session);
    const events: ChannelEvent[] = [];
    channels.get(ROW.sessionId).subscribe((e) => events.push(e));
    await manager.startGoal(ROW.sessionId, {
      messages: [userText("obj")],
      objective: "obj",
      budget: -1,
    });
    await waitFor(() => manager.statusOf(ROW.sessionId) === "idle");
    const rounds = serverEvents(events).filter((e) => e.type === "goal_round");
    expect(rounds).toEqual([expect.objectContaining({ round: 1 })]);
  });

  it("409s while a goal is running (mutual exclusion)", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const session = goalFakeSession(() => [roundInput(1), goalHook("stop", "complete", 1, 0)]);
    const orig = session.run.bind(session);
    session.run = async function* (input, opts) {
      yield* orig(input, opts);
      await gate;
    };
    const manager = makeManager(session);
    await manager.startGoal(ROW.sessionId, {
      messages: [userText("obj")],
      objective: "obj",
      budget: -1,
    });
    await expect(manager.startTask(ROW.sessionId, [userText("x")])).rejects.toMatchObject({
      status: 409,
    });
    // A second goal is refused BEFORE its start hook runs: the hook rewrites the goal file
    // the running goal's stop hook reads, so the idle check has to come first.
    await expect(
      manager.startGoal(ROW.sessionId, { messages: [userText("y")], objective: "y", budget: -1 }),
    ).rejects.toMatchObject({ status: 409 });
    expect(session.starts).toHaveLength(1);
    release();
    await waitFor(() => manager.statusOf(ROW.sessionId) === "idle");
  });

  it("409s goal_plugin_not_installed when the Session has no goal user_prompt hook", async () => {
    const session = goalFakeSession(() => []);
    session.runUserPromptHook = async () => null;
    const manager = makeManager(session);
    await expect(
      manager.startGoal(ROW.sessionId, {
        messages: [userText("obj")],
        objective: "obj",
        budget: -1,
      }),
    ).rejects.toMatchObject({ status: 409, code: "goal_plugin_not_installed" });
    expect(manager.statusOf(ROW.sessionId)).toBe("idle");
  });

  it("a throw after the terminal event does not publish a contradicting outcome", async () => {
    const session = goalFakeSession(() => []);
    session.run = async function* () {
      yield goalHook("stop", "complete", 1, 42);
      throw new Error("post-terminal hiccup");
    };
    const manager = makeManager(session);
    const events: ChannelEvent[] = [];
    channels.get(ROW.sessionId).subscribe((e) => events.push(e));

    await manager.startGoal(ROW.sessionId, {
      messages: [userText("obj")],
      objective: "obj",
      budget: -1,
    });
    await waitFor(() => manager.statusOf(ROW.sessionId) === "idle");

    const finished = serverEvents(events).filter((e) => e.type === "goal_finished");
    expect(finished).toEqual([expect.objectContaining({ outcome: "complete", used: 42 })]);
  });

  it("closes the goal as aborted when the stream ends without the hook's terminal event", async () => {
    // A cut-off run (infrastructure failure upstream) must not leave the banner active.
    const session = goalFakeSession(() => [
      assistantText("partial work"),
      tokenUsage(usage(50), usage(50)),
    ]);
    const manager = makeManager(session);
    const events: ChannelEvent[] = [];
    channels.get(ROW.sessionId).subscribe((e) => events.push(e));

    await manager.startGoal(ROW.sessionId, {
      messages: [userText("obj")],
      objective: "obj",
      budget: 1000,
    });
    await waitFor(() => manager.statusOf(ROW.sessionId) === "idle");

    expect(serverEvents(events).find((e) => e.type === "goal_finished")).toMatchObject({
      outcome: "aborted",
      rounds: 1,
      used: 0,
    });
  });

  it("sanity: emptyTokenCounts helper stays exported for fakes", () => {
    expect(emptyTokenCounts().total).toBe(0);
  });
});
