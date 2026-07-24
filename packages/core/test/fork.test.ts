/**
 * Model-switch fork: `agent.forkSession` creates a NEW Session that carries the source
 * Session's conversation as real, sanitized history and continues on another model.
 *
 * - History carried: user text, assistant text, tool calls and their outputs survive;
 * - Sanitized ALWAYS: thinking/inline_thinking dropped, `fidelity` stripped everywhere,
 *   token_usage and subagent pointer events dropped;
 * - The forked Trace file is well-formed (new session_meta first, request pairs kept) and
 *   itself resumable via `agent.resumeSession`;
 * - The new meta holds the NEW model pair, `forked_from`, and the SAME Workspace;
 * - An unknown model pair and a missing source Trace are rejected with clear errors.
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
  subagentEvent,
  thinkingMessage,
  tokenUsage,
  toolCall,
  toolCallOutput,
  userText,
} from "../src/omnimessage/index.js";
import type { OmniMessage, TokenCounts } from "../src/omnimessage/index.js";
import { readTrace, sanitizeForkRecords } from "../src/trace/index.js";
import { tracesDir } from "../src/state/paths.js";
import { stubProviderKeys } from "./provider-keys.js";

// Both pairs ship in the default Project config (see resume/agent tests).
const SOURCE_MODEL = { provider: "anthropic", model_id: "claude-sonnet-4-6" };
const TARGET_MODEL = { provider: "deepseek", modelId: "deepseek-v4-pro" };

let tmpRoot: string;
let workspace: string;
let prevHome: string | undefined;
let restoreKeys: () => void;

beforeEach(async () => {
  prevHome = process.env.PENGUIN_HOME;
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-fork-"));
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-fork-ws-"));
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

const SID = "session-2026-07-06-10-00-00-abcdef01";

async function writeSourceTrace(messages: OmniMessage[], sessionId = SID): Promise<string> {
  const dir = path.join(tracesDir(tmpRoot, "default_project", "default_agent"), "2026-07-06");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}_001.jsonl`);
  await fs.writeFile(file, messages.map((m) => JSON.stringify(m)).join("\n") + "\n", "utf8");
  return file;
}

/** A source conversation with thinking, fidelity, tool calls, usage, and a subagent pointer. */
function sourceRecords(): OmniMessage[] {
  return [
    sessionMeta({
      session_id: SID,
      provider: SOURCE_MODEL.provider,
      model_id: SOURCE_MODEL.model_id,
      model_context_window: 1000000,
      system_prompt: "SOURCE SYSTEM PROMPT",
      tools: [],
      agent_state: "/agent/state",
      workspace,
    }),
    userText("hello"),
    requestBegin(),
    thinkingMessage("private reasoning", "completed", { signature: "claude-sig" }),
    assistantText("hi there", "completed", { phase: "answer" }),
    toolCall({
      name: "exec_command",
      arguments: '{"cmd":"ls"}',
      toolCallId: "tc1",
      fidelity: { id: "call-1" },
    }),
    requestEnd("completed"),
    toolCallOutput({ output: "file.txt", toolCallId: "tc1" }),
    tokenUsage(usage(42), usage(42)),
    subagentEvent("session-child-1"),
    requestBegin(),
    assistantText("done"),
    requestEnd("completed"),
    tokenUsage(usage(80), usage(60)),
  ];
}

const payloadTypes = (msgs: OmniMessage[]): string[] =>
  msgs.map((m) => (m.payload as { type?: string }).type ?? m.type);

describe("sanitizeForkRecords", () => {
  it("drops meta/thinking/usage/subagent, strips fidelity, keeps everything else in order", () => {
    const out = sanitizeForkRecords(sourceRecords());
    expect(payloadTypes(out)).toEqual([
      "text", // hello
      "request_begin",
      "text", // hi there (thinking dropped)
      "tool_call",
      "request_end",
      "tool_call_output",
      "request_begin",
      "text", // done
      "request_end",
    ]);
    expect(JSON.stringify(out)).not.toContain("fidelity");
    // Pure: the input records are never mutated.
    const src = sourceRecords();
    void sanitizeForkRecords(src);
    expect(src.some((m) => (m.payload as { fidelity?: unknown }).fidelity !== undefined)).toBe(
      true,
    );
  });
});

