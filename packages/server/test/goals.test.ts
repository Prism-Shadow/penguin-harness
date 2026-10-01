/**
 * Goal mode on the server: SessionManager.startGoal and the goal events it derives.
 *
 * On a fake Session (the goal plugin's start answered in its place, no scripts, no LLM):
 * - A goal run maps its round inputs and the goal hook's answers to goal_round and
 *   goal_finished events.
 * - The recorded objective leaves the attached images out, so the display copy stays path-free.
 * - A background completion notice inside a round is not a round boundary.
 * - A second goal while one runs is a 409; a Session with no goal start hook is a 409
 *   goal_plugin_not_installed.
 * - A throw after the terminal event publishes no contradicting outcome; a stream that ends
 *   without the terminal event closes the goal as aborted.
 *
 * On a real core Session running the installed scripts against a loopback model, with a
 * hand-written every-prompt package beside the goal package (both for the package the library
 * ships and for one installed before user_prompt ran on every Prompt):
 * - A goal start runs the goal's start by name, and the other package's context rides round 1
 *   without counting as a round.
 * - An ordinary Task starts no goal; only the other package's hook runs for it.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { wire } from "@prismshadow/penguin-core/kernel";
import type { DatabaseSync } from "node:sqlite";
import {
  assistantText,
  buildSkillsMessage,
  createAgent,
  hookEvent,
  hooksDir,
  imageUrlMessage,
  installPlugin,
  libraryPlugin,
  saveProjectConfig,
  sessionScratchpadDir,
  tokenUsage,
  userText,
} from "@prismshadow/penguin-core";
import type { OmniMessage, TokenCounts } from "@prismshadow/penguin-core";
import { openDatabase } from "../src/db/database.js";
import { SessionsRepo } from "../src/db/repos/sessions.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { ChannelHub } from "../src/runtime/channel.js";
import type { ChannelEvent } from "../src/runtime/channel.js";
import { SessionManager, createCoreSessionLoader } from "../src/runtime/session-manager.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { SessionSources } from "../src/runtime/session-sources.js";
import { fakeSession } from "./fixtures/session.js";
import { makeTempRoot, waitFor } from "./helpers.js";
import {
  MOCK_MODEL_ID,
  clockContext,
  requestText,
  startMockLLM,
  userTexts,
  writeClockPackage,
} from "./live-session.js";
import type { MockLLM } from "./live-session.js";

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

function serverEvents(events: ChannelEvent[]) {
  return events
    .filter((e) => e.event === "server_event")
    .map((e) => JSON.parse(e.data) as { type: string; [k: string]: unknown });
}

describe("SessionManager.startGoal", () => {
  let db: DatabaseSync;
  let sessions: SessionsRepo;
  let channels: ChannelHub;

  beforeEach(() => {
    db = openDatabase(":memory:");
    sessions = wire(SessionsRepo, { db: db });
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
    const session = fakeSession(ROW.sessionId, {
      async runUserPromptHook(name, prompt, extras) {
        starts.push({ name, prompt, extras });
        return { context: "goal round 1 protocol lines" };
      },
      async *run(input: OmniMessage[]) {
        runs.push(input);
        runOpts.push({});
        yield* stream(input);
      },
    });
    return Object.assign(session, { runOpts, runs, starts });
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
});

/**
 * The goal package as the library installed it before user_prompt commands ran on every
 * Prompt: an older version, and no `trigger` on start.mjs.
 */
const LEGACY_GOAL_MANIFEST = {
  name: "goal",
  description: "Goal mode",
  version: "2026.09.01.1",
  stop: [{ command: "stop.mjs", timeout: 60 }],
  pre_tool_use: [],
  user_prompt: [{ command: "start.mjs", timeout: 60 }],
};

