/**
 * Session resume: `agent.resumeSession` and setHistory injection.
 *
 * - Resume source is the Trace file with the latest index; config carries over from session_meta
 *   (Workspace / Model cannot be swapped).
 * - Pairing-fallback placeholders, once constructed, are written into the original trace file;
 *   session_meta is never written twice.
 * - Errors when the session doesn't exist / the workspace is missing / the model is no longer in the project config.
 * - `groupHistoryToUniMessages` groups by adjacent same role; `GenerativeModel.setHistory` injects into AgentHub.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgent } from "../src/index.js";
import {
  abortEvent,
  assistantText,
  requestBegin,
  requestEnd,
  sessionMeta,
  tokenUsage,
  toolCall,
  userText,
} from "../src/omnimessage/index.js";
import type { OmniMessage, TokenCounts } from "../src/omnimessage/index.js";
import { GenerativeModel, groupHistoryToUniMessages } from "../src/llm/index.js";
import { readTrace } from "../src/trace/index.js";
import { tracesDir } from "../src/state/paths.js";
import { stubProviderKeys } from "./provider-keys.js";

// The default project config ships with this model ((provider, model_id) pair reference; model_id is the upstream id).
const MODEL = { provider: "anthropic", model_id: "claude-sonnet-4-6" };

let tmpRoot: string;
let workspace: string;
let prevHome: string | undefined;
let restoreKeys: () => void;

beforeEach(async () => {
  prevHome = process.env.PENGUIN_HOME;
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-resume-"));
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-resume-ws-"));
  process.env.PENGUIN_HOME = tmpRoot;
  restoreKeys = stubProviderKeys();
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.PENGUIN_HOME;
  else process.env.PENGUIN_HOME = prevHome;
  restoreKeys();
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.rm(workspace, { recursive: true, force: true });
});

const usage = (total: number): TokenCounts => ({
  cache_read: 0,
  cache_write: 0,
  output: 1,
  total,
});

/** Manually constructs a session's trace file (simulating a record left behind by a previous process). */
async function writeTraceFile(
  root: string,
  sessionId: string,
  messages: OmniMessage[],
  opts?: { dateDir?: string; index?: string },
): Promise<string> {
  const dir = path.join(
    tracesDir(root, "default_project", "default_agent"),
    opts?.dateDir ?? "2026-07-06",
  );
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}_${opts?.index ?? "001"}.jsonl`);
  await fs.writeFile(file, messages.map((m) => JSON.stringify(m)).join("\n") + "\n", "utf8");
  return file;
}

function metaFor(sessionId: string, workspaceDir: string, model = MODEL): OmniMessage {
  return sessionMeta({
    session_id: sessionId,
    provider: model.provider,
    model_id: model.model_id,
    model_context_window: 1000000,
    system_prompt: "ORIGINAL SYSTEM PROMPT",
    tools: [],
    thinking_level: "default",
    agent_state: "/agent/state",
    workspace: workspaceDir,
  });
}

describe("agent.resumeSession", () => {
  const SID = "session-2026-07-06-10-00-00-abcdef01";

  it("resumes from the latest trace file and exposes render history", async () => {
    const agent = await createAgent({});
    await writeTraceFile(tmpRoot, SID, [
      metaFor(SID, workspace),
      userText("hello"),
      requestBegin(),
      assistantText("hi there"),
      requestEnd("completed"),
      tokenUsage(usage(42), usage(42)),
    ]);

    const session = await agent.resumeSession({ sessionId: SID });
    expect(session.sessionId).toBe(SID);
    expect(session.provider).toBe(MODEL.provider);
    expect(session.modelId).toBe(MODEL.model_id);
    expect(session.workspaceDir).toBe(workspace);
    const texts = (session.resumedHistory ?? []).map(
      (m) => (m.payload as { text?: string }).text ?? "",
    );
    expect(texts).toEqual(["hello", "hi there"]);
  });

  it("keeps abort events in resumed render history", async () => {
    const agent = await createAgent({});
    await writeTraceFile(tmpRoot, SID, [
      metaFor(SID, workspace),
      userText("long task"),
      requestBegin(),
      assistantText("partial answer", "aborted"),
      requestEnd("aborted"),
      abortEvent("aborted by user"),
    ]);

    const session = await agent.resumeSession({ sessionId: SID });
    expect(
      (session.resumedHistory ?? []).map((m) => (m.payload as { type?: string }).type),
    ).toEqual(["text", "text", "abort"]);
  });

  it("does not write pairing placeholders to the trace file (resume is side-effect free)", async () => {
    const agent = await createAgent({});
    const file = await writeTraceFile(tmpRoot, SID, [
      metaFor(SID, workspace),
      userText("go"),
      requestBegin(),
      toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc1" }),
      requestEnd("completed"),
      tokenUsage(usage(10), usage(10)),
      // tc1's output was lost along with the process: the pairing placeholder is synthesized in memory and sent out with the next run, never persisted.
    ]);
    const before = await readTrace(file);

    await agent.resumeSession({ sessionId: SID });
    await agent.resumeSession({ sessionId: SID }); // resuming again has no side effects either
    const after = await readTrace(file);
    expect(after).toHaveLength(before.length);
    expect(
      after.filter((m) =>
        ((m.payload as { output?: string }).output ?? "").includes("interrupted"),
      ),
    ).toHaveLength(0);
    // session_meta is never written twice.
    expect(after.filter((m) => m.type === "session_meta")).toHaveLength(1);
  });

  it("picks the latest index when the context was compacted into multiple files", async () => {
    const agent = await createAgent({});
    await writeTraceFile(tmpRoot, SID, [metaFor(SID, workspace), userText("old context")], {
      index: "001",
    });
    await writeTraceFile(
      tmpRoot,
      SID,
      [
        metaFor(SID, workspace),
        userText("<context_summary>gist</context_summary>"),
        requestBegin(),
        assistantText("resumed context"),
        requestEnd("completed"),
        tokenUsage(usage(5), usage(5)),
      ],
      { index: "002" },
    );

    const session = await agent.resumeSession({ sessionId: SID });
    const texts = (session.resumedHistory ?? []).map(
      (m) => (m.payload as { text?: string }).text ?? "",
    );
    expect(texts).toEqual(["<context_summary>gist</context_summary>", "resumed context"]);
  });

  it("errors when the session does not exist", async () => {
    const agent = await createAgent({});
    await expect(agent.resumeSession({ sessionId: "session-none" })).rejects.toThrow(
      /Session does not exist/,
    );
  });

  it("errors when the recorded workspace no longer exists (PRN-004: no auto-create)", async () => {
    const agent = await createAgent({});
    const gone = path.join(workspace, "gone");
    await writeTraceFile(tmpRoot, SID, [metaFor(SID, gone), userText("x")]);
    await expect(agent.resumeSession({ sessionId: SID })).rejects.toThrow(
      /Workspace no longer exists/,
    );
  });

  it("errors when the recorded model is no longer in the project config", async () => {
    const agent = await createAgent({});
    await writeTraceFile(tmpRoot, SID, [
      metaFor(SID, workspace, { provider: "custom", model_id: "vanished-model" }),
      userText("x"),
    ]);
    await expect(agent.resumeSession({ sessionId: SID })).rejects.toThrow(
      /is not in the Project config/,
    );
  });

  it("errors clearly when session_meta lacks provider (old-format trace, no migration)", async () => {
    // An old-format trace's session_meta only has model_id (from the composite-id era): no backward compat, just a clear error.
    const agent = await createAgent({});
    const legacy = metaFor(SID, workspace);
    delete (legacy.payload as { provider?: string }).provider;
    await writeTraceFile(tmpRoot, SID, [legacy, userText("x")]);
    await expect(agent.resumeSession({ sessionId: SID })).rejects.toThrow(/legacy data/);
  });

  it("latestSessionId returns the newest session by embedded timestamp", async () => {
    const agent = await createAgent({});
    expect(await agent.latestSessionId()).toBeNull();
    const older = "session-2026-07-05-09-00-00-aaaaaaaa";
    const newer = "session-2026-07-06-11-00-00-bbbbbbbb";
    await writeTraceFile(tmpRoot, older, [metaFor(older, workspace), userText("older")], {
      dateDir: "2026-07-05",
    });
    await writeTraceFile(tmpRoot, newer, [metaFor(newer, workspace), userText("newer")], {
      dateDir: "2026-07-06",
    });
    expect(await agent.latestSessionId()).toBe(newer);
  });

  it("latestSessionId ignores empty traces that only contain session_meta", async () => {
    const agent = await createAgent({});
    const older = "session-2026-07-05-09-00-00-aaaaaaaa";
    const emptyNewer = "session-2026-07-06-11-00-00-bbbbbbbb";
    await writeTraceFile(tmpRoot, older, [metaFor(older, workspace), userText("older")], {
      dateDir: "2026-07-05",
    });
    await writeTraceFile(tmpRoot, emptyNewer, [metaFor(emptyNewer, workspace)], {
      dateDir: "2026-07-06",
    });
    expect(await agent.latestSessionId()).toBe(older);
  });

  it("manual compact on a new empty session does not create a resumable trace", async () => {
    const agent = await createAgent({});
    const session = await agent.createSession({ workspaceDir: workspace });
    const messages = [];
    for await (const msg of session.compact()) messages.push(msg);
    expect(messages).toHaveLength(0);
    expect(await agent.latestSessionId()).toBeNull();
  });
});

describe("setHistory injection", () => {
  it("groupHistoryToUniMessages groups adjacent same-role messages into UniMessages", () => {
    const uni = groupHistoryToUniMessages([
      userText("hello"),
      assistantText("hi"),
      toolCall({ name: "exec_command", arguments: '{"cmd":"ls"}', toolCallId: "tc1" }),
      {
        ...userText("ignored-shape"),
        payload: {
          type: "tool_call_output",
          role: "user",
          output: "out",
          tool_call_id: "tc1",
          stop_reason: "completed",
        },
      } as OmniMessage,
      userText("next"),
      assistantText("done"),
    ]);
    expect(uni.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(uni[1]!.content_items.map((c) => c.type)).toEqual(["text", "tool_call"]);
    expect(uni[2]!.content_items.map((c) => c.type)).toEqual(["tool_result", "text"]);
  });

  it("GenerativeModel.setHistory seeds the AgentHub client history", () => {
    // GenerativeModel takes the request id sent to AgentHub (the upstream id), not the storage id.
    const model = new GenerativeModel({ modelId: "claude-sonnet-4-6", tools: [] });
    model.setHistory([userText("hello"), assistantText("hi")]);
    const client = (model as unknown as { client: { getHistory(): unknown[] } }).client;
    expect(client.getHistory()).toHaveLength(2);
  });
});
