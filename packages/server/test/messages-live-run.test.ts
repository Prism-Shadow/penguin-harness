/**
 * GET /api/sessions/:id/messages?live=run: the run form, for a client that shows a run under
 * way the way it was streamed (the CLI chat) without reconciling the stream against history.
 *
 * - Given a running Session, `messages` end before the run, and `live` carries the cursor, the
 *   status and the run so far: the opening task_begin, the input's echo, and each streamed
 *   fragment folded into one start with the joined content, then its stop and complete message.
 *   Full and tail reads alike — a window of the newest Task begins at the run's input, and holds
 *   none of the run either; the answer without `live=run` is the one the Web App reads.
 * - Given an idle Session, `live` is attached with nothing in `records`, and an input an aborted
 *   bootstrap still holds is offered as before.
 * - Given a busy Session whose input is held but not yet on the stream, the input is not offered
 *   with the history: it arrives once, as the run's first record.
 * - Given a run larger than the log holds, `omitted` says how many of its oldest records are
 *   gone, and the newest are kept.
 * - Given a run of several Tasks (a goal round, a stop-hook continue), a tail window that begins
 *   inside the run holds none of it.
 * - A `before` page ignores the run form.
 * - Given a run that begins while the history is being read, the read is cut at its first
 *   record, and the client finds the run on the stream after the cursor.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  approvalDecision,
  assistantText,
  partialText,
  partialToolCallOutput,
  requestBegin,
  requestEnd,
  taskBegin,
  taskEnd,
  toolCall,
  userText,
} from "@prismshadow/penguin-core";
import type { ApproveFn, AmspRecord } from "@prismshadow/penguin-core";
import type { MessagesResponse, SessionStatus } from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { Channel } from "../src/runtime/channel.js";
import { LiveTailTracker } from "../src/runtime/live-tail.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { sessionMessages } from "../src/services/session-history.js";
import type { SessionHistoryDeps } from "../src/services/session-history.js";
import { fakeSession, sessionRow, uniqueSessionId } from "./fixtures/session.js";
import { apiClient, createTestApp, provisionUser, waitFor, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "runreader-default_project";

/** One record as `kind:content`, for comparing record lists at a glance. */
const shape = (msg: AmspRecord): string => {
  const p = msg.payload as {
    type: string;
    event_type?: string;
    text?: string;
    output?: string;
  };
  const kind = p.event_type !== undefined ? `${p.type}/${p.event_type}` : p.type;
  const content = p.text ?? p.output;
  return content !== undefined ? `${kind}:${content}` : kind;
};

/** A Task that ran to its end before the run under test. */
const earlier = (): AmspRecord[] => [
  userText("earlier"),
  requestBegin(),
  assistantText("earlier answer"),
  requestEnd("completed"),
];

/** A record stamped `ms` from now: Task records carry nothing but their time to tell them apart. */
const at = <M extends AmspRecord>(msg: M, ms: number): M => ({
  ...msg,
  timestamp: new Date(Date.now() + ms).toISOString(),
});

