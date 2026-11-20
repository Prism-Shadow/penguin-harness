/**
 * A compaction that hands files to the next context, on a real core Session against the loopback
 * model (live-session.ts, the one fake), driven by the SessionManager the way POST /compact
 * drives it.
 *
 * - Given an allow-all Session with a finished turn, when the user compacts and the model first
 *   writes a hand-off file into the Session's scratchpad and then replies with its summary: the
 *   file is on disk as the model wrote it, the session stream carries the round between the
 *   compaction events as the Trace has it, the round's request sends the tool result with the
 *   Agent's reminder behind it, and the next Task opens with the summary and one line naming
 *   the Trace file the compaction closed.
 * - Given an always-ask Session, the round's write waits for the user: an approval request is
 *   published for it, nothing is written before the answer, and the file is written once it is
 *   allowed.
 * - Given a model that writes outside the scratchpad while compacting, the write is refused
 *   before anything runs, and the model is told what it may do.
 *
 * On the whole app (the same loopback model; the real usage recorder, error watcher and routes):
 * - Given a model that refuses the compaction request (HTTP 400) mid-Task, the Task still reaches
 *   its end: the compaction completes with the error pair, the next Trace file opens with the
 *   harness's hand-off note naming the file it closed, and the errors panel holds one expected
 *   `context_refused` row — no `compaction_failed`, no LLM row.
 * - Given a model that refuses an ordinary request (HTTP 400) mid-Task, the Task carries on: the
 *   refused request is a retried attempt, the span after it holds no request, the next Trace file
 *   opens with the hand-off note quoting the provider's error, the turn is sent again behind it,
 *   and the errors panel holds one `context_refused` row and one `llm_retried` row, no
 *   `llm_fatal`.
 * - Given an Agent config broken before a model switch, the target's context cannot be opened:
 *   the switch ends `fatal`, the Session keeps its model and its context, one `compaction_failed`
 *   row is recorded, and the Session is idle and runs its next Task on the model it was on.
 *
 * A model switch away from a model that can no longer be used (issue #1557), the target working:
 * - Given the model being left refuses the summary request (HTTP 401, 403), the switch still
 *   lands on the target: the compaction ends `completed` with the provider's error, the file left
 *   keeps every record it had, the target's file opens with the `[model_switch_from]` block naming
 *   it, the row moves, one expected `compaction_degraded` row is recorded, and the Session is idle
 *   and runs its next Task on the target, which opens with that block.
 * - Given the model being left was removed from the Project config, or its key deleted, it is sent
 *   nothing: no compaction pair, the file left untouched, the target's file opens with the block,
 *   and the next Task runs on the target.
 * - Given a compaction on a model that refuses it, the context is handed off in place; a switch
 *   after it sends that model nothing more and the target opens with the hand-off note.
 * - Given a switch the user stops while the model being left is still answering, the Session
 *   keeps its model and goes idle; the next attempt, refused by that model, lands on the target.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildContextSummaryText, parseModelSwitchMessage } from "@prismshadow/amsp/markers";
import { wire } from "@prismshadow/penguin-core/kernel";
import type { DatabaseSync } from "node:sqlite";
import {
  createAgent,
  parseTraceLines,
  saveProjectConfig,
  sessionScratchpadDir,
  systemConfigPath,
  tracesDir,
  userText,
} from "@prismshadow/penguin-core";
import type { AmspRecord } from "@prismshadow/penguin-core";
import type {
  ModelRefDto,
  ProjectCreateResponse,
  SessionCreateResponse,
} from "../src/api/types.js";
import { openDatabase } from "@prismshadow/penguin-library-db";
import { SessionsRepo } from "@prismshadow/penguin-library-session/repos/sessions";
import type { SessionRow } from "@prismshadow/penguin-library-session/repos/sessions";
import { ChannelHub } from "../src/runtime/channel.js";
import type { ChannelEvent } from "../src/runtime/channel.js";
import { SessionManager, createCoreSessionLoader } from "../src/runtime/session-manager.js";
import { SessionSources } from "../src/runtime/session-sources.js";
import { apiClient, createTestApp, makeTempRoot, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { MOCK_MODEL_ID, requestText, startMockLLM, userTexts } from "./live-session.js";
import type { MockLLM, MockReply } from "./live-session.js";

const PROJECT = "p1";
const AGENT = "handoff_agent";

/** The record's payload type, or `session_meta`. */
const kindOf = (r: AmspRecord): string =>
  r.type === "session_meta" ? "session_meta" : ((r.payload as { type?: string }).type ?? r.type);

