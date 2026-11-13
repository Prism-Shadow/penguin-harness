/**
 * AMSP on the wire: the real Hono app and the real SessionManager running core Sessions against a
 * loopback model (live-session.ts, the one fake), the bytes read by the SDK's own `readAmsp` and
 * `AgentClient`.
 *
 * Run streams:
 * - Given a Session's first message, the run stream is ping, session_meta, task_begin, the input,
 *   …, task_end, [DONE]: the session_meta once, ahead of task_begin and the input, naming the new
 *   Session, and not one of the Web App's server events.
 * - Given a second message on that Session, its run stream carries no session_meta.
 * - Given a run after a completed Task-boundary compaction, its stream carries the new context's
 *   session_meta once, after its task_begin and before its input, as the new Trace file has them.
 * - Given a model switch between two runs, the Session stream carries the new session_meta at
 *   switch time, and the next run stream none.
 * - Given a stop hook that continues once, one run stream holds two Task pairs.
 * - Given an always-ask Session, the SDK's approval loop finds the call through the approvals
 *   long-poll, `onApproval` allows it and the tool runs; with no callback the SDK answers deny.
 * - Given an abort mid-run, the stream still ends with [DONE] and the SDK reads `aborted`; given a
 *   caller that disconnects, the run is aborted.
 * - Given a drive that fails after its task_begin, the stream ends with [DONE] behind the unclosed
 *   task_begin, and the SDK reads `fatal` / `internal`.
 *
 * Session routes:
 * - Given `tasks` on an idle API Session, the run is accepted (202) and read on the Session
 *   stream; on a busy one it is 409 and nothing is queued.
 * - The key door's stream, messages, approvals, tasks and trace-image are refused like abort: a
 *   wrong key 401, a Web App Session's id 404.
 * - A windowed history page's image references point at the key door's own trace-image route,
 *   which answers the bytes.
 * - A `Last-Event-ID` the buffer no longer holds is refused 409 `resync_required` in JSON on both
 *   doors, header or query parameter, before any stream; an id it holds still resumes.
 * - The cookie door's `/amsp` and the key door's `/stream` write the same bytes for the same
 *   channel events, and neither writes a server event.
 * - The approvals resource refuses a `wait` that is not a number.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  hooksDir,
  imageUrlMessage,
  sessionMeta,
  taskBegin,
  userText,
} from "@prismshadow/penguin-core";
import { AgentClient, RunCollector, readAmsp } from "@prismshadow/amsp";
import type { AmspFrame, AmspRecord, RunResult } from "@prismshadow/amsp";
import type { AgentApiKeyCreateResponse, MessagesResponse } from "../src/api/types.js";
import { adoptSession, fakeSession, sessionRow, uniqueSessionId } from "./fixtures/session.js";
import { apiClient, createTestApp, loginAdmin, waitFor, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { MOCK_MODEL_ID, startMockLLM } from "./live-session.js";
import type { MockLLM, MockReply } from "./live-session.js";

const P = "default_project";
const A = "default_agent";
const PREFIX = "/api/amsp/v1";

type Admin = ReturnType<typeof apiClient>;

/** What a record is called in assertions: its payload type, or `session_meta`. */
const kindOf = (r: AmspRecord): string =>
  r.type === "session_meta" ? "session_meta" : ((r.payload as { type?: string }).type ?? r.type);

const recordsOf = (frames: AmspFrame[]): AmspRecord[] =>
  frames.flatMap((f) => (f.kind === "record" ? [f.record] : []));

/** The new Session a run stream names: its main session_meta's. */
function sessionOf(frames: AmspFrame[]): string {
  const meta = recordsOf(frames).find((r) => r.type === "session_meta" && !r.origin?.length);
  if (meta === undefined) throw new Error("no session_meta");
  return (meta.payload as { session_id: string }).session_id;
}

/** A run's frames, to the end of the body, and its raw text. */
async function readAll(res: Response): Promise<{ frames: AmspFrame[]; text: string }> {
  const text = await res.text();
  const frames: AmspFrame[] = [];
  const body = new Response(text).body!;
  for await (const f of readAmsp(body)) frames.push(f);
  return { frames, text };
}

