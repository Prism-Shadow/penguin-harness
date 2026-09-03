/**
 * Unit tests for the Session runtime (a fake Session / Loader is injected; no
 * real LLM requests are made): driving and state transitions, 409 mutual
 * exclusion, the four approval modes and taking effect immediately on change,
 * abort collapsing to deny, self-healing id swaps, vault invalidation re-resuming
 * stale runtimes, and LLM / tool errors in the message stream being persisted
 * (core doesn't throw, so try/catch can't catch them).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  Environment,
  Session,
  abortEvent,
  approvalDecision,
  assistantText,
  compactionBegin,
  compactionEnd,
  emptyTokenCounts,
  requestBegin,
  requestEnd,
  sessionMeta,
  thinkingMessage,
  tokenUsage,
  toolCall,
  toolCallOutput,
  userSteeringText,
  userText,
  withOrigin,
} from "@prismshadow/penguin-core";
import type {
  ApproveFn,
  GenerativeModelParameters,
  LLMInterface,
  LLMOutcome,
  OmniMessage,
  TextPayload,
} from "@prismshadow/penguin-core";
import { openDatabase } from "../src/db/database.js";
import { HttpError } from "../src/http/errors.js";
import { SessionsRepo } from "../src/db/repos/sessions.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { ChannelHub } from "../src/runtime/channel.js";
import type { ChannelEvent } from "../src/runtime/channel.js";
import type { ErrorRecordArgs, ErrorSink } from "../src/runtime/error-recorder.js";
import { SessionManager } from "../src/runtime/session-manager.js";
import type { RuntimeSession, SessionLoader } from "../src/runtime/session-manager.js";
import { SessionSources } from "../src/runtime/session-sources.js";
import type { TitleRequest } from "../src/runtime/title-generator.js";
import type { UsageContext } from "../src/runtime/usage-recorder.js";
import { waitFor } from "./helpers.js";
import { wire } from "@prismshadow/penguin-core/kernel";

const ROW: SessionRow = {
  sessionId: "session-1",
  projectId: "p1",
  agentId: "a1",
  modelId: "m1",
  provider: "custom",
  workspace: "/tmp/w",
  approvalMode: "always-ask",
  title: null,
  createdAt: "2026-07-06T00:00:00.000Z",
  lastActiveAt: "2026-07-06T00:00:00.000Z",
};

/** A simple, scriptable fake Session: run yields one tool_call and requests approval for it. */
function approvalFakeSession(sessionId: string, toolName = "write_file"): RuntimeSession {
  return {
    sessionId,
    toolPermission: (name) => (name === "read_tool" ? "r" : "rw"),
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    async *run(_input: OmniMessage[], opts: { approve: ApproveFn; signal: AbortSignal }) {
      const tc = toolCall({ name: toolName, arguments: "{}", toolCallId: "tc-1" });
      yield tc;
      const decision = await opts.approve(tc);
      yield approvalDecision(decision, "tc-1");
      if (opts.signal.aborted) {
        yield abortEvent();
        return;
      }
      yield assistantText(`decision=${decision}`);
    },
    async *compact() {
      yield compactionBegin({ reason: "manual", mode: "summarize", context: 1, turns: 1 });
      yield compactionEnd({ reason: "manual", mode: "summarize", status: "completed" });
    },
  };
}

/**
 * A repo whose last-active writes always throw — the realistic failure being a
 * DatabaseSync handle closed by shutdown while a run outlived its drain window. Everything
 * else behaves normally, so a test can assert that the run's wrap-up survives it.
 */
