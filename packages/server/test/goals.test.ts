/**
 * Goal-mode server tests: GoalsRepo state rows, and SessionManager.startGoal driving core's
 * runGoal with a fake Session (no real LLM requests) — round events, terminal state
 * persistence, and status transitions.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import {
  assistantText,
  emptyTokenCounts,
  goalFilePath,
  tokenUsage,
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

  it("deletes by session and by project", () => {
    repo.create({ sessionId: "s1", projectId: "p1", agentId: "a1", objective: "o", budget: -1 });
    repo.create({ sessionId: "s2", projectId: "p1", agentId: "a1", objective: "o", budget: -1 });
    repo.deleteBySession("s1");
    expect(repo.latestForSession("s1")).toBeNull();
    expect(repo.latestForSession("s2")).not.toBeNull();
    repo.deleteByProject("p1");
    expect(repo.latestForSession("s2")).toBeNull();
  });
});

describe("SessionManager.startGoal", () => {
  let db: DatabaseSync;
  let root: string;
  let sessions: SessionsRepo;
  let goals: GoalsRepo;
  let channels: ChannelHub;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-goal-mgr-"));
    sessions = new SessionsRepo(db);
    sessions.insert(ROW);
    goals = new GoalsRepo(db);
    channels = new ChannelHub();
  });
  afterEach(async () => {
    channels.dispose();
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  /** Fake session: consumes goal rounds, marking the on-disk GOAL.yaml complete on round N. */
  function goalFakeSession(completeOnRound: number): RuntimeSession & { prompts: string[] } {
    const file = goalFilePath(root, ROW.projectId, ROW.agentId, ROW.sessionId);
    let round = 0;
    const prompts: string[] = [];
    return {
      sessionId: ROW.sessionId,
      prompts,
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok" as const,
      async *run(input: OmniMessage[]) {
        round++;
        prompts.push((input[0]!.payload as { text: string }).text);
        yield assistantText(`round ${round} work`);
        yield tokenUsage(usage(100 * round), usage(100 * round));
        if (round >= completeOnRound) {
          const raw = await fs.readFile(file, "utf8");
          await fs.writeFile(file, raw.replace(/^status: .*$/m, "status: complete"), "utf8");
        }
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
      root,
      goals,
    });
  }

  it("drives rounds to completion, publishing goal events and persisting the outcome", async () => {
    const session = goalFakeSession(2);
    const manager = makeManager(session);
    const events: ChannelEvent[] = [];
    channels.get(ROW.sessionId).subscribe((e) => events.push(e));

    await manager.startGoal(ROW.sessionId, { objective: "make it work", budget: -1 });
    await waitFor(() => manager.statusOf(ROW.sessionId) === "idle");

    // The model saw a <goal_task> block each round, with the objective embedded.
    expect(session.prompts).toHaveLength(2);
    expect(session.prompts[0]).toContain("<goal_task>");
    expect(session.prompts[0]).toContain("make it work");
    expect(session.prompts[1]).toContain("round: 2");

    const server = events
      .filter((e) => e.event === "server_event")
      .map((e) => JSON.parse(e.data) as { type: string; [k: string]: unknown });
    expect(server.filter((e) => e.type === "goal_round")).toHaveLength(2);
    const finished = server.find((e) => e.type === "goal_finished");
    // used = (100) + (200): the fake yields one uncached request per round.
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
          ((m.payload as { text?: string }).text ?? "").startsWith("<goal_task>"),
      );
    expect(published).toHaveLength(2);
  });

  it("409s while a goal is running (mutual exclusion) and without a configured root", async () => {
    const session = goalFakeSession(1);
    const manager = makeManager(session);
    await manager.startGoal(ROW.sessionId, { objective: "obj", budget: -1 });
    await expect(manager.startTask(ROW.sessionId, [assistantText("x")])).rejects.toMatchObject({
      status: 409,
    });
    await waitFor(() => manager.statusOf(ROW.sessionId) === "idle");

    const bare = new SessionManager({
      sessions,
      channels,
      sources: new SessionSources(),
      loader: { load: async () => session },
      recorder: { record: async () => {} },
      log: () => {},
    });
    await expect(
      bare.startGoal(ROW.sessionId, { objective: "o", budget: -1 }),
    ).rejects.toMatchObject({ status: 409, code: "goal_unavailable" });
  });

  it("sanity: emptyTokenCounts helper stays exported for fakes", () => {
    expect(emptyTokenCounts().total).toBe(0);
  });
});