/** The run's result, as the SDK folds it; `sessionId` is the Session a run continued. */
function resultOf(frames: AmspFrame[], sessionId?: string): RunResult {
  const collector = new RunCollector(sessionId !== undefined ? { sessionId } : {});
  for (const r of recordsOf(frames)) collector.add(r);
  return collector.result();
}

/** A stream read frame by frame, for a body that stays open. */
function follow(res: Response) {
  const frames = readAmsp(res.body!);
  const seen: AmspFrame[] = [];
  return {
    seen,
    /** Reads until `match` holds for a frame; returns it. */
    async until(match: (f: AmspFrame) => boolean): Promise<AmspFrame> {
      for (;;) {
        const r = await frames.next();
        if (r.done) throw new Error("the stream ended first");
        seen.push(r.value);
        if (match(r.value)) return r.value;
      }
    },
    async close(): Promise<void> {
      await frames.return(undefined);
    },
  };
}

const isRecord = (kind: string) => (f: AmspFrame) =>
  f.kind === "record" && kindOf(f.record) === kind;

/** Every record of the Session's Trace files, file by file, in order. */
async function traceFiles(
  root: string,
  agentId: string,
  sessionId: string,
): Promise<AmspRecord[][]> {
  const dir = path.join(root, P, "agents", agentId, "traces");
  const files: string[] = [];
  for (const day of await fs.readdir(dir)) {
    for (const name of await fs.readdir(path.join(dir, day))) {
      if (name.startsWith(sessionId)) files.push(path.join(dir, day, name));
    }
  }
  files.sort();
  return Promise.all(
    files.map(async (f) =>
      (await fs.readFile(f, "utf8"))
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l) as AmspRecord),
    ),
  );
}