describe("agent.forkSession", () => {
  it("carries the conversation onto the new model with a sanitized, resumable trace", async () => {
    const agent = await createAgent({});
    await writeSourceTrace(sourceRecords());

    const fork = await agent.forkSession({ fromSessionId: SID, ...TARGET_MODEL });
    try {
      // New identity on the NEW model pair; the Workspace continues from the source.
      expect(fork.sessionId).not.toBe(SID);
      expect(fork.provider).toBe(TARGET_MODEL.provider);
      expect(fork.modelId).toBe(TARGET_MODEL.modelId);
      expect(fork.workspaceDir).toBe(workspace);
      const meta = fork.metaMessage.payload as unknown as Record<string, unknown>;
      expect(meta.forked_from).toBe(SID);
      // Invariants only, freshly assembled for this agent (not the source's recorded prompt).
      expect("thinking_level" in meta).toBe(false);
      expect(meta.system_prompt).not.toBe("SOURCE SYSTEM PROMPT");

      // The rendered history carries the conversation (thinking dropped).
      const rendered = payloadTypes(fork.resumedHistory ?? []).filter((t) => t !== "abort");
      expect(rendered).toEqual(["text", "text", "tool_call", "tool_call_output", "text"]);

      // The forked trace file: fresh index 001 under today's date dir; meta first; sanitized.
      const dir = tracesDir(tmpRoot, "default_project", "default_agent");
      const dates = await fs.readdir(dir);
      const today = dates.filter((d) => d !== "2026-07-06");
      expect(today).toHaveLength(1);
      const forkFile = path.join(dir, today[0]!, `${fork.sessionId}_001.jsonl`);
      const records = await readTrace(forkFile);
      expect(records[0]!.type).toBe("session_meta");
      expect((records[0]!.payload as { forked_from?: string }).forked_from).toBe(SID);
      const types = payloadTypes(records);
      expect(types).not.toContain("thinking");
      expect(types).not.toContain("token_usage");
      expect(types).not.toContain("subagent");
      expect(types.filter((t) => t === "request_begin")).toHaveLength(2);
      expect(types.filter((t) => t === "request_end")).toHaveLength(2);
      expect(JSON.stringify(records)).not.toContain("fidelity");

      // Engine state seeded like resume: turns carried, tokens restart at zero.
      const engine = (
        fork as unknown as {
          engine: { sessionTurns: number; lastSessionTokens: TokenCounts };
        }
      ).engine;
      expect(engine.sessionTurns).toBe(2);
      expect(engine.lastSessionTokens.total).toBe(0);
    } finally {
      fork.dispose();
    }

    // The forked trace is itself resumable: resumeSession rebuilds the same conversation.
    const resumed = await agent.resumeSession({ sessionId: fork.sessionId });
    try {
      expect(resumed.provider).toBe(TARGET_MODEL.provider);
      expect(resumed.modelId).toBe(TARGET_MODEL.modelId);
      expect((resumed.metaMessage.payload as { forked_from?: string }).forked_from).toBe(SID);
      const texts = (resumed.resumedHistory ?? [])
        .map((m) => (m.payload as { text?: string }).text ?? "")
        .filter(Boolean);
      expect(texts).toEqual(["hello", "hi there", "done"]);
    } finally {
      resumed.dispose();
    }
  });

  it("keeps carry-over semantics: an unanswered committed tool_call is backfilled on first run, not lost", async () => {
    const agent = await createAgent({});
    await writeSourceTrace([
      ...sourceRecords().slice(0, 1),
      userText("go"),
      requestBegin(),
      toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc9" }),
      requestEnd("completed"),
      abortEvent("aborted by user"),
      // tc9's output never arrived: fork must re-synthesize the pairing placeholder in
      // memory (same as resume), never persist it.
    ]);
    const fork = await agent.forkSession({ fromSessionId: SID, ...TARGET_MODEL });
    try {
      const carryOver = (fork as unknown as { engine: { pendingCarryOver: OmniMessage[] } }).engine
        .pendingCarryOver;
      expect(carryOver).toHaveLength(1);
      expect((carryOver[0]!.payload as { tool_call_id?: string }).tool_call_id).toBe("tc9");
    } finally {
      fork.dispose();
    }
  });

  it("rejects an unknown model pair before touching anything", async () => {
    const agent = await createAgent({});
    await writeSourceTrace(sourceRecords());
    await expect(
      agent.forkSession({ fromSessionId: SID, modelId: "no-such-model", provider: "anthropic" }),
    ).rejects.toThrow(/not in the Project config/);
  });

  it("rejects a source session without any trace", async () => {
    const agent = await createAgent({});
    await expect(
      agent.forkSession({
        fromSessionId: "session-2026-07-06-09-00-00-deadbeef",
        ...TARGET_MODEL,
      }),
    ).rejects.toThrow(/no Trace record/);
  });

  it("rejects when the source workspace no longer exists", async () => {
    const agent = await createAgent({});
    await writeSourceTrace(sourceRecords());
    await fs.rm(workspace, { recursive: true, force: true });
    await expect(agent.forkSession({ fromSessionId: SID, ...TARGET_MODEL })).rejects.toThrow(
      /Workspace no longer exists/,
    );
  });
});
