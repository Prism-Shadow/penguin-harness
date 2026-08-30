/**
 * Goal-mode server tests: SessionManager.startGoal driving core goal mode through one
 * `session.run(input, { goal })` call with a fake Session (no real LLM requests) — the round
 * and terminal server events derived from the stream's `[goal]` inputs and goal hook events.
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

/** A goal round's injected input, as core composes it (block + body). */
function roundInput(round: number, body: string): OmniMessage {
  return userText(`[goal]\nround: ${round}\nprotocol lines\n[/goal]\n\n${body}`);
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

  type RunOpts = { thinkingLevel?: string };

  /**
   * Fake session: `run` emits the whole goal stream the way core would — per-round `[goal]`
   * inputs and work, the goal hook's answers after each round (the hook loop is core's and
   * the decisions are the goal plugin's; both are tested where they live).
   */
  function goalFakeSession(
    stream: (input: OmniMessage[]) => OmniMessage[],
  ): RuntimeSession & { runOpts: RunOpts[]; runs: OmniMessage[][] } {
    const runOpts: RunOpts[] = [];
    const runs: OmniMessage[][] = [];
    return {
      sessionId: ROW.sessionId,
      runOpts,
      runs,
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok" as const,
      steer: () => false,
      skipReconnectWait: () => false,
      async *run(input: OmniMessage[], opts) {
        runs.push(input);
        runOpts.push({
          ...(opts.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : {}),
        });
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
    const session = goalFakeSession((input) => [
      roundInput(1, (input[0]!.payload as { text: string }).text),
      assistantText("round 1 work"),
      tokenUsage(usage(100), usage(100)),
      goalHook("continue", "active", 2, 100),
      roundInput(2, "make it work"),
      assistantText("round 2 work"),
      tokenUsage(usage(200), usage(200)),
      goalHook("stop", "complete", 2, 300),
    ]);
    const manager = makeManager(session);
    const events: ChannelEvent[] = [];
    channels.get(ROW.sessionId).subscribe((e) => events.push(e));

    await manager.startGoal(ROW.sessionId, {
      input: [userText(text)],
      objective: "make it work",
      budget: -1,
      thinkingLevel: "high",
    });
    await waitFor(() => manager.statusOf(ROW.sessionId) === "idle");

    // One run call carries the whole goal: the input verbatim and the per-goal thinking
    // level (the plugin's stop hook drives the rounds inside it).
    expect(session.runOpts).toEqual([{ thinkingLevel: "high" }]);

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

    // The round inputs were published on the message stream (no `event:` name) for live viewers.
    const published = events
      .filter((e) => e.event === undefined)
      .map((e) => JSON.parse(e.data) as OmniMessage)
      .filter(
        (m) =>
          m.type === "model_msg" &&
          (m.payload as { role?: string }).role === "user" &&
          ((m.payload as { text?: string }).text ?? "").startsWith("[goal]"),
      );
    expect(published).toHaveLength(2);
    // Round 1 carries the caller's input verbatim — the [use_skills] block included.
    expect((published[0]!.payload as { text: string }).text).toContain("[use_skills]");
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
      input: [userText("Match this mockup"), imageUrlMessage("data:image/png;base64,aGk=")],
      objective: "Match this mockup",
      budget: -1,
    });
    await waitFor(() => manager.statusOf(ROW.sessionId) === "idle");

    // The whole input still reaches core (the images included) — only the published copy differs.
    expect(session.runs[0]).toHaveLength(2);
    expect(serverEvents(events).find((e) => e.type === "goal_started")?.objective).toBe(
      "Match this mockup",
    );
  });

  it("409s while a goal is running (mutual exclusion)", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const session = goalFakeSession(() => [
      roundInput(1, "obj"),
      goalHook("stop", "complete", 1, 0),
    ]);
    const orig = session.run.bind(session);
    session.run = async function* (input, opts) {
      yield* orig(input, opts);
      await gate;
    };
    const manager = makeManager(session);
    await manager.startGoal(ROW.sessionId, {
      input: [userText("obj")],
      objective: "obj",
      budget: -1,
    });
    await expect(manager.startTask(ROW.sessionId, [userText("x")])).rejects.toMatchObject({
      status: 409,
    });
    release();
    await waitFor(() => manager.statusOf(ROW.sessionId) === "idle");
  });

  it("a throw after the terminal event does not publish a contradicting outcome", async () => {
    const session = goalFakeSession(() => []);
    session.run = async function* () {
      yield roundInput(1, "obj");
      yield goalHook("stop", "complete", 1, 42);
      throw new Error("post-terminal hiccup");
    };
    const manager = makeManager(session);
    const events: ChannelEvent[] = [];
    channels.get(ROW.sessionId).subscribe((e) => events.push(e));

    await manager.startGoal(ROW.sessionId, {
      input: [userText("obj")],
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
      roundInput(1, "obj"),
      assistantText("partial work"),
      tokenUsage(usage(50), usage(50)),
    ]);
    const manager = makeManager(session);
    const events: ChannelEvent[] = [];
    channels.get(ROW.sessionId).subscribe((e) => events.push(e));

    await manager.startGoal(ROW.sessionId, {
      input: [userText("obj")],
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