describe("messages run form", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let SID: string;
  let row: SessionRow;

  beforeAll(async () => {
    t = await createTestApp();
    api = apiClient(t.app, (await provisionUser(t.app, "runreader")).cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });
  beforeEach(() => {
    SID = uniqueSessionId();
    row = sessionRow(SID, { projectId: PROJECT, approvalMode: "always-ask" });
    t.deps.sessionsRepo.insert(row);
  });

  const getMessages = async (query: string): Promise<MessagesResponse> => {
    const res = await api.get(`/api/sessions/${SID}/messages${query}`);
    expect(res.status).toBe(200);
    return (await res.json()) as MessagesResponse;
  };
  /** The Session's Trace as core leaves it: written before each record is yielded. */
  const writeTrace = (records: AmspRecord[]) =>
    writeTraceFile(t.root, row.projectId, row.agentId, "2026-11-07", SID, 1, records);
  const adopt = (run: RuntimeSession["run"]) =>
    t.deps.manager.adopt(row, fakeSession(SID, { run }));
  const finish = async (toolCallId: string) => {
    expect(t.deps.manager.decideApproval(SID, toolCallId, "deny")).toBe(true);
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  };

  it("while running: messages end before the run, and live carries the run so far with each fragment folded", async () => {
    const before = earlier();
    await writeTrace(before);
    adopt(async function* (input: AmspRecord[], opts: { approve: ApproveFn }) {
      const begin = taskBegin();
      const request = requestBegin();
      const answer = assistantText("Hello");
      const call = toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-run" });
      await writeTrace([...before, begin, ...input, request]);
      yield begin;
      yield request;
      yield partialText("start", "");
      yield partialText("delta", "Hel");
      yield partialText("delta", "lo");
      yield partialText("stop");
      await writeTrace([...before, begin, ...input, request, answer, call]);
      yield answer;
      yield call;
      yield partialToolCallOutput({ eventType: "start", toolCallId: "tc-run" });
      yield partialToolCallOutput({ eventType: "delta", output: "line 1\n", toolCallId: "tc-run" });
      yield approvalDecision(await opts.approve(call), "tc-run");
    });
    await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);

    const run = [
      "task_begin",
      "text:go",
      "request_begin",
      "partial_text/start:Hello",
      "partial_text/stop:",
      "text:Hello",
      "tool_call",
      "partial_tool_call_output/start:line 1\n",
    ];
    const full = await getMessages("?live=run");
    expect(full.messages.map(shape)).toEqual(before.map(shape));
    expect(full.live!.cursor).toMatch(/^[0-9a-f]{8}-\d+$/);
    expect(full.live!.status).toBe("running");
    expect(full.live!.records!.map(shape)).toEqual(run);
    expect(full.live!.fragments.map(shape)).toEqual(["partial_tool_call_output/start:line 1\n"]);
    expect(full.live!.omitted).toBeUndefined();

    const tail = await getMessages("?tailLimit=5&live=run");
    expect(tail.page).toBeDefined();
    expect(tail.messages.map(shape)).toEqual(before.map(shape));
    expect(tail.live!.records!.map(shape)).toEqual(run);
    // A window of the newest Task alone begins at the run's input, behind its task_begin.
    const newest = await getMessages("?tailLimit=1&live=run");
    expect(newest.messages).toEqual([]);
    expect(newest.live!.records!.map(shape)).toEqual(run);

    // The Web App's read is unchanged: the whole Trace, and the open fragments alone.
    const classic = await getMessages("");
    expect(classic.messages.map(shape)).toEqual([
      ...before.map(shape),
      "task_begin",
      "text:go",
      "request_begin",
      "text:Hello",
      "tool_call",
    ]);
    expect(Object.keys(classic.live!)).toEqual(["cursor", "fragments"]);

    await finish("tc-run");
  });

  it("while idle: live is attached with no records, and an input an aborted bootstrap holds is still offered", async () => {
    // A run that ends before its first request: nothing reached the Trace, the input is held.
    adopt(async function* () {});
    await t.deps.manager.startTask(SID, [userText("held")]);
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");

    const body = await getMessages("?live=run");
    expect(body.messages.map(shape)).toEqual(["text:held"]);
    expect(body.live!.status).toBe("idle");
    expect(body.live!.records).toEqual([]);
    expect(body.live!.fragments).toEqual([]);
    expect(body.live!.cursor).toMatch(/^[0-9a-f]{8}-\d+$/);
  });

  it("while busy, a held input is not offered with the history: it arrives once, as the run's record", async () => {
    const before = earlier();
    await writeTrace(before);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    adopt(async function* (_input: AmspRecord[], opts: { approve: ApproveFn }) {
      await gate;
      yield requestBegin();
      const call = toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-held" });
      yield call;
      yield approvalDecision(await opts.approve(call), "tc-held");
    });
    await t.deps.manager.startTask(SID, [userText("go")]);
    expect(t.deps.manager.statusOf(SID)).toBe("running");

    const parked = await getMessages("?live=run");
    expect(parked.live!.status).toBe("running");
    expect(parked.live!.records).toEqual([]);
    expect(parked.messages.map(shape)).toEqual(before.map(shape));
    // The Web App's read offers the same input as a held one.
    expect((await getMessages("")).messages.map(shape)).toEqual(
      [...before, userText("go")].map(shape),
    );

    release();
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);
    const streaming = await getMessages("?live=run");
    expect(streaming.messages.map(shape)).toEqual(before.map(shape));
    expect(streaming.live!.records!.map(shape)).toEqual(["text:go", "request_begin", "tool_call"]);

    await finish("tc-held");
  });

  it("a run larger than the log holds says how many of its oldest records are gone and keeps the newest", async () => {
    const sent = 12;
    adopt(async function* (_input: AmspRecord[], opts: { approve: ApproveFn }) {
      const big = "x".repeat(1024 * 1024);
      for (let i = 0; i < sent; i += 1) yield assistantText(`${i}:${big}`);
      const call = toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-big" });
      yield call;
      yield approvalDecision(await opts.approve(call), "tc-big");
    });
    await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);

    const { live } = await getMessages("?live=run");
    expect(live!.omitted).toBeGreaterThan(0);
    // The echo, the texts and the call: each one held or counted.
    expect(live!.records!.length + live!.omitted!).toBe(1 + sent + 1);
    expect(shape(live!.records!.at(-1)!)).toBe("tool_call");
    expect(live!.records!.some((r) => shape(r) === "text:go")).toBe(false);

    await finish("tc-big");
  });

  it("a tail window that begins inside a run of several Tasks holds none of it", async () => {
    const before = earlier();
    await writeTrace(before);
    adopt(async function* (input: AmspRecord[], opts: { approve: ApproveFn }) {
      const first = at(taskBegin(), 1);
      const round1 = assistantText("round 1");
      const end1 = at(taskEnd(), 2);
      const second = at(taskBegin(), 3);
      const again = userText("keep going", "harness");
      const call = toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-goal" });
      await writeTrace([...before, first, ...input, round1, end1, second, again, call]);
      yield first;
      yield round1;
      yield end1;
      yield second;
      yield again;
      yield call;
      yield approvalDecision(await opts.approve(call), "tc-goal");
    });
    await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);

    const run = [
      "task_begin",
      "text:go",
      "text:round 1",
      "task_end",
      "task_begin",
      "text:keep going",
      "tool_call",
    ];
    const tail = await getMessages("?tailLimit=1&live=run");
    expect(tail.messages).toEqual([]);
    expect(tail.live!.records!.map(shape)).toEqual(run);
    const full = await getMessages("?live=run");
    expect(full.messages.map(shape)).toEqual(before.map(shape));
    expect(full.live!.records!.map(shape)).toEqual(run);

    await finish("tc-goal");
  });

  it("a before page ignores the run form", async () => {
    adopt(async function* (_input: AmspRecord[], opts: { approve: ApproveFn }) {
      const call = toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-before" });
      yield call;
      yield approvalDecision(await opts.approve(call), "tc-before");
    });
    await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);

    const page = await getMessages("?before=1:0&limit=5&live=run");
    expect(page.page).toBeDefined();
    expect(page.live).toBeUndefined();

    await finish("tc-before");
  });
});

