/**
 * Goal-mode server tests: GoalsRepo state rows, and SessionManager.startGoal driving core
 * goal mode through one `session.run(input, { goal })` call with a fake Session (no real LLM
 * requests) — round events, terminal state persistence, and status transitions.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import {
  assistantText,
  buildSkillsMessage,
  emptyTokenCounts,
  goalFinished,
  imageUrlMessage,
  tokenUsage,
  userText,
} from "@prismshadow/penguin-core";
import type { OmniMessage, TokenCounts } from "@prismshadow/penguin-core";
import { openDatabase } from "../src/db/database.js";
import { GoalsRepo } from "../src/db/repos/goals.js";
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
};

function usage(total: number): TokenCounts {
  return { cache_read: 0, cache_write: 0, output: 0, total };
}

/** A goal round's injected input, as core's loop would compose it (block + body). */
function roundInput(round: number, body: string): OmniMessage {
  return userText(`[goal]\nround: ${round}\nprotocol lines\n[/goal]\n\n${body}`);
}

describe("GoalsRepo", () => {
  let db: DatabaseSync;
  let repo: GoalsRepo;

  beforeEach(() => {
    db = openDatabase(":memory:");
    repo = new GoalsRepo(db);
  });
  afterEach(() => db.close());

  it("creates, progresses, finishes, and reads back the latest row per session", () => {
    const id = repo.create({
      sessionId: "s1",
      projectId: "p1",
      agentId: "a1",
      objective: "obj",
      budget: -1,
    });
    repo.progress(id, 2, 1234);
    let row = repo.latestForSession("s1");
    expect(row).toMatchObject({ id, status: "active", rounds: 2, used: 1234, budget: -1 });

    repo.finish(id, "complete", 3, 2000);
    row = repo.latestForSession("s1");
    expect(row).toMatchObject({ status: "complete", rounds: 3, used: 2000 });

    // A later run wins for display.
    const id2 = repo.create({
      sessionId: "s1",
      projectId: "p1",
      agentId: "a1",
      objective: "obj2",
      budget: 500,
    });
    expect(repo.latestForSession("s1")?.id).toBe(id2);
  });

  it("deletes by session, by agent, and by project", () => {
    repo.create({ sessionId: "s1", projectId: "p1", agentId: "a1", objective: "o", budget: -1 });
    repo.create({ sessionId: "s2", projectId: "p1", agentId: "a1", objective: "o", budget: -1 });
    repo.deleteBySession("s1");
    expect(repo.latestForSession("s1")).toBeNull();
    expect(repo.latestForSession("s2")).not.toBeNull();

    // deleteByAgent drops the agent's rows but spares another agent in the same project.
    repo.create({ sessionId: "s3", projectId: "p1", agentId: "a2", objective: "o", budget: -1 });
    repo.deleteByAgent("p1", "a1");
    expect(repo.latestForSession("s2")).toBeNull();
    expect(repo.latestForSession("s3")).not.toBeNull();

    repo.deleteByProject("p1");
    expect(repo.latestForSession("s3")).toBeNull();
  });

  it("reconciles orphaned active rows to aborted on startup, leaving terminal rows untouched", () => {
    const active = repo.create({
      sessionId: "s1",
      projectId: "p1",
      agentId: "a1",
      objective: "o",
      budget: -1,
    });
    const done = repo.create({
      sessionId: "s2",
      projectId: "p1",
      agentId: "a1",
      objective: "o",
      budget: -1,
    });
    repo.finish(done, "complete", 1, 10);

    // A hard crash leaves the running goal's row `active`; boot reconciliation flips only it.
    expect(repo.abortOrphanedActive()).toBe(1);
    expect(repo.latestForSession("s1")?.status).toBe("aborted");
    expect(repo.latestForSession("s2")?.status).toBe("complete");
    // Idempotent: a second boot finds nothing left to reconcile.
    expect(repo.abortOrphanedActive()).toBe(0);
    void active;
  });
});