for (const { installed, legacy } of [
  { installed: "the goal package the library ships", legacy: false },
  { installed: "a goal package from before user_prompt ran on every prompt", legacy: true },
]) {
  describe(
    `a real Session with ${installed} and an every-prompt package`,
    { timeout: 30_000 },
    () => {
      const PROJECT = "p1";
      const AGENT = "goal_agent";
      let root: string;
      let mock: MockLLM;
      let db: DatabaseSync;
      let channels: ChannelHub;
      let manager: SessionManager;
      let sessionId: string;
      let events: ChannelEvent[];

      beforeEach(async () => {
        root = await makeTempRoot();
        mock = await startMockLLM();
        // Saved first: an Agent reads its Project's models when it is created.
        await saveProjectConfig(root, PROJECT, {
          default_model: { provider: "custom", model_id: MOCK_MODEL_ID },
          models: [
            {
              provider: "custom",
              model_id: MOCK_MODEL_ID,
              context_window: 200_000,
              api_key: "sk-mock",
              base_url: mock.url,
            },
          ],
        });
        const agent = await createAgent({ root, projectId: PROJECT, agentId: AGENT });
        await installPlugin(root, PROJECT, AGENT, libraryPlugin("goal")!);
        const hooks = hooksDir(root, PROJECT, AGENT);
        if (legacy) {
          await fs.writeFile(
            path.join(hooks, "goal", "hooks.json"),
            `${JSON.stringify(LEGACY_GOAL_MANIFEST, null, 2)}\n`,
          );
        }
        await writeClockPackage(hooks);
        const workspace = path.join(root, "workspace");
        await fs.mkdir(workspace);
        // Created and handed to the manager the way POST /sessions does it; its first context
        // reads the packages as it opens.
        const session = await agent.createSession({ workspaceDir: workspace });
        sessionId = session.sessionId;
        const now = new Date().toISOString();
        const row: SessionRow = {
          sessionId,
          projectId: PROJECT,
          agentId: AGENT,
          modelId: MOCK_MODEL_ID,
          provider: "custom",
          workspace,
          approvalMode: "allow-all",
          title: null,
          createdAt: now,
          lastActiveAt: now,
        };
        db = openDatabase(":memory:");
        const sessions = wire(SessionsRepo, { db: db });
        sessions.insert(row);
        channels = new ChannelHub();
        manager = new SessionManager({
          sessions,
          channels,
          sources: new SessionSources(),
          loader: createCoreSessionLoader(root),
          recorder: { record: async () => {} },
          log: () => {},
        });
        manager.adopt(row, session);
        events = [];
        channels.get(sessionId).subscribe((e) => events.push(e));
      });
      afterEach(async () => {
        await manager.shutdown();
        channels.dispose();
        db.close();
        await mock.close();
        await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      });

      const idle = () => waitFor(() => manager.statusOf(sessionId) === "idle", 20_000);
      /** The user texts published on the session's message stream, in order. */
      const published = () =>
        userTexts(
          events.filter((e) => e.event === undefined).map((e) => JSON.parse(e.data) as OmniMessage),
        );
      const goalFile = () =>
        path.join(sessionScratchpadDir(root, PROJECT, AGENT, sessionId), "GOAL.json");

      it("a goal start runs the goal's start by name; the other package's context rides round 1 without counting as a round", async () => {
        await manager.startGoal(sessionId, {
          messages: [userText("raise coverage")],
          objective: "raise coverage",
          budget: 1,
        });
        await idle();

        // start.mjs wrote the goal file; round 1 spent the budget, so round 2 was the wrap-up.
        expect(JSON.parse(await fs.readFile(goalFile(), "utf8"))).toMatchObject({
          objective: "raise coverage",
          budget: 1,
          round: 2,
          status: "budget_limited",
        });
        const texts = published();
        expect(texts.map((m) => m.sender)).toEqual(["user", "harness", "harness", "harness"]);
        expect(texts[0]!.text).toBe("raise coverage");
        expect(texts[1]!.text).toContain("sent automatically by goal mode");
        expect(texts[2]!.text).toBe(clockContext("raise coverage"));
        expect(texts[3]!.text).toContain("reached its token budget");

        const server = serverEvents(events);
        expect(server.filter((e) => e.type === "goal_round").map((e) => e.round)).toEqual([1, 2]);
        expect(server.find((e) => e.type === "goal_finished")).toMatchObject({
          outcome: "budget_limited",
          rounds: 2,
        });

        // Round 1's request carries the three in that order. The wrap-up round starts from the
        // goal hook's input, which no user submitted: the package is not asked again.
        expect(mock.requests).toHaveLength(2);
        const first = requestText(mock.requests[0]!);
        const at = [
          "raise coverage",
          "sent automatically by goal mode",
          clockContext("raise coverage"),
        ].map((text) => first.indexOf(text));
        expect(at.every((i) => i >= 0)).toBe(true);
        expect(at).toEqual([...at].sort((a, b) => a - b));
      });

      it("an ordinary task starts no goal: the goal's start is not among the Prompt's hooks, the other package's is", async () => {
        await manager.startTask(sessionId, [userText("fix the typo")]);
        await idle();

        expect(published()).toEqual([
          { sender: "user", text: "fix the typo" },
          { sender: "harness", text: clockContext("fix the typo") },
        ]);
        // No goal file and one request: nothing started a goal, so the goal's stop hook found
        // none to drive into another round.
        await expect(fs.access(goalFile())).rejects.toThrow();
        expect(mock.requests).toHaveLength(1);
        expect(serverEvents(events).filter((e) => e.type.startsWith("goal_"))).toEqual([]);
      });
    },
  );
}