describe("messages run form: a run that begins during the read", () => {
  it("is cut at its first record, and the client finds the run on the stream after the cursor", async () => {
    const S = uniqueSessionId();
    const tail = new LiveTailTracker();
    const channel = new Channel();
    let status: SessionStatus = "idle";
    const before = earlier();
    const runRecords = [taskBegin(), userText("next")];
    const deps: SessionHistoryDeps = {
      manager: {
        statusOf: () => status,
        liveFragments: (id) => tail.fragments(id),
        liveRun: (id) => tail.run(id),
        pendingInputs: () => [],
        pendingBootstrap: () => [],
      },
      channels: { get: () => channel },
      traceService: {
        // The run starts while the Trace is being read: its first records are published, and
        // the read already finds them written.
        readMessages: async () => {
          status = "running";
          tail.begin(S);
          for (const msg of runRecords) tail.observe(S, msg, channel.publish(msg));
          return [...before, ...runRecords].map((m, ordinal) => ({
            ...m,
            tracePosition: { fileIndex: 1, ordinal },
          }));
        },
        readMessagesPage: async () => {
          throw new Error("a full read was asked for");
        },
        readTraceImage: async () => {
          throw new Error("no image was asked for");
        },
      },
    };
    const app = new Hono();
    app.get("/messages", (c) => sessionMessages(c, deps, sessionRow(S), "/api/sessions"));

    const body = (await (await app.request("/messages?live=run")).json()) as MessagesResponse;
    expect(body.messages.map(shape)).toEqual(before.map(shape));
    expect(body.live!.status).toBe("idle");
    expect(body.live!.records).toEqual([]);
    // What the client renders next: the stream's records after the cursor — the run, once.
    const after = channel
      .replayAfter(body.live!.cursor)
      .events.map((e) => JSON.parse(e.data) as AmspRecord);
    expect(after.map(shape)).toEqual(runRecords.map(shape));
  });
});