describe("SessionManager.startGoal", () => {
  let db: DatabaseSync;
  let sessions: SessionsRepo;
  let goals: GoalsRepo;
  let channels: ChannelHub;

  beforeEach(() => {
    db = openDatabase(":memory:");
    sessions = new SessionsRepo(db);
    sessions.insert(ROW);
    goals = new GoalsRepo(db);
    channels = new ChannelHub();
  });
  afterEach(() => {
    channels.dispose();
    db.close();
  });

  type RunOpts = { thinkingLevel?: string; goal?: { budget?: number } };

  /**
   * Fake session: `run` asserts it was called in goal mode and emits the whole goal stream
   * the way core's loop would — per-round `[goal]` inputs and work, then the terminal
   * goal_finished event (the loop itself is core's and is tested in core).
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
          ...(opts.goal !== undefined ? { goal: opts.goal } : {}),
        });
        yield* stream(input);
      },
      async *compact() {},
    };
  }

  function makeManager(session: RuntimeSession, withRepo = true): SessionManager {
    return new SessionManager({
      sessions,
      channels,
      sources: new SessionSources(),
      loader: { load: async () => session },
      approvalModes: { get: () => "allow-all" },
      recorder: { record: async () => {} },
      log: () => {},
      ...(withRepo ? { goals } : {}),
    });
  }

  it("drives one goal-mode run, publishing goal events and persisting the outcome", async () => {
    const text = buildSkillsMessage(["web-design"], "make it work");
    const session = goalFakeSession((input) => [
      roundInput(1, (input[0]!.payload as { text: string }).text),
      assistantText("round 1 work"),
      tokenUsage(usage(100), usage(100)),
      roundInput(2, "make it work"),
      assistantText("round 2 work"),
      tokenUsage(usage(200), usage(200)),
      goalFinished("complete", 2, 300),
    ]);
    const manager = makeManager(session);
    const events: ChannelEvent[] = [];
    channels.get(ROW.sessionId).subscribe((e) => events.push(e));

    await manager.startGoal(ROW.sessionId, {
      input: [userText(text)],
      budget: -1,
      thinkingLevel: "high",
    });
    await waitFor(() => manager.statusOf(ROW.sessionId) === "idle");

    // One run call carries the whole goal: the input verbatim, the per-goal thinking
    // level, and the goal option (core loops the rounds internally).
    expect(session.runOpts).toEqual([{ thinkingLevel: "high", goal: { budget: -1 } }]);

    const server = events
      .filter((e) => e.event === "server_event")
      .map((e) => JSON.parse(e.data) as { type: string; [k: string]: unknown });
    // The recorded objective is the user's own text: the [use_skills] prefix is stripped.
    expect(server.find((e) => e.type === "goal_started")).toMatchObject({
      objective: "make it work",
      budget: -1,
    });
    const rounds = server.filter((e) => e.type === "goal_round");
    expect(rounds).toHaveLength(2);
    expect(rounds[1]).toMatchObject({ round: 2, used: 100 });
    const finished = server.find((e) => e.type === "goal_finished");
    expect(finished).toMatchObject({ outcome: "complete", rounds: 2, used: 300 });

    const row = goals.latestForSession(ROW.sessionId);
    expect(row).toMatchObject({
      status: "complete",
      rounds: 2,
      used: 300,
      objective: "make it work",
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
    // re-injects each round. The objective recorded here is the one shown to people — status
    // card, goal_started, title material — so it keeps the user's words only.
    const session = goalFakeSession(() => [goalFinished("complete", 1, 10)]);
    const manager = makeManager(session);
    const events: ChannelEvent[] = [];
    channels.get(ROW.sessionId).subscribe((e) => events.push(e));

    await manager.startGoal(ROW.sessionId, {
      input: [userText("Match this mockup"), imageUrlMessage("data:image/png;base64,aGk=")],
      budget: -1,
    });
    await waitFor(() => manager.statusOf(ROW.sessionId) === "idle");

    // The whole input still reaches core (the images included) — only the recorded copy differs.
    expect(session.runs[0]).toHaveLength(2);
    const started = events
      .filter((e) => e.event === "server_event")
      .map((e) => JSON.parse(e.data) as { type: string; objective?: string })
      .find((e) => e.type === "goal_started");
    expect(started?.objective).toBe("Match this mockup");
    expect(goals.latestForSession(ROW.sessionId)?.objective).toBe("Match this mockup");
  });

  it("409s while a goal is running (mutual exclusion); runs without a goals repo", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const session = goalFakeSession(() => [roundInput(1, "obj"), goalFinished("complete", 1, 0)]);
    const orig = session.run.bind(session);
    session.run = async function* (input, opts) {
      yield* orig(input, opts);
      await gate;
    };
    const manager = makeManager(session, false);
    await manager.startGoal(ROW.sessionId, { input: [userText("obj")], budget: -1 });
    await expect(manager.startTask(ROW.sessionId, [userText("x")])).rejects.toMatchObject({
      status: 409,
    });
    release();
    await waitFor(() => manager.statusOf(ROW.sessionId) === "idle");
    // No goals repo wired: the goal still ran and finished without touching one.
    expect(goals.latestForSession(ROW.sessionId)).toBeNull();
  });

  it("a throw after the terminal event does not overwrite the recorded outcome", async () => {
    // repo.finish is an unconditional UPDATE: without the `finished` guard, the defensive
    // catch would flip a completed row to aborted and publish a contradicting event.
    const session = goalFakeSession(() => []);
    session.run = async function* () {
      yield roundInput(1, "obj");
      yield goalFinished("complete", 1, 42);
      throw new Error("post-terminal hiccup");
    };
    const manager = makeManager(session);
    const events: ChannelEvent[] = [];
    channels.get(ROW.sessionId).subscribe((e) => events.push(e));

    await manager.startGoal(ROW.sessionId, { input: [userText("obj")], budget: -1 });
    await waitFor(() => manager.statusOf(ROW.sessionId) === "idle");

    expect(goals.latestForSession(ROW.sessionId)).toMatchObject({
      status: "complete",
      rounds: 1,
      used: 42,
    });
    const finished = events
      .filter((e) => e.event === "server_event")
      .map((e) => JSON.parse(e.data) as { type: string; outcome?: string })
      .filter((e) => e.type === "goal_finished");
    expect(finished).toEqual([expect.objectContaining({ outcome: "complete" })]);
  });

  it("closes the run state as aborted when the stream ends without a terminal event", async () => {
    // A cut-off run (infrastructure failure upstream) must not leave the row active.
    const session = goalFakeSession(() => [
      roundInput(1, "obj"),
      assistantText("partial work"),
      tokenUsage(usage(50), usage(50)),
    ]);
    const manager = makeManager(session);
    const events: ChannelEvent[] = [];
    channels.get(ROW.sessionId).subscribe((e) => events.push(e));

    await manager.startGoal(ROW.sessionId, { input: [userText("obj")], budget: 1000 });
    await waitFor(() => manager.statusOf(ROW.sessionId) === "idle");

    expect(goals.latestForSession(ROW.sessionId)).toMatchObject({
      status: "aborted",
      rounds: 1,
      used: 50,
    });
    const server = events
      .filter((e) => e.event === "server_event")
      .map((e) => JSON.parse(e.data) as { type: string; [k: string]: unknown });
    expect(server.find((e) => e.type === "goal_finished")).toMatchObject({
      outcome: "aborted",
      rounds: 1,
      used: 50,
    });
  });

  it("sanity: emptyTokenCounts helper stays exported for fakes", () => {
    expect(emptyTokenCounts().total).toBe(0);
  });
});