function brokenTouchRepo(repo: SessionsRepo): SessionsRepo {
  return new Proxy(repo, {
    get(target, prop, receiver): unknown {
      if (prop === "markDriven" || prop === "touchLastActive") {
        return () => {
          throw new Error("database is not open");
        };
      }
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });
}

describe("session-manager", () => {
  let db: DatabaseSync;
  let sessions: SessionsRepo;
  let channels: ChannelHub;
  let sources: SessionSources;
  let recorded: OmniMessage[];
  let recordedCtx: UsageContext[];

  const makeManager = (
    loader: SessionLoader,
    errors?: ErrorSink,
    /** Stubbed clock for persisted timestamps (see the last_active_at test). */
    now?: () => Date,
  ): SessionManager =>
    new SessionManager({
      sessions,
      channels,
      sources,
      loader,
      recorder: {
        record: async (ctx, msg) => {
          recordedCtx.push(ctx);
          recorded.push(msg);
        },
      },
      ...(errors ? { errors } : {}),
      ...(now ? { now } : {}),
      log: () => {},
    });

  const loaderOf = (session: RuntimeSession): SessionLoader => ({ load: async () => session });

  const capture = (sessionId: string): ChannelEvent[] => {
    const events: ChannelEvent[] = [];
    channels.get(sessionId).subscribe((e) => events.push(e));
    return events;
  };

  const serverEvents = (events: ChannelEvent[]): { type: string; [k: string]: unknown }[] =>
    events
      .filter((e) => e.event === "server_event")
      .map((e) => JSON.parse(e.data) as { type: string });

  beforeEach(() => {
    db = openDatabase(":memory:");
    sessions = wire(SessionsRepo, { db: db });
    sessions.insert(ROW);
    channels = new ChannelHub();
    sources = new SessionSources();
    recorded = [];
    recordedCtx = [];
  });
  afterEach(() => {
    channels.dispose();
    db.close();
  });

  it("unknown Session → 404", async () => {
    const manager = makeManager(loaderOf(approvalFakeSession("session-1")));
    const err = await manager.startTask("session-ghost", [userText("x")]).catch((e: unknown) => e);
    expect((err as { status: number }).status).toBe(404);
  });

  it("startTask: publishes the input first; when driving ends it returns to idle and pushes task_state", async () => {
    sessions.updateApprovalMode("session-1", "allow-all");
    const manager = makeManager(loaderOf(approvalFakeSession("session-1")));
    const events = capture("session-1");
    const { sessionId } = await manager.startTask("session-1", [userText("hello")]);
    expect(sessionId).toBe("session-1");
    await waitFor(() => manager.statusOf("session-1") === "idle" && recorded.length >= 3);

    // The first entry is the input message (visible to other subscribers), followed by task_state: running.
    const first = JSON.parse(events[0]!.data) as { payload: { text: string } };
    expect(first.payload.text).toBe("hello");
    const states = serverEvents(events).filter((e) => e.type === "task_state");
    expect(states.map((s) => s.state)).toEqual(["running", "idle"]);
    // Driving a run flips the row's has_trace cache (listing then never walks for it).
    expect(sessions.findById("session-1")!.hasTrace).toBe(true);
    // Outputs and events are forwarded one by one and handed to the recorder.
    expect(recordedCtx[0]).toEqual({
      projectId: "p1",
      agentId: "a1",
      sessionId: "session-1",
      modelId: "m1",
      provider: "custom",
    });
  });

  it("drive stamps last_active_at twice per run — once at the start, once at the end — and leaves other rows alone", async () => {
    sessions.insert({
      ...ROW,
      sessionId: "session-other",
      createdAt: "2026-07-07T00:00:00.000Z",
      lastActiveAt: "2026-07-07T00:00:00.000Z",
    });
    // A stubbed clock, one second per read, so each stamp has an exact expected value:
    // sampling only after the run (when both stamps have landed) cannot tell the two
    // apart, and a run-end stamp that stops happening would still look "advanced".
    let tick = 0;
    const at = (n: number): string => `2026-07-10T00:00:0${n}.000Z`;
    const manager = makeManager(loaderOf(approvalFakeSession("session-1")), undefined, () => {
      const d = new Date(at(tick));
      tick += 1;
      return d;
    });
    const lastActive = (id: string): string => sessions.findById(id)!.lastActiveAt;
    // Insert default: last_active_at = created_at until the first driven run.
    expect(lastActive("session-1")).toBe(ROW.createdAt);

    // The session pauses mid-run on the always-ask approval — the one moment where the
    // run-start stamp is observable on its own.
    await manager.startTask("session-1", [userText("hello")]);
    await waitFor(() => manager.pendingApprovalCount("session-1") === 1);
    const midRun = lastActive("session-1");
    expect(midRun).toBe(at(0));
    expect(midRun > ROW.createdAt).toBe(true);

    manager.decideApproval("session-1", "tc-1", "allow");
    await waitFor(() => manager.statusOf("session-1") === "idle");
    // Strictly greater: the run END must have its own stamp, or a long Task would report
    // the moment it began as its last activity for as long as it runs.
    expect(lastActive("session-1")).toBe(at(1));
    expect(lastActive("session-1") > midRun).toBe(true);

    // A compaction is a driven run too, and stamps its own pair.
    await manager.startCompact("session-1");
    await waitFor(() => manager.statusOf("session-1") === "idle");
    expect(lastActive("session-1")).toBe(at(3));
    // A session with no activity keeps its creation stamp.
    expect(lastActive("session-other")).toBe("2026-07-07T00:00:00.000Z");
  });

  it("a failing last-active write cannot strand a run: idle is still published and queued follow-ups still start", async () => {
    sessions.updateApprovalMode("session-1", "allow-all");
    const logs: string[] = [];
    const recordedErrors: ErrorRecordArgs[] = [];
    const manager = new SessionManager({
      sessions: brokenTouchRepo(sessions),
      channels,
      sources,
      loader: loaderOf(approvalFakeSession("session-1")),
      recorder: { record: async () => {} },
      errors: { record: (args) => recordedErrors.push(args) },
      log: (line) => logs.push(line),
    });
    const events = capture("session-1");
    await manager.startTask("session-1", [userText("hello")]);
    // Queue a follow-up while the first run is in flight: its auto-start lives in the same
    // finally, AFTER the stamp — a throw there would stall it forever.
    await manager.startTask("session-1", [userText("second")], { queueIfBusy: true });
    await waitFor(() => manager.statusOf("session-1") === "idle" && logs.length >= 4);
    const states = serverEvents(events)
      .filter((e) => e.type === "task_state")
      .map((s) => s.state);
    // Two runs reached their wrap-up — the queued one only ever starts from inside the
    // finally, after the failing write — and the session ends up idle, not stuck running.
    expect(states.filter((s) => s === "idle")).toHaveLength(2);
    expect(states.at(-1)).toBe("idle");
    expect(manager.pendingFollowUpCount("session-1")).toBe(0);
    // The failure is reported, not silent.
    expect(logs.some((l) => l.includes("last-active bookkeeping failed"))).toBe(true);
    expect(recordedErrors.map((e) => e.code)).toContain("session_touch_failed");
  });

  it("startTask carries no thinking level: the manager assigns runtime state instead", async () => {
    sessions.updateApprovalMode("session-1", "allow-all");
    const runOpts: Record<string, unknown>[] = [];
    const fake: RuntimeSession = {
      sessionId: "session-1",
      toolPermission: () => "rw",
      thinkingLevel: undefined,
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok" as const,
      steer: () => false,
      skipReconnectWait: () => false,
      async *run(_input: OmniMessage[], opts: Record<string, unknown>) {
        runOpts.push(opts);
        yield assistantText("ok");
      },
      async *compact(): AsyncGenerator<OmniMessage> {},
    };
    const manager = makeManager(loaderOf(fake));
    await manager.startTask("session-1", [userText("a")]);
    await waitFor(() => manager.statusOf("session-1") === "idle" && runOpts.length === 1);
    expect("thinkingLevel" in runOpts[0]!).toBe(false);
    // What the Web App's in-chat picker writes reaches the loaded runtime as a plain
    // assignment (core applies it from the next request); a Session that is not loaded is a
    // no-op — the loader assigns the row's level when it loads.
    manager.setThinkingLevel("session-1", "xhigh");
    manager.setThinkingLevel("session-nowhere", "low");
    expect(fake.thinkingLevel).toBe("xhigh");
  });

  it("setThinkingLevel reaches a live child session through its parent's runtime", async () => {
    sessions.updateApprovalMode("session-1", "allow-all");
    const childPins: [string, string][] = [];
    const fake: RuntimeSession = {
      ...approvalFakeSession("session-1"),
      setBackgroundSubagentThinkingLevel: (childSessionId, level) => {
        if (childSessionId !== "child-1") return false;
        childPins.push([childSessionId, level]);
        return true;
      },
    };
    const manager = makeManager(loaderOf(fake));
    await manager.startTask("session-1", [userText("a")]);
    await waitFor(() => manager.statusOf("session-1") === "idle");
    // A child has an index row and a panel picker of its own but no entry: the PATCH lands
    // on the child Session inside the parent runtime. An unknown id stays a no-op.
    manager.setThinkingLevel("child-1", "high");
    manager.setThinkingLevel("child-nowhere", "low");
    expect(childPins).toEqual([["child-1", "high"]]);
  });

  it("a thinking-level PATCH racing the runtime load reaches the loaded runtime", async () => {
    sessions.updateApprovalMode("session-1", "allow-all");
    const fake: RuntimeSession = { ...approvalFakeSession("session-1"), thinkingLevel: undefined };
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // The loader applies the row it was handed — a snapshot taken before the await.
    const loader: SessionLoader = {
      load: async (row) => {
        await gate;
        if (row.thinkingLevel) fake.thinkingLevel = row.thinkingLevel;
        return fake;
      },
    };
    const manager = makeManager(loader);
    const started = manager.startTask("session-1", [userText("a")]);
    // The PATCH route's two writes land while the load is in flight: the row updates, the
    // runtime assignment finds no entry yet.
    sessions.updateThinkingLevel("session-1", "xhigh");
    manager.setThinkingLevel("session-1", "xhigh");
    release();
    await started;
    await waitFor(() => manager.statusOf("session-1") === "idle");
    expect(fake.thinkingLevel).toBe("xhigh");
  });

  it("a background notice arriving while idle auto-starts a task carrying the taken notices", async () => {
    sessions.updateApprovalMode("session-1", "allow-all");
    let noticeCb: (() => void) | null = null;
    const queue: OmniMessage[] = [];
    const runInputs: OmniMessage[][] = [];
    const fake: RuntimeSession = {
      sessionId: "session-1",
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok" as const,
      steer: () => false,
      skipReconnectWait: () => false,
      onBackgroundNotice: (cb) => (noticeCb = cb),
      takeBackgroundNotices: () => queue.splice(0),
      async *run(input: OmniMessage[]) {
        runInputs.push(input);
        yield assistantText("ok");
      },
      async *compact(): AsyncGenerator<OmniMessage> {},
    };
    const manager = makeManager(loaderOf(fake));
    // First task loads the entry (which registers the notice listener) and finishes.
    await manager.startTask("session-1", [userText("hi")]);
    await waitFor(() => manager.statusOf("session-1") === "idle" && runInputs.length === 1);
    expect(noticeCb).not.toBeNull();

    // A completion notice lands while idle: the manager takes the queue and starts a task with it.
    const events = capture("session-1");
    const notice = userText("[background_task_done]\nkind: command\n[/background_task_done]");
    queue.push(notice);
    noticeCb!();
    await waitFor(() => manager.statusOf("session-1") === "idle" && runInputs.length === 2);
    expect(runInputs[1]).toEqual([notice]);
    expect(queue).toHaveLength(0);
    // The notice input was published to subscribers like any task input.
    expect(events.some((e) => e.data.includes("background_task_done"))).toBe(true);

    // An empty queue signal is a no-op (no phantom task).
    noticeCb!();
    await new Promise((r) => setTimeout(r, 50));
    expect(runInputs).toHaveLength(2);
  });

  it("live-forwarded background-subagent messages publish to the channel and record usage", async () => {
    let forward: ((msg: OmniMessage) => void) | null = null;
    const fake: RuntimeSession = {
      sessionId: "session-1",
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok" as const,
      steer: () => false,
      skipReconnectWait: () => false,
      onBackgroundMessage: (cb) => (forward = cb),
      async *run() {},
      async *compact(): AsyncGenerator<OmniMessage> {},
    };
    const manager = makeManager(loaderOf(fake));
    manager.adopt(sessions.findById("session-1")!, fake);
    expect(forward).not.toBeNull();
    const events = capture("session-1");
    const child = withOrigin(assistantText("child progress"), "session-child-1");
    forward!(child);
    expect(events.some((e) => e.data.includes("child progress"))).toBe(true);
    // Usage recording rode along (same recorder drive uses).
    expect(recorded).toContain(child);
  });

  it("adopt registers the notice listener too (a freshly created session, no loader involved)", async () => {
    // Regression guard: POST /sessions enters the active table through adopt, not
    // ensureEntry — a listener registered only on the loader path left brand-new sessions
    // unable to deliver idle-arrival completion reports (the real-app no-notification bug).
    sessions.updateApprovalMode("session-1", "allow-all");
    let noticeCb: (() => void) | null = null;
    const queue: OmniMessage[] = [];
    const runInputs: OmniMessage[][] = [];
    const fake: RuntimeSession = {
      sessionId: "session-1",
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok" as const,
      steer: () => false,
      skipReconnectWait: () => false,
      onBackgroundNotice: (cb) => (noticeCb = cb),
      takeBackgroundNotices: () => queue.splice(0),
      async *run(input: OmniMessage[]) {
        runInputs.push(input);
        yield assistantText("ok");
      },
      async *compact(): AsyncGenerator<OmniMessage> {},
    };
    const manager = makeManager(loaderOf(fake));
    const row = sessions.findById("session-1")!;
    manager.adopt(row, fake);
    expect(noticeCb).not.toBeNull();
    queue.push(userText("[background_task_done]\nkind: command\n[/background_task_done]"));
    noticeCb!();
    await waitFor(() => manager.statusOf("session-1") === "idle" && runInputs.length === 1);
    expect(queue).toHaveLength(0);
  });

  it("end-to-end: a run_in_background command finishing after idle reaches the event channel as a harness user message", async () => {
    // Full production chain with the REAL core pieces — Session, engine, Environment and an
    // actual OS process — under the real SessionManager (loaded via the loader, which is
    // what registers the notice listener). Only the LLM is scripted. This is the frontend's
    // exact feed: the channel events asserted on are what SSE relays byte-for-byte.
    sessions.updateApprovalMode("session-1", "allow-all");
    const dir = await mkdtemp(path.join(tmpdir(), "penguin-bge2e-"));
    const environment = new Environment({
      workspaceDir: dir,
      toolConfig: {
        customTools: [
          {
            name: "exec_command",
            description: "run",
            permission: "rw",
            timeoutMs: 120000,
            maxOutputLength: 16000,
          },
        ],
        mcpServers: [],
      },
    });
    // Turn 1: launch a command that outlives the task; turn 2: final reply (task ends,
    // session idle, process still running); turn 3 is the auto-started notice task.
    const llm = new (class implements LLMInterface {
      calls = 0;
      inputs: OmniMessage[][] = [];
      async *streamGenerate(
        params: GenerativeModelParameters,
      ): AsyncGenerator<OmniMessage, LLMOutcome> {
        this.calls += 1;
        this.inputs.push(params.newMessages);
        if (this.calls === 1) {
          yield toolCall({
            name: "exec_command",
            arguments: JSON.stringify({
              cmd: "printf 'serving'; sleep 1",
              run_in_background: true,
            }),
            toolCallId: "tc_bg",
            stopReason: "completed",
          });
        } else {
          yield assistantText(`reply ${this.calls}`);
        }
        yield tokenUsage(emptyTokenCounts(), {
          cache_read: 0,
          cache_write: 0,
          output: 1,
          total: 2,
        });
        return { status: "completed" };
      }
    })();
    const session = new Session({
      meta: {
        session_id: "session-1",
        provider: "custom",
        model_id: "m1",
        model_context_window: 100000,
        system_prompt: "sp",
        agent_state: dir,
        workspace: dir,
      },
      bootstrap: async () => ({ llm }),
      environment,
      imagesDir: path.join(dir, "images"),
      modelHasVision: true,
    });
    try {
      const manager = makeManager(loaderOf(session as unknown as RuntimeSession));
      const events = capture("session-1");
      await manager.startTask("session-1", [userText("start a dev server")]);
      await waitFor(() => manager.statusOf("session-1") === "idle" && llm.calls === 2, 5000);
      // The task is over, the background process is still alive, and no notice exists yet —
      // what follows is genuinely the idle-arrival path.
      expect(events.some((e) => e.data.includes("background_task_done"))).toBe(false);

      // The process exits ~1s in: the completion report must land on the channel as a
      // harness user message and auto-start a task the model answers.
      await waitFor(() => events.some((e) => e.data.includes("background_task_done")), 8000);
      const notice = events.find((e) => e.data.includes("background_task_done"))!;
      expect(notice.data).toContain('"sender":"harness"');
      expect(notice.data).toContain('"role":"user"');
      expect(notice.data).toContain("serving");
      await waitFor(() => llm.calls === 3 && manager.statusOf("session-1") === "idle", 5000);
      const turn3 = llm.inputs[2]!.map((m) => (m.payload as { text?: string }).text ?? "");
      expect(turn3.join("\n")).toContain("[background_task_done]");
      // The auto task's state flips were broadcast too (the frontend's input gating):
      // one running per task, so the notice task makes it at least two.
      const running = events.filter(
        (e) => e.data.includes('"type":"task_state"') && e.data.includes('"state":"running"'),
      );
      expect(running.length).toBeGreaterThan(1);
    } finally {
      session.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("LLM / tool failures in the message stream are persisted via drive (source=llm / environment, with the current Session context)", async () => {
    sessions.updateApprovalMode("session-1", "allow-all");
    const captured: ErrorRecordArgs[] = [];
    // core folds LLM / tool failures into the message stream (no throw): a tool
    // failure produces one tool_call_output(failed), an LLM failure produces one
    // request_end(failed) + an abort carrying the real reason.
    const failing: RuntimeSession = {
      sessionId: "session-1",
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok" as const,
      steer: () => false,
      skipReconnectWait: () => false,
      async *run(): AsyncGenerator<OmniMessage> {
        yield requestBegin();
        yield toolCall({ name: "write_file", arguments: "{}", toolCallId: "tc-1" });
        yield toolCallOutput({
          output: "ls: /nope\n[tool error] exit code 2",
          toolCallId: "tc-1",
          stopReason: "fatal",
        });
        // The ladder's terminal failure: no retry planned (no retry_in_ms), the run ends
        // on this record — no abort event follows.
        yield requestEnd("retryable", {
          attempt: 6,
          errorCode: "network",
          errorMessage: "500 upstream",
        });
      },
      async *compact(): AsyncGenerator<OmniMessage> {},
    };
    const manager = makeManager(loaderOf(failing), { record: (args) => captured.push(args) });
    await manager.startTask("session-1", [userText("run")]);
    await waitFor(() => manager.statusOf("session-1") === "idle" && captured.length >= 2);

    expect(captured.map((a) => [a.source, a.code, a.kind])).toEqual([
      ["environment", "tool_fatal:write_file", "expected"], // error fed back to the model; the Agent adjusts on its own
      ["llm", "llm_failed", "unexpected"], // nothing followed it: the retries did not recover it, so a human is needed
    ]);
    expect(captured[0]!.ctx).toEqual({ projectId: "p1", agentId: "a1", sessionId: "session-1" });
    expect(String(captured[0]!.err)).toContain("[tool error] exit code 2");
    expect(String(captured[1]!.err)).toBe("llm request failed after 5 retries: 500 upstream");
  });

  it("mutual exclusion: startTask again while running → 409 task_in_progress; compact → 409", async () => {
    const manager = makeManager(loaderOf(approvalFakeSession("session-1")));
    await manager.startTask("session-1", [userText("go")]);
    await waitFor(() => manager.pendingApprovalCount("session-1") === 1);

    const again = await manager.startTask("session-1", [userText("x")]).catch((e: unknown) => e);
    expect((again as { status: number; code: string }).status).toBe(409);
    expect((again as { code: string }).code).toBe("task_in_progress");
    const compact = await manager.startCompact("session-1").catch((e: unknown) => e);
    expect((compact as { status: number }).status).toBe(409);

    manager.decideApproval("session-1", "tc-1", "allow");
    await waitFor(() => manager.statusOf("session-1") === "idle");
  });

  it("compact refusal: each reason gets its own error code, not one shared code", async () => {
    // Clients localize by code (the Web looks it up in a table and falls back to the raw
    // English message), so the three reasons cannot share one code: that forces either a
    // single vague sentence for all three, or untranslated English in a non-English UI.
    const cases = [
      ["unsupported", "compaction_not_configured"],
      ["empty", "nothing_to_compact"],
      ["just_compacted", "already_compacted"],
    ] as const;

    for (const [why, code] of cases) {
      const session: RuntimeSession = {
        ...approvalFakeSession("session-1"),
        compactability: () => why,
      };
      const manager = makeManager(loaderOf(session));
      const err = await manager.startCompact("session-1").catch((e: unknown) => e);
      expect((err as { status: number }).status).toBe(409);
      expect((err as { code: string }).code).toBe(code);
      // The message still names the reason, for a client that has not mapped the code.
      expect((err as { message: string }).message).not.toBe("");
    }
  });

  it("steer: forwards to the running session; idle / lost race → 409 not_running", async () => {
    const steered: string[] = [];
    const fake = approvalFakeSession("session-1");
    fake.steer = (input: OmniMessage[]) => {
      steered.push((input[0]!.payload as TextPayload).text);
      return true;
    };
    const manager = makeManager(loaderOf(fake));
    const steerErr = (text: string): unknown => {
      try {
        manager.steer("session-1", [userText(text)], { text, images: [], files: [] });
        return null;
      } catch (e) {
        return e;
      }
    };

    // Not running (entry not even loaded): 409 not_running (typed like task_in_progress).
    const before = steerErr("early") as HttpError;
    expect(before.status).toBe(409);
    expect(before.code).toBe("not_running");

    await manager.startTask("session-1", [userText("go")]);
    await waitFor(() => manager.pendingApprovalCount("session-1") === 1);
    // Running: forwarded to the core session (no SSE event of its own).
    expect(steerErr("focus on tests")).toBeNull();
    expect(steered).toEqual(["focus on tests"]);

    // The core session lost the race (its run just finished): also 409, so the
    // caller falls back to a normal task.
    fake.steer = () => false;
    expect((steerErr("late") as HttpError).code).toBe("not_running");

    manager.decideApproval("session-1", "tc-1", "allow");
    await waitFor(() => manager.statusOf("session-1") === "idle");
    // Idle again after the run: 409.
    expect((steerErr("post") as HttpError).code).toBe("not_running");
  });

  it("pendingSteering mirror: broadcast with task_state on steer, shifted at delivery, dropped at run end", async () => {
    // Two approval parks, with core's delivery shape — one `[user_steering]` user text —
    // yielded between them, so the mid-run shift is observable while the run keeps going.
    const fake: RuntimeSession = {
      ...approvalFakeSession("session-1"),
      steer: () => true,
      async *run(_input: OmniMessage[], opts: { approve: ApproveFn; signal: AbortSignal }) {
        const tc1 = toolCall({ name: "write_file", arguments: "{}", toolCallId: "tc-1" });
        yield tc1;
        yield approvalDecision(await opts.approve(tc1), "tc-1");
        yield userText(userSteeringText("focus on tests"));
        const tc2 = toolCall({ name: "write_file", arguments: "{}", toolCallId: "tc-2" });
        yield tc2;
        yield approvalDecision(await opts.approve(tc2), "tc-2");
        yield assistantText("done");
      },
    };
    const manager = makeManager(loaderOf(fake));
    const events = capture("session-1");
    await manager.startTask("session-1", [userText("go")]);
    await waitFor(() => manager.pendingApprovalCount("session-1") === 1);

    // Two queued steering messages: the mirror keeps both, in queue order.
    manager.steer("session-1", [userText("a")], { text: "focus on tests", images: [], files: [] });
    manager.steer("session-1", [userText("b")], {
      text: "later",
      images: ["data:image/png;base64,aa"],
      files: [
        { fileName: "a.txt", path: "/tmp/a.txt", mime: "text/plain" },
        { fileName: "b.txt", path: "/tmp/b.txt", mime: "text/plain" },
      ],
    });
    expect(manager.pendingSteeringOf("session-1")).toEqual([
      { id: expect.any(String), text: "focus on tests", images: 0, files: 0 },
      { id: expect.any(String), text: "later", images: 1, files: 2 },
    ]);

    // First delivery observed on the stream: the mirror shifts while the run is still going.
    manager.decideApproval("session-1", "tc-1", "allow");
    await waitFor(() => manager.pendingSteeringOf("session-1").length === 1);
    expect(manager.statusOf("session-1")).toBe("running");
    expect(manager.pendingSteeringOf("session-1")).toEqual([
      { id: expect.any(String), text: "later", images: 1, files: 2 },
    ]);

    // Run end: core discards undelivered steering, and the mirror goes with it.
    await waitFor(() => manager.pendingApprovalCount("session-1") === 1);
    manager.decideApproval("session-1", "tc-2", "allow");
    await waitFor(() => manager.statusOf("session-1") === "idle");
    expect(manager.pendingSteeringOf("session-1")).toEqual([]);

    // task_state broadcasts traced the whole lifecycle: grow to 1, 2, shift to 1, gone at idle.
    const states = serverEvents(events).filter((e) => e.type === "task_state");
    const mirrored = states
      .filter((e) => e.pendingSteering !== undefined)
      .map((e) => (e.pendingSteering as unknown[]).length);
    expect(mirrored).toEqual([1, 2, 1]);
    const last = states[states.length - 1]!;
    expect(last.state).toBe("idle");
    expect(last.pendingSteering).toBeUndefined();
  });

  it("queueIfBusy: enqueues while running, auto-starts in order after each finish; abort keeps the queue", async () => {
    sessions.updateApprovalMode("session-1", "always-ask");
    const runInputs: string[][] = [];
    const fake = approvalFakeSession("session-1");
    const origRun = fake.run.bind(fake);
    fake.run = function (input: OmniMessage[], opts: { approve: ApproveFn; signal: AbortSignal }) {
      runInputs.push(input.map((m) => (m.payload as { text?: string }).text ?? ""));
      return origRun(input, opts);
    };
    const manager = makeManager(loaderOf(fake));
    const events = capture("session-1");

    const first = await manager.startTask("session-1", [userText("task 1")]);
    expect(first.queued).toBe(false);
    await waitFor(() => manager.pendingApprovalCount("session-1") === 1);

    // Busy + queueIfBusy: held server-side instead of 409 (order preserved); without the
    // flag the 409 mutual exclusion is unchanged.
    const q1 = await manager.startTask("session-1", [userText("follow-up 1")], {
      queueIfBusy: true,
    });
    const q2 = await manager.startTask("session-1", [userText("follow-up 2")], {
      queueIfBusy: true,
    });
    expect([q1.queued, q2.queued]).toEqual([true, true]);
    expect(manager.pendingFollowUpCount("session-1")).toBe(2);
    const conflict = await manager.startTask("session-1", [userText("x")]).catch((e: unknown) => e);
    expect((conflict as HttpError).code).toBe("task_in_progress");

    // Abort the running task: queued follow-ups are future tasks — NOT discarded; the next
    // one auto-starts as an ordinary task once the aborted run settles.
    manager.abortTask("session-1");
    await waitFor(() => runInputs.length === 2);
    expect(runInputs[1]).toEqual(["follow-up 1"]);
    expect(manager.pendingFollowUpCount("session-1")).toBe(1);

    // Finishing each run starts the next queued input, in order, one at a time.
    await waitFor(() => manager.pendingApprovalCount("session-1") === 1);
    manager.decideApproval("session-1", "tc-1", "allow");
    await waitFor(() => runInputs.length === 3);
    expect(runInputs[2]).toEqual(["follow-up 2"]);
    await waitFor(() => manager.pendingApprovalCount("session-1") === 1);
    manager.decideApproval("session-1", "tc-1", "allow");
    await waitFor(
      () =>
        manager.statusOf("session-1") === "idle" && manager.pendingFollowUpCount("session-1") === 0,
    );

    // task_state events report the queued count (for the input area's "N queued" hint).
    const states = serverEvents(events).filter((e) => e.type === "task_state");
    expect(states.some((s) => s.queued === 2)).toBe(true);
    expect(states[states.length - 1]).toMatchObject({ state: "idle", queued: 0 });
  });

  it("queueIfBusy during compaction: the queue drains once the compaction ends", async () => {
    const runInputs: string[][] = [];
    let releaseCompact: (() => void) | null = null;
    const fake: RuntimeSession = {
      sessionId: "session-1",
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok" as const,
      steer: () => false,
      skipReconnectWait: () => false,
      // eslint-disable-next-line require-yield
      async *run(input: OmniMessage[]): AsyncGenerator<OmniMessage> {
        runInputs.push(input.map((m) => (m.payload as { text?: string }).text ?? ""));
      },
      async *compact(): AsyncGenerator<OmniMessage> {
        await new Promise<void>((resolve) => {
          releaseCompact = resolve;
        });
        yield compactionBegin({ reason: "manual", mode: "summarize", context: 1, turns: 1 });
        yield compactionEnd({ reason: "manual", mode: "summarize", status: "completed" });
      },
    };
    const manager = makeManager(loaderOf(fake));
    await manager.startCompact("session-1");
    await waitFor(() => releaseCompact !== null);

    const q = await manager.startTask("session-1", [userText("after compact")], {
      queueIfBusy: true,
    });
    expect(q.queued).toBe(true);
    expect(manager.pendingFollowUpCount("session-1")).toBe(1);

    releaseCompact!();
    await waitFor(() => runInputs.length === 1 && manager.pendingFollowUpCount("session-1") === 0);
    expect(runInputs[0]).toEqual(["after compact"]);
    await waitFor(() => manager.statusOf("session-1") === "idle");
  });

  it("always-ask: registers a pending approval and pushes approval_request; continues after the decision", async () => {
    const manager = makeManager(loaderOf(approvalFakeSession("session-1")));
    const events = capture("session-1");
    await manager.startTask("session-1", [userText("go")]);
    await waitFor(() => manager.pendingApprovalCount("session-1") === 1);

    const requests = serverEvents(events).filter((e) => e.type === "approval_request");
    expect(requests).toHaveLength(1);
    expect(
      (requests[0]!.toolCall as { payload: { tool_call_id: string } }).payload.tool_call_id,
    ).toBe("tc-1");
    expect(manager.pendingApprovals("session-1")).toHaveLength(1);

    expect(manager.decideApproval("session-1", "tc-404", "allow")).toBe(false);
    expect(manager.decideApproval("session-1", "tc-1", "allow")).toBe(true);
    await waitFor(() => manager.statusOf("session-1") === "idle");
    expect(manager.pendingApprovalCount("session-1")).toBe(0);
    const texts = recorded
      .filter((m) => (m.payload as { type?: string }).type === "text")
      .map((m) => (m.payload as { text: string }).text);
    expect(texts).toContain("decision=allow");
  });

  it("deny-all / read-only decide automatically (no human handoff)", async () => {
    sessions.updateApprovalMode("session-1", "deny-all");
    const manager = makeManager(loaderOf(approvalFakeSession("session-1")));
    await manager.startTask("session-1", [userText("go")]);
    await waitFor(() => manager.statusOf("session-1") === "idle");
    expect(
      recorded.some(
        (m) =>
          (m.payload as { type?: string; decision?: string }).type === "approval_decision" &&
          (m.payload as { decision: string }).decision === "deny",
      ),
    ).toBe(true);

    // read-only: read-only tools are auto-approved.
    recorded = [];
    sessions.updateApprovalMode("session-1", "read-only");
    const manager2 = makeManager(loaderOf(approvalFakeSession("session-1", "read_tool")));
    await manager2.startTask("session-1", [userText("go")]);
    await waitFor(() => manager2.statusOf("session-1") === "idle");
    expect(recorded.some((m) => (m.payload as { text?: string }).text === "decision=allow")).toBe(
      true,
    );
  });

  it("sub-session (origin) registration: session_meta persists; the title is generated from the spawning prompt", async () => {
    const fake: RuntimeSession = {
      sessionId: "session-1",
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok" as const,
      steer: () => false,
      skipReconnectWait: () => false,
      async *run() {
        // The parent-level run_subagent call (no origin): its prompt becomes the sub-session title.
        yield toolCall({
          name: "run_subagent",
          arguments: JSON.stringify({ prompt: "Research the background of this question" }),
          toolCallId: "sub-1",
        });
        const hop = "child-1";
        yield withOrigin(
          sessionMeta({
            session_id: "child-1",
            model_id: "m-child",
            provider: "custom",
            model_context_window: 1000,
            system_prompt: "sys",
            agent_state: "/root/p1/child_agent/agent_state",
            workspace: "/tmp/w-child",
          }),
          hop,
        );
        yield withOrigin(assistantText("child done"), hop);
        yield assistantText("done");
      },
      async *compact() {},
    };
    const notified: Array<{ ctx: UsageContext; req: TitleRequest }> = [];
    const manager = new SessionManager({
      sessions,
      channels,
      sources,
      loader: loaderOf(fake),
      recorder: { record: async () => {} },
      titles: {
        maybeGenerate: (ctx, _session, req) => notified.push({ ctx, req }),
      },
      log: () => {},
    });
    await manager.startTask("session-1", [userText("go")]);
    await waitFor(() => manager.statusOf("session-1") === "idle");
    const child = sessions.findById("child-1");
    expect(child).not.toBeNull();
    expect(child?.agentId).toBe("child_agent");
    expect(child?.modelId).toBe("m-child");
    expect(child?.workspace).toBe("/tmp/w-child");
    // The origin lands in the in-process registry (session_meta is the single source of
    // truth; the row stores no source column) — "subagent" even when the forwarded meta
    // predates the source field (this fake omits it): the registration path is the fallback.
    expect(sources.get("child-1")).toBe("subagent");
    expect(child && "source" in child).toBe(false);
    // The row itself is inserted with a blank title: the title generator (faked here) is
    // notified at registration and owns the write.
    expect(child?.title).toBeNull();

    await waitFor(() => notified.length === 2);
    const childTitle = notified.find((n) => n.ctx.sessionId === "child-1");
    expect(childTitle).toBeTruthy();
    // Explicit material override for the sub-session: the prompt that spawned it, alone — its own output is never waited for.
    expect(childTitle!.req.material).toEqual({
      userText: "Research the background of this question",
      assistantText: "",
    });
    expect(childTitle!.req.fallbackText).toBe("Research the background of this question");
    // Session/Agent record the sub-session, but modelId records the parent — the request runs on the parent's bare LLM.
    expect(childTitle!.ctx).toMatchObject({ agentId: "child_agent", modelId: "m1" });
    // The sub-session has no SSE channel of its own: title events are delivered over the parent session's channel.
    expect(childTitle!.req.notifyOn).toBe("session-1");
  });

  it("approval mode takes effect immediately: after a mid-run PATCH, the next decision uses the new mode", async () => {
    // A fake Session that requests approval twice.
    const fake: RuntimeSession = {
      sessionId: "session-1",
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok" as const,
      steer: () => false,
      skipReconnectWait: () => false,
      async *run(_input, opts) {
        const tc1 = toolCall({ name: "t1", arguments: "{}", toolCallId: "tc-1" });
        yield tc1;
        yield approvalDecision(await opts.approve(tc1), "tc-1");
        const tc2 = toolCall({ name: "t2", arguments: "{}", toolCallId: "tc-2" });
        yield tc2;
        yield approvalDecision(await opts.approve(tc2), "tc-2");
      },
      async *compact() {},
    };
    const manager = makeManager(loaderOf(fake));
    await manager.startTask("session-1", [userText("go")]);
    await waitFor(() => manager.pendingApprovalCount("session-1") === 1);
    // Switch to allow-all while the first request is pending human review: the second no longer needs one.
    sessions.updateApprovalMode("session-1", "allow-all");
    manager.decideApproval("session-1", "tc-1", "deny");
    await waitFor(() => manager.statusOf("session-1") === "idle");
    const decisions = recorded
      .filter((m) => (m.payload as { type?: string }).type === "approval_decision")
      .map((m) => (m.payload as { decision: string }).decision);
    expect(decisions).toEqual(["deny", "allow"]);
    expect(manager.pendingApprovalCount("session-1")).toBe(0);
  });

  it("abort: pending approvals collapse to deny before the AbortSignal fires", async () => {
    const manager = makeManager(loaderOf(approvalFakeSession("session-1")));
    expect(manager.abortTask("session-1")).toBe(false); // no Task in progress → no-op
    await manager.startTask("session-1", [userText("go")]);
    await waitFor(() => manager.pendingApprovalCount("session-1") === 1);
    expect(manager.abortTask("session-1")).toBe(true);
    await waitFor(() => manager.statusOf("session-1") === "idle");
    const payloads = recorded.map((m) => m.payload as { type?: string; decision?: string });
    expect(payloads.some((p) => p.type === "approval_decision" && p.decision === "deny")).toBe(
      true,
    );
    expect(payloads.some((p) => p.type === "abort")).toBe(true);
  });

  it("beginSessionDeletion: interrupts active runs, clears the active table and marks deleting (new Tasks 409); recovers after end", async () => {
    const manager = makeManager(loaderOf(approvalFakeSession("session-1")));
    expect(manager.beginSessionDeletion("session-1")).toEqual([]); // no active entry
    // While deletion is in progress: a new Task is rejected with 409 (prevents resurrection).
    const rejected = await manager.startTask("session-1", [userText("x")]).catch((e: unknown) => e);
    expect((rejected as { status?: number }).status).toBe(409);
    manager.endSessionDeletion("session-1");
    // Runs normally once the deletion flag is cleared.
    await manager.startTask("session-1", [userText("go")]);
    await waitFor(() => manager.pendingApprovalCount("session-1") === 1);
    const runnings = manager.beginSessionDeletion("session-1");
    expect(runnings.length).toBe(1);
    await Promise.allSettled(runnings);
    expect(manager.statusOf("session-1")).toBe("idle"); // entry has been removed
    manager.endSessionDeletion("session-1");
  });

  it("self-heal: when the loader returns a new session_id, the index primary key is updated and the actual current id returned", async () => {
    sessions.updateApprovalMode("session-1", "allow-all");
    const manager = makeManager(loaderOf(approvalFakeSession("session-2-healed")));
    const { sessionId } = await manager.startTask("session-1", [userText("go")]);
    expect(sessionId).toBe("session-2-healed");
    expect(sessions.findById("session-1")).toBeNull();
    expect(sessions.findById("session-2-healed")).not.toBeNull();
    await waitFor(() => manager.statusOf("session-2-healed") === "idle");
    // Usage is attributed under the new id.
    expect(recordedCtx[0]!.sessionId).toBe("session-2-healed");
  });

  it("after the channel is swept and rebuilt, drive still sends to the current channel (re-get before every publish)", async () => {
    const manager = makeManager(loaderOf(approvalFakeSession("session-1")));
    await manager.startTask("session-1", [userText("go")]);
    await waitFor(() => manager.pendingApprovalCount("session-1") === 1);

    // No subscribers, no publish while waiting for approval: simulate idle sweeping removing the old channel.
    channels.sweep(Date.now() + 60 * 60 * 1000);
    // Reconnect: hub.get creates a brand-new channel, and we subscribe to it.
    const events = capture("session-1");
    manager.decideApproval("session-1", "tc-1", "allow");
    await waitFor(() => manager.statusOf("session-1") === "idle");

    // The remaining output and task_state after approval must land on the new channel (the old reference should already be stale).
    const texts = events
      .filter((e) => e.event === undefined)
      .map((e) => (JSON.parse(e.data) as { payload: { type?: string; text?: string } }).payload)
      .filter((p) => p.type === "text")
      .map((p) => p.text);
    expect(texts).toContain("decision=allow");
    const states = serverEvents(events).filter((e) => e.type === "task_state");
    expect(states.map((s) => s.state)).toContain("idle");
  });

  it("abortProject: returns the in-flight drive Promises; wrap-up completes after awaiting them", async () => {
    const manager = makeManager(loaderOf(approvalFakeSession("session-1")));
    expect(manager.abortProject("p1")).toEqual([]); // no active runs → empty array
    await manager.startTask("session-1", [userText("go")]);
    await waitFor(() => manager.pendingApprovalCount("session-1") === 1);

    const runnings = manager.abortProject("p1");
    expect(runnings).toHaveLength(1);
    await Promise.allSettled(runnings);
    // Wrap-up complete: the abort cleanup (abort event) has been written, and the entry has been removed from the active table.
    expect(recorded.some((m) => (m.payload as { type?: string }).type === "abort")).toBe(true);
    expect(manager.statusOf("session-1")).toBe("idle");
  });

  it("loader throwing HttpError (e.g. workspace_missing 409) → passed through as-is, not re-wrapped", async () => {
    const loader: SessionLoader = {
      load: async () => {
        throw new HttpError(409, "workspace_missing", "Workspace no longer exists.");
      },
    };
    const manager = makeManager(loader);
    const err = await manager.startTask("session-1", [userText("x")]).catch((e: unknown) => e);
    expect((err as { status: number; code: string }).status).toBe(409);
    expect((err as { code: string }).code).toBe("workspace_missing");
  });

  it("shutdown disposes each Session's environment, so background commands die with the App", async () => {
    // A hot swap that skipped this would orphan e.g. a dev server the conversation
    // started: the OS process keeps running while the successor's freshly resumed
    // Session starts with an empty process list — the stop control has gone blind.
    const fake = approvalFakeSession("session-1");
    let disposed = 0;
    (fake as { dispose?: () => void }).dispose = () => {
      disposed++;
    };
    const manager = makeManager(loaderOf(fake));
    manager.adopt(ROW, fake);
    await manager.shutdown();
    expect(disposed).toBe(1);
  });

  it("rejects new Tasks once shutdown is set (503 shutting_down)", async () => {
    const manager = makeManager(loaderOf(approvalFakeSession("session-1")));
    await manager.shutdown();
    const err = await manager.startTask("session-1", [userText("x")]).catch((e: unknown) => e);
    expect((err as { status: number; code: string }).status).toBe(503);
    expect((err as { code: string }).code).toBe("shutting_down");
    const compactErr = await manager.startCompact("session-1").catch((e: unknown) => e);
    expect((compactErr as { status: number }).status).toBe(503);
  });

  it("sweepIdle: entries idle past the timeout are evicted (reloaded via the loader on next access)", async () => {
    let loads = 0;
    const loader: SessionLoader = {
      load: async () => {
        loads++;
        return approvalFakeSession("session-1");
      },
    };
    const manager = makeManager(loader);
    manager.adopt(ROW, approvalFakeSession("session-1"));
    // Not evicted before timeout: startTask reuses the active-table entry, bypassing the loader.
    manager.sweepIdle(Date.now() + 1000, 30 * 60 * 1000);
    sessions.updateApprovalMode("session-1", "allow-all");
    await manager.startTask("session-1", [userText("a")]);
    await waitFor(() => manager.statusOf("session-1") === "idle");
    expect(loads).toBe(0);

    // Evicted after timeout: once the entry is released, the next startTask reloads it.
    manager.sweepIdle(Date.now() + 31 * 60 * 1000, 30 * 60 * 1000);
    await manager.startTask("session-1", [userText("b")]);
    await waitFor(() => manager.statusOf("session-1") === "idle");
    expect(loads).toBe(1);
  });

  it("invalidateAgentRuntimes: an idle entry is discarded and re-resumed on next access; other Agents unaffected", async () => {
    let loads = 0;
    const loader: SessionLoader = {
      load: async () => {
        loads++;
        return approvalFakeSession("session-1");
      },
    };
    const manager = makeManager(loader);
    sessions.updateApprovalMode("session-1", "allow-all");
    // Adopted after creation: records the current generation, so Tasks reuse it without loading.
    manager.adopt(ROW, approvalFakeSession("session-1"));

    // Another Agent's vault update leaves this entry alone.
    manager.invalidateAgentRuntimes("p1", "other_agent");
    await manager.startTask("session-1", [userText("a")]);
    await waitFor(() => manager.statusOf("session-1") === "idle");
    expect(loads).toBe(0);

    // This Agent's vault update: the next Task rebuilds the runtime via the loader.
    manager.invalidateAgentRuntimes("p1", "a1");
    await manager.startTask("session-1", [userText("b")]);
    await waitFor(() => manager.statusOf("session-1") === "idle");
    expect(loads).toBe(1);

    // Rebuilt once only: the fresh entry is current again.
    await manager.startTask("session-1", [userText("c")]);
    await waitFor(() => manager.statusOf("session-1") === "idle");
    expect(loads).toBe(1);
  });

  it("invalidateAgentRuntimes mid-run: the in-flight Task keeps its runtime; the first Task after it finishes re-resumes", async () => {
    let loads = 0;
    const loader: SessionLoader = {
      load: async () => {
        loads++;
        return approvalFakeSession("session-1");
      },
    };
    const manager = makeManager(loader);
    await manager.startTask("session-1", [userText("go")]); // built here: load #1
    await waitFor(() => manager.pendingApprovalCount("session-1") === 1);

    manager.invalidateAgentRuntimes("p1", "a1"); // vault updated while the Task waits on approval
    // The pending approval still targets the live entry: the run completes on the old runtime.
    expect(manager.decideApproval("session-1", "tc-1", "allow")).toBe(true);
    await waitFor(() => manager.statusOf("session-1") === "idle");
    expect(loads).toBe(1);

    // First Task after it finished: the stale entry is discarded and re-resumed with current values.
    sessions.updateApprovalMode("session-1", "allow-all");
    await manager.startTask("session-1", [userText("next")]);
    await waitFor(() => manager.statusOf("session-1") === "idle");
    expect(loads).toBe(2);
  });

  it("invalidateProjectRuntimes: every cached entry in the Project is rebuilt; other Projects unaffected", async () => {
    // Two Agents with cached runtimes in p1, one in p2 — a models/credential update to p1
    // must reach BOTH of p1's Agents (collected from the active table) and leave p2 alone.
    const rowA2: SessionRow = { ...ROW, sessionId: "session-2", agentId: "a2" };
    const rowP2: SessionRow = { ...ROW, sessionId: "session-3", projectId: "p2" };
    sessions.insert(rowA2);
    sessions.insert(rowP2);
    let loads = 0;
    const loader: SessionLoader = {
      load: async (row) => {
        loads++;
        return approvalFakeSession(row.sessionId);
      },
    };
    const manager = makeManager(loader);
    for (const sid of ["session-1", "session-2", "session-3"]) {
      sessions.updateApprovalMode(sid, "allow-all");
    }
    manager.adopt(ROW, approvalFakeSession("session-1"));
    manager.adopt(rowA2, approvalFakeSession("session-2"));
    manager.adopt(rowP2, approvalFakeSession("session-3"));

    manager.invalidateProjectRuntimes("p1");
    // Both p1 entries are stale and rebuild through the loader on their next Task.
    await manager.startTask("session-1", [userText("a")]);
    await waitFor(() => manager.statusOf("session-1") === "idle");
    await manager.startTask("session-2", [userText("b")]);
    await waitFor(() => manager.statusOf("session-2") === "idle");
    expect(loads).toBe(2);
    // The p2 entry keeps its cached runtime.
    await manager.startTask("session-3", [userText("c")]);
    await waitFor(() => manager.statusOf("session-3") === "idle");
    expect(loads).toBe(2);
  });

  it("sweepIdle: entries that are running / have pending approvals are not evicted", async () => {
    const manager = makeManager(loaderOf(approvalFakeSession("session-1")));
    await manager.startTask("session-1", [userText("go")]);
    await waitFor(() => manager.pendingApprovalCount("session-1") === 1);
    manager.sweepIdle(Date.now() + 24 * 60 * 60 * 1000, 30 * 60 * 1000);
    // The entry is still there: the approval can be decided and wraps up normally.
    expect(manager.statusOf("session-1")).toBe("running");
    expect(manager.decideApproval("session-1", "tc-1", "allow")).toBe(true);
    await waitFor(() => manager.statusOf("session-1") === "idle");
  });

  it("sweepIdle: a working background subagent pins the entry, and its live messages count as activity", async () => {
    // A run_in_background child outlives the task that launched it. Evicting the entry
    // while it works drops the very Session its completion report is queued on.
    let running = true;
    let loads = 0;
    let forward: ((msg: OmniMessage) => void) | null = null;
    const fake = (): RuntimeSession => ({
      sessionId: "session-1",
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok" as const,
      steer: () => false,
      skipReconnectWait: () => false,
      hasRunningBackgroundSubagents: () => running,
      onBackgroundMessage: (cb) => (forward = cb),
      async *run() {},
      async *compact(): AsyncGenerator<OmniMessage> {},
    });
    const manager = makeManager({
      load: async () => {
        loads++;
        return fake();
      },
    });
    manager.adopt(ROW, fake());
    const long = 31 * 60 * 1000;

    // Far past the idle timeout, but the child is still working: the entry stays.
    manager.sweepIdle(Date.now() + long, 30 * 60 * 1000);
    sessions.updateApprovalMode("session-1", "allow-all");
    await manager.startTask("session-1", [userText("a")]);
    await waitFor(() => manager.statusOf("session-1") === "idle");
    expect(loads).toBe(0);

    // The child streaming is activity in its own right, so the idle clock restarts with it.
    expect(forward).not.toBeNull();
    const before = Date.now();
    forward!(withOrigin(assistantText("child progress"), "session-child-1"));
    manager.sweepIdle(before + long, 30 * 60 * 1000);
    await manager.startTask("session-1", [userText("b")]);
    await waitFor(() => manager.statusOf("session-1") === "idle");
    expect(loads).toBe(0);

    // Once it settles, the entry is an ordinary idle one again and evicts on schedule.
    running = false;
    manager.sweepIdle(Date.now() + long, 30 * 60 * 1000);
    await manager.startTask("session-1", [userText("c")]);
    await waitFor(() => manager.statusOf("session-1") === "idle");
    expect(loads).toBe(1);
  });

  it("compact: sets compacting, output goes to the channel, returns to idle at the end", async () => {
    const manager = makeManager(loaderOf(approvalFakeSession("session-1")));
    const events = capture("session-1");
    await manager.startCompact("session-1");
    await waitFor(() => manager.statusOf("session-1") === "idle" && recorded.length >= 2);
    const states = serverEvents(events).filter((e) => e.type === "task_state");
    expect(states.map((s) => s.state)).toEqual(["compacting", "idle"]);
    expect(recorded.map((m) => (m.payload as { type: string }).type)).toEqual([
      "compaction_begin",
      "compaction_end",
    ]);
  });

  it("notifies title generation at Task start: fallback and generation material are the user input alone; compaction doesn't notify", async () => {
    const notified: { ctx: UsageContext; session: unknown; req: TitleRequest }[] = [];
    const plainSession: RuntimeSession = {
      sessionId: "session-1",
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok" as const,
      steer: () => false,
      skipReconnectWait: () => false,
      async *run() {
        yield thinkingMessage("thinking");
        yield assistantText("answer A");
        yield withOrigin(assistantText("sub-session text"), "session-sub");
        yield assistantText("answer B");
      },
      async *compact() {
        yield compactionBegin({ reason: "manual", mode: "summarize", context: 1, turns: 1 });
        yield compactionEnd({ reason: "manual", mode: "summarize", status: "completed" });
      },
    };
    const manager = new SessionManager({
      sessions,
      channels,
      sources,
      loader: loaderOf(plainSession),
      recorder: { record: async () => {} },
      titles: {
        maybeGenerate: (ctx, session, req) => notified.push({ ctx, session, req }),
      },
      log: () => {},
    });

    await manager.startTask("session-1", [userText("question 1"), userText("question 2")]);
    await waitFor(() => notified.length === 1);
    expect(notified[0]!.req.fallbackText).toBe("question 1\nquestion 2");
    // The generation material is the user input alone — no assistant text, nothing waits on it.
    expect(notified[0]!.req.material).toEqual({
      userText: "question 1\nquestion 2",
      assistantText: "",
    });
    expect(notified[0]!.session).toBe(plainSession);
    expect(notified[0]!.ctx).toMatchObject({
      projectId: "p1",
      agentId: "a1",
      sessionId: "session-1",
      modelId: "m1",
      provider: "custom",
    });

    // The notification fires at start, so the Task is still running here — let it finish
    // (completion adds no second trigger), then compact.
    await waitFor(() => manager.statusOf("session-1") === "idle");
    expect(notified.length).toBe(1);
    await manager.startCompact("session-1");
    await waitFor(() => manager.statusOf("session-1") === "idle");
    await new Promise((r) => setTimeout(r, 10));
    expect(notified.length).toBe(1);
  });

  it("fires title generation at Task start, before any model output has streamed", async () => {
    const notified: { ctx: UsageContext; req: TitleRequest }[] = [];
    // Gate the run before its first yield: a notification while the gate is closed proves
    // generation starts without waiting on any model output.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const gatedRun: RuntimeSession = {
      sessionId: "session-1",
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok" as const,
      steer: () => false,
      skipReconnectWait: () => false,
      async *run() {
        await gate;
        yield assistantText("answer");
      },
      async *compact() {},
    };
    const manager = new SessionManager({
      sessions,
      channels,
      sources,
      loader: loaderOf(gatedRun),
      recorder: { record: async () => {} },
      titles: {
        maybeGenerate: (ctx, _session, req) => notified.push({ ctx, req }),
      },
      log: () => {},
    });

    await manager.startTask("session-1", [userText("long question")]);
    // The trigger fires while the run is still parked before its first message.
    await waitFor(() => notified.length === 1);
    expect(manager.statusOf("session-1")).toBe("running");
    expect(notified[0]!.req.fallbackText).toBe("long question");
    expect(notified[0]!.req.material).toEqual({ userText: "long question", assistantText: "" });

    // Completion adds no second trigger — the start is the only one.
    release();
    await waitFor(() => manager.statusOf("session-1") === "idle");
    await new Promise((r) => setTimeout(r, 10));
    expect(notified.length).toBe(1);
  });

  it("a subagent's title fires at registration (mid-run), from its spawning prompt alone", async () => {
    const notified: { ctx: UsageContext; req: TitleRequest }[] = [];
    const driven: OmniMessage[] = [];
    // Gate the run right after the sub-session's output: both notifications must already
    // be in by then, proving neither waited for the run to complete.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const delegating: RuntimeSession = {
      sessionId: "session-1",
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok" as const,
      steer: () => false,
      skipReconnectWait: () => false,
      async *run() {
        yield toolCall({
          name: "run_subagent",
          arguments: JSON.stringify({ prompt: "Research the background of this question" }),
          toolCallId: "sub-1",
        });
        const hop = "child-1";
        yield withOrigin(
          sessionMeta({
            session_id: "child-1",
            model_id: "m-child",
            provider: "custom",
            model_context_window: 1000,
            system_prompt: "sys",
            agent_state: "/root/p1/child_agent/agent_state",
            workspace: "/tmp/w-child",
          }),
          hop,
        );
        yield withOrigin(assistantText("z".repeat(3000)), hop);
        await gate;
        yield assistantText("short answer");
      },
      async *compact() {},
    };
    const manager = new SessionManager({
      sessions,
      channels,
      sources,
      loader: loaderOf(delegating),
      recorder: {
        record: async (_ctx, msg) => {
          driven.push(msg);
        },
      },
      titles: {
        maybeGenerate: (ctx, _session, req) => notified.push({ ctx, req }),
      },
      log: () => {},
    });

    await manager.startTask("session-1", [userText("delegate this")]);
    // By the time the sub-session's output has been driven through, both titles have
    // already fired: the parent's at Task start, the child's at registration.
    await waitFor(() => driven.length === 3);
    expect(manager.statusOf("session-1")).toBe("running");
    expect(notified.map((n) => n.ctx.sessionId)).toEqual(["session-1", "child-1"]);
    const child = notified[1]!;
    // The child's material is its spawning prompt alone — its own output is never waited for.
    expect(child.req.material).toEqual({
      userText: "Research the background of this question",
      assistantText: "",
    });
    expect(child.req.notifyOn).toBe("session-1");

    // Completion adds nothing further.
    release();
    await waitFor(() => manager.statusOf("session-1") === "idle");
    await new Promise((r) => setTimeout(r, 10));
    expect(notified.length).toBe(2);
  });
});
