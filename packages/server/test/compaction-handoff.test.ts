/**
 * A compaction that hands files to the next context, on a real core Session against the loopback
 * model (live-session.ts, the one fake), driven by the SessionManager the way POST /compact
 * drives it.
 *
 * - Given an allow-all Session with a finished turn, when the user compacts and the model first
 *   writes a hand-off file into the Session's scratchpad and then replies with its summary: the
 *   file is on disk as the model wrote it, the session stream carries the round between the
 *   compaction events as the Trace has it, the round's request sends the tool result alone, and
 *   the next Task opens with the summary, its trailer naming the Trace file the compaction
 *   closed.
 * - Given an always-ask Session, the round's write waits for the user: an approval request is
 *   published for it, nothing is written before the answer, and the file is written once it is
 *   allowed.
 * - Given a model that writes outside the scratchpad while compacting, the write is refused
 *   before anything runs, and the model is told what it may do.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { wire } from "@prismshadow/penguin-core/kernel";
import type { DatabaseSync } from "node:sqlite";
import {
  createAgent,
  saveProjectConfig,
  sessionScratchpadDir,
  tracesDir,
  userText,
} from "@prismshadow/penguin-core";
import type { AmspRecord } from "@prismshadow/penguin-core";
import { openDatabase } from "../src/db/database.js";
import { SessionsRepo } from "../src/db/repos/sessions.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { ChannelHub } from "../src/runtime/channel.js";
import type { ChannelEvent } from "../src/runtime/channel.js";
import { SessionManager, createCoreSessionLoader } from "../src/runtime/session-manager.js";
import { SessionSources } from "../src/runtime/session-sources.js";
import { makeTempRoot, waitFor } from "./helpers.js";
import { MOCK_MODEL_ID, requestText, startMockLLM } from "./live-session.js";
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

  it("writes the hand-off file, streams the round, sends its result alone, and the next Task opens with the summary and its trailer", async () => {
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
    // The round's request appends the tool result and nothing else.
    const roundRequest = mock.requests[2]! as { messages: { role: string; content: unknown }[] };
    const last = roundRequest.messages.at(-1)!;
    expect(last.role).toBe("user");
    expect((last.content as { type: string }[]).map((b) => b.type)).toEqual(["tool_result"]);

    await manager.startTask(sessionId, [userText("go on")]);
    await idle();
    const next = requestText(mock.requests[3]!);
    expect(next).toContain("[context_summary]");
    expect(next).toContain("Tag v1 as the plan says.");
    const day = (await fs.readdir(tracesDir(root, PROJECT, AGENT)))[0]!;
    const closed = path.join(tracesDir(root, PROJECT, AGENT), day, `${sessionId}_001.jsonl`);
    expect(next).toContain(JSON.stringify(closed).slice(1, -1));
    expect(next).toContain("read_file offset/limit");
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