/** The records of a span: between the stream's compaction_begin and its compaction_end. */
function span(records: AmspRecord[]): AmspRecord[] {
  const kinds = records.map(kindOf);
  return records.slice(kinds.indexOf("compaction_begin") + 1, kinds.indexOf("compaction_end"));
}

/** The scratchpad directory the compaction Prompt names, read off the request as a model would. */
function scratchpadNamedIn(request: { messages?: unknown[] }): string {
  const m = /files under (.+?)\/handoff\//.exec(requestText(request));
  if (!m) throw new Error("the compaction request names no scratchpad");
  return m[1]!;
}

/** The last `compaction_end` among `records`, as its payload. */
function lastCompactionEnd(records: AmspRecord[]): Record<string, unknown> | undefined {
  return records.filter((r) => kindOf(r) === "compaction_end").at(-1)?.payload as
    Record<string, unknown> | undefined;
}

/** The `[context_summary]` block a context opens with, among a Trace file's user texts. */
function openingOf(records: AmspRecord[]): string | undefined {
  return userTexts(records)
    .map((u) => u.text)
    .find((text) => text.startsWith("[context_summary]"));
}

describe("a compaction that hands files to the next context", { timeout: 30_000 }, () => {
  let root: string;
  let mock: MockLLM;
  let db: DatabaseSync;
  let channels: ChannelHub;
  let manager: SessionManager;
  let sessionId: string;
  let events: ChannelEvent[];
  /** What the model answers the compaction request with, given the scratchpad it was told. */
  let compactionReply: (scratchpad: string) => MockReply;

  async function open(approvalMode: SessionRow["approvalMode"]): Promise<void> {
    const agent = await createAgent({ root, projectId: PROJECT, agentId: AGENT });
    const workspace = path.join(root, "workspace");
    await fs.mkdir(workspace);
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
      approvalMode,
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
  }

  beforeEach(async () => {
    root = await makeTempRoot();
    // Request 1 answers the Task, 2 is the compaction's first request, 3 its next, 4 the Task
    // after it.
    mock = await startMockLLM((n) => {
      if (n === 2) return compactionReply(scratchpadNamedIn(mock.requests[1]!));
      if (n === 3) return "[summary]\n## Next steps\nTag v1 as the plan says.\n[/summary]";
      return `reply ${n}`;
    });
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
  });
  afterEach(async () => {
    await manager.shutdown();
    channels.dispose();
    db.close();
    await mock.close();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const idle = () => waitFor(() => manager.statusOf(sessionId) === "idle", 20_000);
  const published = (): AmspRecord[] =>
    events.filter((e) => e.event === undefined).map((e) => JSON.parse(e.data) as AmspRecord);
  const serverEvents = () =>
    events
      .filter((e) => e.event === "server_event")
      .map((e) => JSON.parse(e.data) as { type: string; [k: string]: unknown });
  const writePlan = (scratchpad: string): MockReply => ({
    toolUse: {
      id: "toolu_h1",
      name: "write_file",
      input: { file_path: `${scratchpad}/handoff/plan.md`, content: "1. Tag v1.\n2. Ship." },
    },
  });
  const planFile = () =>
    path.join(sessionScratchpadDir(root, PROJECT, AGENT, sessionId), "handoff", "plan.md");

  it("writes the hand-off file, streams the round, sends its result with the reminder behind it, and the next Task opens with the summary and the closed Trace file's path", async () => {
    compactionReply = writePlan;
    await open("allow-all");
    await manager.startTask(sessionId, [userText("plan the release")]);
    await idle();
    await manager.startCompact(sessionId);
    await idle();

    expect(await fs.readFile(planFile(), "utf8")).toBe("1. Tag v1.\n2. Ship.");
    // The round as the Trace has it; the fragments around the records stream too.
    expect(
      span(published())
        .map(kindOf)
        .filter((k) => !k.startsWith("partial_")),
    ).toEqual([
      "request_begin",
      "tool_call",
      "token_usage",
      "request_end",
      "approval_decision",
      "tool_call_output",
      "request_begin",
      "token_usage",
      "request_end",
    ]);
    // The round's request appends one user turn: the tool result, then the Agent's reminder —
    // nothing else, so the cached prefix is extended, not changed.
    const roundRequest = mock.requests[2]! as { messages: { role: string; content: unknown }[] };
    const last = roundRequest.messages.at(-1)!;
    expect(last.role).toBe("user");
    expect((last.content as { type: string }[]).map((b) => b.type)).toEqual([
      "tool_result",
      "text",
    ]);

    await manager.startTask(sessionId, [userText("go on")]);
    await idle();
    // The next context opens with the summary and the path of the file the compaction closed,
    // and nothing else of the harness's: the write is in that file, not listed here.
    const day = (await fs.readdir(tracesDir(root, PROJECT, AGENT)))[0]!;
    const closed = path.join(tracesDir(root, PROJECT, AGENT), day, `${sessionId}_001.jsonl`);
    const opening = buildContextSummaryText("## Next steps\nTag v1 as the plan says.", closed);
    expect(requestText(mock.requests[3]!)).toContain(`"text":${JSON.stringify(opening)}`);
  });

  it("under always-ask the round's write waits for the user, and lands once allowed", async () => {
    compactionReply = writePlan;
    await open("always-ask");
    await manager.startTask(sessionId, [userText("plan the release")]);
    await idle();
    await manager.startCompact(sessionId);

    await waitFor(() => serverEvents().some((e) => e.type === "approval_request"), 20_000);
    const request = serverEvents().find((e) => e.type === "approval_request")!;
    expect((request.toolCall as AmspRecord).payload).toMatchObject({
      name: "write_file",
      tool_call_id: "toolu_h1",
    });
    expect(manager.statusOf(sessionId)).toBe("compacting");
    await expect(fs.access(planFile())).rejects.toThrow();

    expect(manager.decideApproval(sessionId, "toolu_h1", "allow")).toBe(true);
    await idle();
    expect(await fs.readFile(planFile(), "utf8")).toBe("1. Tag v1.\n2. Ship.");
    expect(span(published()).map(kindOf)).toContain("tool_call_output");
  });

  it("refuses a write outside the scratchpad before anything runs, and tells the model what it may do", async () => {
    const outside = () => path.join(root, "workspace", "notes.md");
    compactionReply = () => ({
      toolUse: {
        id: "toolu_x1",
        name: "write_file",
        input: { file_path: outside(), content: "x" },
      },
    });
    await open("allow-all");
    await manager.startTask(sessionId, [userText("plan the release")]);
    await idle();
    await manager.startCompact(sessionId);
    await idle();

    await expect(fs.access(outside())).rejects.toThrow();
    // Refused by the gate: no approval was asked for, and the result says what is allowed.
    expect(span(published()).map(kindOf)).not.toContain("approval_decision");
    expect(requestText(mock.requests[2]!)).toContain(
      "only read_file, and write_file/edit_file inside this Session's scratchpad, are available while compacting",
    );
  });
});

describe("a compaction's outcome on the whole app", { timeout: 30_000 }, () => {
  const AGENT_ID = "default_agent";
  /** A second model on the same loopback endpoint: what a switch moves to. */
  const TARGET_MODEL_ID = "claude-switch-target";
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let mock: MockLLM;
  let projectId: string;
  let workspace: string;
  /** What the n-th request of the test is answered with. */
  let script: (n: number) => MockReply;
  /** What the n-th request waits for after its first event, if anything. */
  let hold: (n: number) => Promise<void> | undefined;
  /** The model the Session starts on, and the one a switch moves it to. */
  const SOURCE: ModelRefDto = { provider: "custom", modelId: MOCK_MODEL_ID };
  const TARGET: ModelRefDto = { provider: "custom", modelId: TARGET_MODEL_ID };
  /** A model entry on the loopback endpoint, with its key. */
  const entry = (modelId: string) => ({
    provider: "custom",
    modelId,
    clientType: "ant-messages",
    apiKey: "sk-mock",
    baseUrl: mock.url,
    contextWindow: 200_000,
  });

  beforeEach(async () => {
    script = (n) => `reply ${n}`;
    hold = () => undefined;
    mock = await startMockLLM(
      (n) => script(n),
      (n) => hold(n),
    );
    t = await createTestApp({ titles: { maybeGenerate: () => {} } });
    api = apiClient(t.app, (await provisionUser(t.app, "compactor")).cookie);
    const created = (await (
      await api.post("/api/projects", { projectId: "compactor-outcomes", name: "Outcomes" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    const models = await api.put(`/api/projects/${projectId}/models`, {
      defaultModel: SOURCE,
      models: [entry(MOCK_MODEL_ID), entry(TARGET_MODEL_ID)],
    });
    expect(models.status, await models.text()).toBe(200);
    workspace = path.join(t.root, "outcomes-workspace");
    await fs.mkdir(workspace, { recursive: true });
  });
  afterEach(async () => {
    await t.deps.manager.shutdown();
    await t.cleanup();
    await mock.close();
  });

  /** An allow-all Session on the Project's default model, in the suite's Workspace. */
  async function openSession(): Promise<string> {
    const res = await api.post(`/api/projects/${projectId}/agents/${AGENT_ID}/sessions`, {
      approvalMode: "allow-all",
      workspace,
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as SessionCreateResponse).session.sessionId;
  }
  const idle = (sessionId: string) =>
    waitFor(() => t.deps.manager.statusOf(sessionId) === "idle", 20_000);
  /** Runs one Task to its end. */
  async function runTask(sessionId: string, text: string): Promise<void> {
    const res = await api.post(`/api/sessions/${sessionId}/tasks`, {
      input: [{ type: "text", text }],
    });
    expect(res.status).toBe(202);
    await idle(sessionId);
  }
  /** The records a Session's channel publishes from now on, as an SSE client reads them. */
  const listen = (sessionId: string): (() => AmspRecord[]) => {
    const records: AmspRecord[] = [];
    t.deps.channels.get(sessionId).subscribe((e) => {
      if (e.event === undefined) records.push(JSON.parse(e.data) as AmspRecord);
    });
    return () => records;
  };
  /** A Session's Trace files, oldest first: each one's path and records. */
  async function traceFiles(
    sessionId: string,
  ): Promise<Array<{ path: string; records: AmspRecord[] }>> {
    const dir = tracesDir(t.root, projectId, AGENT_ID);
    const files: Array<{ path: string; records: AmspRecord[] }> = [];
    for (const day of (await fs.readdir(dir)).sort()) {
      const names = (await fs.readdir(path.join(dir, day)))
        .filter((name) => name.startsWith(`${sessionId}_`) && name.endsWith(".jsonl"))
        .sort();
      for (const name of names) {
        const file = path.join(dir, day, name);
        files.push({ path: file, records: parseTraceLines(await fs.readFile(file, "utf8")) });
      }
    }
    return files;
  }
  /** The model each billed request was attributed to, in billing order. */
  const billed = (): string[] =>
    (
      t.deps.db.prepare("SELECT model_id FROM usage_records ORDER BY id").all() as {
        model_id: string;
      }[]
    ).map((r) => r.model_id);
  /** The Project's errors panel: each row's source, code, kind and how many records it stands for. */
  const errorRows = () =>
    t.deps.errorsRepo.recent(projectId).map((r) => [r.source, r.code, r.kind, r.count]);
  /** Asks for a switch to the target; it streams (202), and the Session is idle once it ends. */
  async function switchToTarget(sessionId: string): Promise<void> {
    const res = await api.post(`/api/sessions/${sessionId}/switch-model`, TARGET);
    expect(res.status, await res.text()).toBe(202);
    await idle(sessionId);
  }
  /** The model a Trace file's `session_meta` names. */
  const modelOf = (records: AmspRecord[]): ModelRefDto => {
    const meta = records.find((r) => r.type === "session_meta")!.payload as {
      provider: string;
      model_id: string;
    };
    return { provider: meta.provider, modelId: meta.model_id };
  };
  /** The in-place `[model_switch_from]` block among a Trace file's user texts, parsed, and its text. */
  function switchHandoffOf(records: AmspRecord[]) {
    for (const { text } of userTexts(records)) {
      const origin = parseModelSwitchMessage(text);
      if (origin) return { origin, text };
    }
    return undefined;
  }

  it("a model that refuses the compaction request: the Task still reaches its end on a next context that opens with a hand-off note naming the file it closed, and the errors panel holds one expected context_refused row", async () => {
    const notes = path.join(workspace, "notes.md");
    await fs.writeFile(notes, "Tag v1, then ship.");
    // Every second completed turn closes the context: the Task's second tool call puts the
    // compaction mid-Task.
    const config = await api.put(`/api/projects/${projectId}/agents/${AGENT_ID}/config`, {
      config: { compaction: { maxSessionTurns: 2 } },
    });
    expect(config.status, await config.text()).toBe(200);
    script = (n) => {
      if (n <= 2) {
        return { toolUse: { id: `toolu_r${n}`, name: "read_file", input: { file_path: notes } } };
      }
      if (n === 3) return { refuse: { message: "prompt is too long: 201000 tokens > 200000" } };
      return "Tagged.";
    };
    const sessionId = await openSession();
    await runTask(sessionId, "tag the release");

    // The Task's two requests, the refused compaction request, and the Task's next request — on
    // the new context, which holds the note and nothing of the old one.
    expect(mock.requests).toHaveLength(4);
    const files = await traceFiles(sessionId);
    expect(files).toHaveLength(2);
    const end = lastCompactionEnd(files[0]!.records)!;
    expect(end).toMatchObject({ status: "completed", attempt: 1, error_code: "rejected" });
    expect(end.error_message).toContain("prompt is too long");
    const note = openingOf(files[1]!.records)!;
    expect(note).toContain(files[0]!.path);
    const next = mock.requests[3]!;
    expect(next.messages).toHaveLength(1);
    expect(requestText(next)).toContain(JSON.stringify(note).slice(1, -1));
    // The Task ended there, on the model's reply.
    expect(files[1]!.records.map(kindOf)).toContain("task_end");
    expect(
      files[1]!.records.some(
        (r) => kindOf(r) === "text" && (r.payload as { text?: string }).text === "Tagged.",
      ),
    ).toBe(true);
    // Nobody has to step in: one expected row says what to correct, and the refused request
    // adds no LLM row of its own.
    expect(errorRows()).toEqual([["compaction", "context_refused", "expected", 1]]);
  });

  it("a model that refuses an ordinary request mid-Task: the Task carries on in a new Trace file opened by the note quoting the provider's error, with one context_refused row and no llm_fatal", async () => {
    const notes = path.join(workspace, "notes.md");
    await fs.writeFile(notes, "Tag v1, then ship.");
    const refusal = "prompt is too long: 201000 tokens > 200000";
    script = (n) => {
      if (n === 1)
        return { toolUse: { id: "toolu_r1", name: "read_file", input: { file_path: notes } } };
      if (n === 2) return { refuse: { message: refusal } };
      return "Tagged.";
    };
    const sessionId = await openSession();
    await runTask(sessionId, "tag the release");

    // The turn that read the file, the refused request, and the same turn sent again on the new
    // context — no compaction request in between.
    expect(mock.requests).toHaveLength(3);
    const files = await traceFiles(sessionId);
    expect(files).toHaveLength(2);
    const closed = files[0]!.records;
    const kinds = closed.map(kindOf);
    const begin = kinds.indexOf("compaction_begin");
    // The refused request is a retried attempt, and the span after it holds no request.
    expect(
      closed
        .slice(0, begin)
        .filter((r) => kindOf(r) === "request_end")
        .at(-1)!.payload,
    ).toMatchObject({
      status: "retryable",
      error_code: "rejected",
      retry_in_ms: 0,
    });
    expect(kinds.slice(begin + 1, kinds.indexOf("compaction_end"))).toEqual([]);
    const end = lastCompactionEnd(closed)!;
    expect(end).toMatchObject({ status: "completed", error_code: "rejected" });
    expect(end).not.toHaveProperty("attempt");
    // The note names the file it closed and quotes the provider's words; the resend carries it
    // and nothing of the old context.
    const note = openingOf(files[1]!.records)!;
    expect(note).toContain(files[0]!.path);
    expect(note).toContain(refusal);
    const next = mock.requests[2]!;
    expect(next.messages).toHaveLength(1);
    expect(requestText(next)).toContain(JSON.stringify(note).slice(1, -1));
    // The Task ended there, on the model's reply.
    expect(files[1]!.records.map(kindOf)).toContain("task_end");
    expect(
      files[1]!.records.some(
        (r) => kindOf(r) === "text" && (r.payload as { text?: string }).text === "Tagged.",
      ),
    ).toBe(true);
    expect(errorRows().sort()).toEqual([
      ["compaction", "context_refused", "expected", 1],
      ["llm", "llm_retried", "expected", 1],
    ]);
  });

  it("a switch whose target context cannot be opened — the Agent's config broken meanwhile — ends fatal: the model and the context are kept, one compaction_failed row, and the Session runs its next Task on the model it was on", async () => {
    script = (n) =>
      n === 2 ? "[summary]\n## Next steps\nCarry on with the release.\n[/summary]" : `reply ${n}`;
    const sessionId = await openSession();
    await runTask(sessionId, "plan the release");
    // An edit that leaves the Agent's config unreadable: the target's context cannot be assembled.
    await fs.writeFile(systemConfigPath(t.root, projectId, AGENT_ID), "");
    const feed = listen(sessionId);
    const switched = await api.post(`/api/sessions/${sessionId}/switch-model`, {
      provider: "custom",
      modelId: TARGET_MODEL_ID,
    });
    expect(switched.status).toBe(202);
    await idle(sessionId);

    // The summary was asked of the model being left; the target was sent nothing.
    expect(mock.requests.map((r) => r.model)).toEqual([MOCK_MODEL_ID, MOCK_MODEL_ID]);
    const end = lastCompactionEnd(feed())!;
    expect(end).toMatchObject({ status: "fatal" });
    expect(end.error_message).toContain("Invalid Agent State config");
    // No next context: no session_meta streamed, no new Trace file, the row where it was.
    expect(feed().map(kindOf)).not.toContain("session_meta");
    expect(await traceFiles(sessionId)).toHaveLength(1);
    expect(t.deps.sessionsRepo.findById(sessionId)).toMatchObject({
      provider: "custom",
      modelId: MOCK_MODEL_ID,
    });
    expect(errorRows()).toEqual([["compaction", "compaction_failed", "unexpected", 1]]);

    // Idle and usable: the next Task runs on the context it kept, on the model it was on.
    await runTask(sessionId, "still there?");
    expect(mock.requests).toHaveLength(3);
    expect(mock.requests[2]!.model).toBe(MOCK_MODEL_ID);
    expect(requestText(mock.requests[2]!)).toContain("plan the release");
    expect(requestText(mock.requests[2]!)).toContain("still there?");
    expect(billed()).toEqual([MOCK_MODEL_ID, MOCK_MODEL_ID, MOCK_MODEL_ID]);
  });

  describe("a model switch away from a model that can no longer be used (issue #1557)", () => {
    const DENIED = "this organization may not use the model";
    /**
     * The model being left answers the Task's first request and refuses every later one with
     * `refusal`; the target answers.
     */
    const leftRefuses =
      (refusal: MockReply) =>
      (n: number): MockReply => {
        if (mock.requests[n - 1]!.model === TARGET_MODEL_ID) return `on the target ${n}`;
        return n === 1 ? "planned" : refusal;
      };

    it.each([
      { status: 401, code: "auth", message: "invalid x-api-key" },
      { status: 403, code: "denied", message: DENIED },
    ])(
      "the model being left refuses the summary request (HTTP $status): the switch lands on the target by Trace hand-off, the file left keeps its records, and the next Task runs on the target",
      async ({ status, code, message }) => {
        script = leftRefuses({ refuse: { message, status } });
        const sessionId = await openSession();
        await runTask(sessionId, "plan the release");
        const [left] = await traceFiles(sessionId);
        const feed = listen(sessionId);

        await switchToTarget(sessionId);

        // One summary request, to the model being left, refused; the target was sent nothing.
        expect(mock.requests.map((r) => r.model)).toEqual([MOCK_MODEL_ID, MOCK_MODEL_ID]);
        expect(lastCompactionEnd(feed())).toMatchObject({
          reason: "manual",
          status: "completed",
          error_code: code,
        });
        // The file left keeps every record it had, closed by the pair.
        const files = await traceFiles(sessionId);
        expect(files).toHaveLength(2);
        expect(files[0]!.path).toBe(left!.path);
        expect(files[0]!.records.slice(0, left!.records.length)).toEqual(left!.records);
        expect(lastCompactionEnd(files[0]!.records)).toMatchObject({
          status: "completed",
          error_code: code,
        });
        // The target's file opens on the target with the block naming the file left; the stream
        // ends with that file's meta and the block, and the row has moved.
        expect(modelOf(files[1]!.records)).toEqual(TARGET);
        const handoff = switchHandoffOf(files[1]!.records)!;
        expect(handoff.origin).toMatchObject({
          sessionId,
          tracePath: left!.path,
          prevProvider: SOURCE.provider,
          prevModelId: SOURCE.modelId,
        });
        expect(feed().map(kindOf).slice(-2)).toEqual(["session_meta", "text"]);
        expect(t.deps.sessionsRepo.findById(sessionId)).toMatchObject(TARGET);
        expect(errorRows()).toEqual([["compaction", "compaction_degraded", "expected", 1]]);

        // Idle and usable: the next Task runs on the target, opening with the block and carrying
        // nothing else of the old context.
        await runTask(sessionId, "carry on");
        const next = mock.requests[2]!;
        expect(next.model).toBe(TARGET_MODEL_ID);
        expect(requestText(next)).toContain(JSON.stringify(handoff.text).slice(1, -1));
        expect(requestText(next)).toContain("carry on");
        expect(requestText(next)).not.toContain("plan the release");
      },
    );

    it.each([
      {
        change: "removed from the Project config",
        defaultModel: TARGET,
        models: () => [entry(TARGET_MODEL_ID)],
      },
      {
        change: "left without its key",
        defaultModel: SOURCE,
        // No key sent (an undefined field leaves the body), and the stored one cleared.
        models: () => [
          { ...entry(MOCK_MODEL_ID), apiKey: undefined, clearApiKey: true },
          entry(TARGET_MODEL_ID),
        ],
      },
    ])(
      "a model $change is sent nothing: no compaction pair, the file left untouched, the target's file opens with the block, and the next Task runs on the target",
      async ({ defaultModel, models }) => {
        const sessionId = await openSession();
        await runTask(sessionId, "plan the release");
        const [left] = await traceFiles(sessionId);
        const put = await api.put(`/api/projects/${projectId}/models`, {
          defaultModel,
          models: models(),
        });
        expect(put.status, await put.text()).toBe(200);
        const feed = listen(sessionId);

        await switchToTarget(sessionId);

        expect(mock.requests.map((r) => r.model)).toEqual([MOCK_MODEL_ID]);
        expect(feed().map(kindOf)).not.toContain("compaction_begin");
        expect(feed().map(kindOf).slice(-2)).toEqual(["session_meta", "text"]);
        const files = await traceFiles(sessionId);
        expect(files).toHaveLength(2);
        expect(files[0]).toEqual(left);
        expect(modelOf(files[1]!.records)).toEqual(TARGET);
        const handoff = switchHandoffOf(files[1]!.records)!;
        expect(handoff.origin).toMatchObject({
          sessionId,
          tracePath: left!.path,
          prevModelId: SOURCE.modelId,
        });
        expect(t.deps.sessionsRepo.findById(sessionId)).toMatchObject(TARGET);

        await runTask(sessionId, "carry on");
        expect(mock.requests[1]!.model).toBe(TARGET_MODEL_ID);
        expect(requestText(mock.requests[1]!)).toContain(JSON.stringify(handoff.text).slice(1, -1));
      },
    );

    it("a compaction on a model that refuses it hands the context off in place, and a switch after it sends that model nothing more: the target opens with the hand-off note", async () => {
      script = leftRefuses({ refuse: { message: DENIED, status: 403 } });
      const sessionId = await openSession();
      await runTask(sessionId, "plan the release");
      const compacted = await api.post(`/api/sessions/${sessionId}/compact`);
      expect(compacted.status).toBe(202);
      await idle(sessionId);
      const [left] = await traceFiles(sessionId);
      expect(lastCompactionEnd(left!.records)).toMatchObject({
        status: "completed",
        error_code: "denied",
      });
      const feed = listen(sessionId);

      await switchToTarget(sessionId);

      // The refused compaction request is the last one the model being left was sent.
      expect(mock.requests.map((r) => r.model)).toEqual([MOCK_MODEL_ID, MOCK_MODEL_ID]);
      expect(feed().map(kindOf)).not.toContain("compaction_begin");
      const files = await traceFiles(sessionId);
      expect(files).toHaveLength(2);
      expect(files[0]).toEqual(left);
      expect(modelOf(files[1]!.records)).toEqual(TARGET);
      const note = openingOf(files[1]!.records)!;
      expect(note).toContain(left!.path);
      expect(t.deps.sessionsRepo.findById(sessionId)).toMatchObject(TARGET);

      await runTask(sessionId, "carry on");
      expect(mock.requests[2]!.model).toBe(TARGET_MODEL_ID);
      expect(requestText(mock.requests[2]!)).toContain(JSON.stringify(note).slice(1, -1));
    });

    it("a switch the user stops while the model being left is still answering keeps that model and goes idle; the next attempt, refused by that model, lands on the target", async () => {
      let release: () => void = () => {};
      const answering = new Promise<void>((resolve) => {
        release = resolve;
      });
      hold = (n) => (n === 2 ? answering : undefined);
      const refused = leftRefuses({ refuse: { message: DENIED, status: 403 } });
      script = (n) => (n === 2 ? "[summary]\nNever delivered.\n[/summary]" : refused(n));
      const sessionId = await openSession();
      await runTask(sessionId, "plan the release");
      const feed = listen(sessionId);

      const first = await api.post(`/api/sessions/${sessionId}/switch-model`, TARGET);
      expect(first.status).toBe(202);
      await waitFor(
        () => mock.requests.length === 2 && t.deps.manager.statusOf(sessionId) === "compacting",
        20_000,
      );
      expect((await api.post(`/api/sessions/${sessionId}/abort`)).status).toBe(202);
      await idle(sessionId);
      release();

      expect(lastCompactionEnd(feed())).toMatchObject({ status: "aborted" });
      expect(feed().map(kindOf)).not.toContain("session_meta");
      expect(await traceFiles(sessionId)).toHaveLength(1);
      expect(t.deps.sessionsRepo.findById(sessionId)).toMatchObject(SOURCE);

      await switchToTarget(sessionId);

      expect(mock.requests.map((r) => r.model)).toEqual([
        MOCK_MODEL_ID,
        MOCK_MODEL_ID,
        MOCK_MODEL_ID,
      ]);
      expect(lastCompactionEnd(feed())).toMatchObject({
        status: "completed",
        error_code: "denied",
      });
      const files = await traceFiles(sessionId);
      expect(files).toHaveLength(2);
      expect(modelOf(files[1]!.records)).toEqual(TARGET);
      expect(switchHandoffOf(files[1]!.records)?.origin).toMatchObject({
        sessionId,
        tracePath: files[0]!.path,
      });
      expect(t.deps.sessionsRepo.findById(sessionId)).toMatchObject(TARGET);

      await runTask(sessionId, "carry on");
      expect(mock.requests[3]!.model).toBe(TARGET_MODEL_ID);
    });
  });
});