describe("AMSP on the wire", () => {
  let t: TestApp;
  let admin: Admin;
  let mock: MockLLM;
  const keys: Record<string, string> = {};
  /** The model's next answers; once empty, a plain text. */
  const replies: MockReply[] = [];
  /** Held answers: the n-th request waits for its promise. */
  const holds = new Map<number, Promise<void>>();

  /** A request to the key door. */
  const amsp = (agentKey: string | null, apiPath: string, init: RequestInit = {}) =>
    t.app.request(`${PREFIX}${apiPath}`, {
      ...init,
      headers: {
        ...(agentKey !== null ? { authorization: `Bearer ${agentKey}` } : {}),
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  const run = (agentId: string, body: object) =>
    amsp(keys[agentId]!, `/agents/${P}/${agentId}/runs`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  /** An SDK client of one Agent, its requests sent into the app. */
  const client = (agentId: string) =>
    new AgentClient({
      baseUrl: `http://localhost${PREFIX}`,
      agent: `${P}/${agentId}`,
      apiKey: keys[agentId]!,
      fetch: ((input: string | URL | Request, init?: RequestInit) =>
        t.app.request(String(input), init)) as typeof fetch,
    });

  async function expose(agentId: string, settings: object = {}): Promise<void> {
    const base = `/api/projects/${P}/agents/${agentId}/api`;
    expect((await admin.put(base, { enabled: true, ...settings })).status).toBe(200);
    const res = await admin.post(`${base}/keys`, { name: `${agentId} wire` });
    keys[agentId] = ((await res.json()) as AgentApiKeyCreateResponse).secret;
  }

  beforeAll(async () => {
    mock = await startMockLLM(
      (n) => replies.shift() ?? `reply ${n}`,
      (n) => holds.get(n),
    );
    t = await createTestApp({ titles: { maybeGenerate: () => {} } });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const entry = (modelId: string) => ({
      provider: "custom",
      modelId,
      clientType: "ant-messages",
      apiKey: "sk-mock",
      baseUrl: mock.url,
      contextWindow: 200_000,
    });
    const models = await admin.put(`/api/projects/${P}/models`, {
      defaultModel: { provider: "custom", modelId: MOCK_MODEL_ID },
      models: [entry(MOCK_MODEL_ID), entry("claude-switch-target")],
    });
    expect(models.status, await models.text()).toBe(200);
    await expose(A);
    // An Agent whose every Task ends on a compaction: its threshold is under one request's usage.
    expect(
      (await admin.post(`/api/projects/${P}/agents`, { agentId: "compact_agent" })).status,
    ).toBe(201);
    const config = await admin.put(`/api/projects/${P}/agents/compact_agent/config`, {
      config: { compaction: { maxContextLength: 40 } },
    });
    expect(config.status, await config.text()).toBe(200);
    await expose("compact_agent");
  });
  afterAll(async () => {
    await t.deps.manager.shutdown();
    await t.cleanup();
    await mock.close();
  });

  it("a first message streams ping, its session_meta once, task_begin, the input, and no server event", async () => {
    const res = await run(A, { input: "Say hello" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    const { frames, text } = await readAll(res);
    expect(frames[0]).toEqual({ kind: "control", control: { kind: "ping" } });
    expect(frames[1]).toMatchObject({ kind: "record", record: { type: "session_meta" } });
    expect(frames.at(-1)).toEqual({ kind: "done" });
    const kinds = recordsOf(frames).map(kindOf);
    expect(kinds.slice(0, 3)).toEqual(["session_meta", "task_begin", "text"]);
    expect(kinds.filter((k) => k === "session_meta")).toHaveLength(1);
    expect(kinds.at(-1)).toBe("task_end");
    expect((recordsOf(frames)[2]!.payload as { text: string }).text).toBe("Say hello");
    for (const internal of ["server_event", "task_state", "session_title"]) {
      expect(text).not.toContain(internal);
    }
    // Every record carries its id.
    expect(
      frames.filter((f) => f.kind === "record").every((f) => f.kind === "record" && f.id),
    ).toBe(true);
    const result = resultOf(frames);
    expect(result).toMatchObject({ status: "completed", requests: 1 });
    expect(result.text).toMatch(/^reply \d+$/);

    // The same Session's next message carries no session_meta.
    const next = await readAll(await run(A, { session_id: result.sessionId, input: "Again" }));
    expect(recordsOf(next.frames).map(kindOf)).not.toContain("session_meta");
    expect(recordsOf(next.frames).map(kindOf).slice(0, 2)).toEqual(["task_begin", "text"]);
  });

  it("after a completed compaction the next run streams the new session_meta once, after task_begin and before the input, as the new file has them", async () => {
    const first = await readAll(await run("compact_agent", { input: "Task one" }));
    const sessionId = sessionOf(first.frames);
    expect(recordsOf(first.frames).map(kindOf)).toContain("compaction_end");

    const second = await readAll(
      await run("compact_agent", { session_id: sessionId, input: "Task two" }),
    );
    const records = recordsOf(second.frames);
    expect(records.map(kindOf).slice(0, 3)).toEqual(["task_begin", "session_meta", "text"]);
    expect((records[2]!.payload as { text: string }).text).toBe("Task two");
    expect(records.map(kindOf).filter((k) => k === "session_meta")).toHaveLength(1);

    const files = await traceFiles(t.root, "compact_agent", sessionId);
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files[1]![0]).toEqual(records[1]);
    // The old file ends on the compaction, then the Task records: task_begin did not open the new one.
    expect(files[0]!.slice(-1).map((m) => (m.payload as { type?: string }).type)).toEqual([
      "task_begin",
    ]);
  });

  it("a model switch streams its session_meta on the Session stream at switch time, and the next run stream none", async () => {
    const first = await readAll(await run(A, { input: "Before the switch" }));
    const sessionId = sessionOf(first.frames);
    const live = follow(await amsp(keys[A]!, `/sessions/${sessionId}/stream`));
    await live.until((f) => f.kind === "control" && f.control.kind === "ping");
    const switched = await admin.post(`/api/sessions/${sessionId}/switch-model`, {
      provider: "custom",
      modelId: "claude-switch-target",
    });
    expect(switched.status).toBeLessThan(300);
    const meta = await live.until(isRecord("session_meta"));
    expect(meta.kind === "record" && (meta.record.payload as { model_id: string }).model_id).toBe(
      "claude-switch-target",
    );
    await live.close();
    await waitFor(() => t.deps.manager.statusOf(sessionId) === "idle");

    const after = await readAll(await run(A, { session_id: sessionId, input: "After" }));
    expect(recordsOf(after.frames).map(kindOf)).not.toContain("session_meta");
  });

  it("a stop hook that continues once gives one run stream two Task pairs", async () => {
    expect((await admin.post(`/api/projects/${P}/agents`, { agentId: "hook_agent" })).status).toBe(
      201,
    );
    const dir = path.join(hooksDir(t.root, P, "hook_agent"), "again");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "hooks.json"),
      `${JSON.stringify({ stop: [{ command: "again.mjs", timeout: 10 }] })}\n`,
    );
    // Continues the first time it is asked, and stops after: the marker file is its memory.
    await fs.writeFile(
      path.join(dir, "again.mjs"),
      [
        "import fs from 'node:fs';",
        "const marker = new URL('./asked', import.meta.url);",
        "process.stdin.resume();",
        "process.stdin.on('end', () => {",
        "  const first = !fs.existsSync(marker);",
        "  fs.writeFileSync(marker, 'x');",
        "  process.stdout.write(JSON.stringify(first ? { decision: 'continue', input: 'Once more' } : { decision: 'stop' }));",
        "});",
        "",
      ].join("\n"),
    );
    await expose("hook_agent");
    const { frames } = await readAll(await run("hook_agent", { input: "Start" }));
    const marks = recordsOf(frames)
      .map(kindOf)
      .filter((k) => k === "task_begin" || k === "task_end" || k === "hook");
    expect(marks).toEqual(["task_begin", "hook", "task_end", "task_begin", "hook", "task_end"]);
    expect(resultOf(frames).status).toBe("completed");
  });

  it("an always-ask approval goes through the approvals long-poll and onApproval, and the tool runs", async () => {
    const tab = `/api/projects/${P}/agents/${A}/api`;
    await admin.put(tab, { approvalMode: "always-ask" });
    try {
      replies.push(
        { toolUse: { id: "toolu_read_1", name: "read_file", input: { file_path: "notes.txt" } } },
        "Read it.",
      );
      const asked: string[] = [];
      const run1 = client(A).stream({
        input: "Read notes.txt",
        onApproval: (call) => {
          asked.push(call.name);
          return "allow";
        },
      });
      const records: AmspRecord[] = [];
      for await (const r of run1) records.push(r);
      const result = await run1.result();
      expect(result.status).toBe("completed");
      expect(asked).toEqual(["read_file"]);
      const decision = records.find((r) => kindOf(r) === "approval_decision");
      expect(decision?.payload).toMatchObject({ decision: "allow", tool_call_id: "toolu_read_1" });
      expect(records.map(kindOf)).toContain("tool_call_output");

      // Without a callback the SDK answers deny.
      replies.push(
        { toolUse: { id: "toolu_read_2", name: "read_file", input: { file_path: "notes.txt" } } },
        "Denied.",
      );
      const run2 = client(A).stream({ input: "Read it again", sessionId: result.sessionId });
      const again: AmspRecord[] = [];
      for await (const r of run2) again.push(r);
      expect(again.find((r) => kindOf(r) === "approval_decision")?.payload).toMatchObject({
        decision: "deny",
        tool_call_id: "toolu_read_2",
      });
    } finally {
      await admin.put(tab, { approvalMode: "allow-all" });
    }
  });

  it("an abort keeps the stream to [DONE] and reads aborted; a caller that disconnects aborts the run", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    holds.set(mock.requests.length + 1, held);
    const sdk = client(A);
    const running = sdk.stream({ input: "Take your time" });
    const sessionId = await running.session;
    await waitFor(() => t.deps.manager.statusOf(sessionId) === "running");
    expect(await sdk.abort(sessionId)).toBe(true);
    const result = await running.result();
    expect(result.status).toBe("aborted");
    release();

    let release2!: () => void;
    holds.set(mock.requests.length + 1, new Promise<void>((resolve) => (release2 = resolve)));
    const controller = new AbortController();
    const leaving = sdk.stream({ input: "And leave", sessionId, signal: controller.signal });
    await waitFor(() => t.deps.manager.statusOf(sessionId) === "running");
    controller.abort(new Error("gone"));
    await expect(leaving.result()).rejects.toThrow("gone");
    await waitFor(() => t.deps.manager.statusOf(sessionId) === "idle");
    release2();
    const files = (await traceFiles(t.root, A, sessionId)).flat();
    expect(files.filter((m) => (m.payload as { type?: string }).type === "abort")).toHaveLength(2);
  });

  it("a drive that fails after its task_begin ends with [DONE] behind the open task_begin, read as fatal internal", async () => {
    const sessionId = uniqueSessionId();
    adoptSession(
      t.deps,
      fakeSession(sessionId, {
        async *run() {
          yield taskBegin();
          throw new Error("the host fell over");
        },
      }),
      { projectId: P, agentId: A, client: "api" },
    );
    const { frames } = await readAll(await run(A, { session_id: sessionId, input: "hi" }));
    expect(frames.at(-1)).toEqual({ kind: "done" });
    expect(resultOf(frames, sessionId)).toMatchObject({
      status: "fatal",
      error: { code: "internal" },
    });
  });

  it("tasks runs on an idle API Session and is read on its stream; a busy Session is 409", async () => {
    const first = await readAll(await run(A, { input: "Open a Session" }));
    const sessionId = sessionOf(first.frames);
    const live = follow(await amsp(keys[A]!, `/sessions/${sessionId}/stream`));
    await live.until((f) => f.kind === "control" && f.control.kind === "ping");
    let release!: () => void;
    holds.set(mock.requests.length + 1, new Promise<void>((resolve) => (release = resolve)));
    const started = await amsp(keys[A]!, `/sessions/${sessionId}/tasks`, {
      method: "POST",
      body: JSON.stringify({ input: "Go on" }),
    });
    expect(started.status).toBe(202);
    expect(await started.json()).toEqual({ session_id: sessionId });
    const busy = await amsp(keys[A]!, `/sessions/${sessionId}/tasks`, {
      method: "POST",
      body: JSON.stringify({ input: "And this" }),
    });
    expect(busy.status).toBe(409);
    release();
    await live.until(isRecord("task_end"));
    await live.close();
    expect(recordsOf(live.seen).map(kindOf)).toContain("task_begin");
    expect(t.deps.manager.pendingFollowUpCount(sessionId)).toBe(0);
  });

  it("the key door's Session routes are refused like abort: a wrong key 401, a Web App Session 404", async () => {
    const web = uniqueSessionId();
    adoptSession(t.deps, fakeSession(web), { projectId: P, agentId: A, client: "web" });
    const api = uniqueSessionId();
    adoptSession(t.deps, fakeSession(api), { projectId: P, agentId: A, client: "api" });
    const routes: Array<[string, RequestInit]> = [
      ["stream", {}],
      ["messages", {}],
      ["approvals", {}],
      ["trace-image?file=1&ordinal=0", {}],
      ["tasks", { method: "POST", body: JSON.stringify({ input: "x" }) }],
      ["abort", { method: "POST" }],
    ];
    for (const [route, init] of routes) {
      expect((await amsp(keys[A]!, `/sessions/${web}/${route}`, init)).status).toBe(404);
      expect((await amsp("penguin_wrong", `/sessions/${api}/${route}`, init)).status).toBe(401);
    }
  });

  it("a history page's images point at the key door's own trace-image route, which answers the bytes", async () => {
    const sessionId = uniqueSessionId();
    t.deps.sessionsRepo.insert(sessionRow(sessionId, { projectId: P, agentId: A, client: "api" }));
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    await writeTraceFile(t.root, P, A, "2026-10-23", sessionId, 1, [
      sessionMeta({
        session_id: sessionId,
        provider: "custom",
        model_id: MOCK_MODEL_ID,
        model_context_window: 200_000,
        system_prompt: "sp",
        agent_state: "/tmp/a",
        workspace: "/tmp/w",
        source: "api",
      }),
      userText("look"),
      imageUrlMessage(`data:image/png;base64,${png}`),
    ]);
    const page = (await (
      await amsp(keys[A]!, `/sessions/${sessionId}/messages?tailLimit=5`)
    ).json()) as MessagesResponse;
    const image = page.messages.find((m) => (m.payload as { type?: string }).type === "image_url");
    const ref = (image!.payload as { image_url: string }).image_url;
    expect(ref).toBe(`${PREFIX}/sessions/${sessionId}/trace-image?file=1&ordinal=2`);
    const bytes = await amsp(keys[A]!, ref.slice(PREFIX.length));
    expect(bytes.status).toBe(200);
    expect(bytes.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await bytes.arrayBuffer()).toString("base64")).toBe(png);
  });

  it("a Last-Event-ID the buffer no longer holds is refused 409 resync_required on both doors, and one it holds resumes", async () => {
    const { frames } = await readAll(await run(A, { input: "Make a Session" }));
    const sessionId = sessionOf(frames);
    // An epoch this channel never had, as an id from before a restart reads.
    const stale = "gone-1";
    const key = await amsp(keys[A]!, `/sessions/${sessionId}/stream`, {
      headers: { "last-event-id": stale },
    });
    const cookie = await admin.get(`/api/sessions/${sessionId}/amsp?lastEventId=${stale}`);
    for (const res of [key, cookie]) {
      expect(res.status).toBe(409);
      expect(res.headers.get("content-type")).toMatch(/^application\/json/);
      expect(await res.json()).toMatchObject({ error: { code: "resync_required" } });
    }
    const held = frames.find((f) => f.kind === "record")!;
    const resumed = await amsp(keys[A]!, `/sessions/${sessionId}/stream`, {
      headers: { "last-event-id": held.kind === "record" ? held.id! : "" },
    });
    expect(resumed.status).toBe(200);
    expect(resumed.headers.get("content-type")).toMatch(/^text\/event-stream/);
    await resumed.body!.cancel();
  });

  it("the cookie door and the key door write the same bytes for the same channel events, and no server event", async () => {
    const { frames } = await readAll(await run(A, { input: "One more Session" }));
    const sessionId = sessionOf(frames);
    const open = async (res: Response) => {
      const reader = res.body!.getReader();
      let text = "";
      const readUntil = async (needle: string) => {
        while (!text.includes(needle))
          text += new TextDecoder().decode((await reader.read()).value);
      };
      await readUntil("event: ping");
      return { readUntil, text: () => text, close: () => reader.cancel() };
    };
    const key = await open(await amsp(keys[A]!, `/sessions/${sessionId}/stream`));
    const cookie = await open(await admin.get(`/api/sessions/${sessionId}/amsp`));
    const channel = t.deps.channels.get(sessionId);
    channel.publish({ type: "task_state", state: "running" }, "server_event");
    channel.publish(userText("published"));
    channel.publish(taskBegin());
    await key.readUntil('"task_begin"');
    await cookie.readUntil('"task_begin"');
    expect(cookie.text()).toBe(key.text());
    expect(key.text()).not.toContain("server_event");
    expect(key.text()).toContain("id: ");
    await key.close();
    await cookie.close();
  });

  it("the approvals resource refuses a wait that is not a number, and answers an empty list at once without one", async () => {
    const { frames } = await readAll(await run(A, { input: "Session for approvals" }));
    const sessionId = sessionOf(frames);
    expect((await amsp(keys[A]!, `/sessions/${sessionId}/approvals?wait=soon`)).status).toBe(400);
    const now = await amsp(keys[A]!, `/sessions/${sessionId}/approvals`);
    expect(await now.json()).toEqual({ approvals: [] });
  });
});
