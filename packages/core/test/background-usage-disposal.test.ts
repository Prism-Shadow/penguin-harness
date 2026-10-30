/**
 * Given a child finishing after Environment disposal, forward its metadata and request
 * accounting records, but suppress late conversation output and completion notices.
 * The child runner is the external edge; the Environment and subagent pump are real.
 */
import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Environment } from "../src/environment/index.js";
import {
  assistantText,
  emptyTokenCounts,
  requestBegin,
  requestEnd,
  sessionMeta,
  tokenUsage,
  toolCall,
  withOrigin,
} from "@prismshadow/amsp/records";
import type { AmspRecord } from "@prismshadow/amsp/records";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("forwards only accounting records from a child settling after disposal", async () => {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "penguin-late-usage-"));
  const release = gate();
  const finished = gate();
  const childId = "session-child-12345678";
  const records = [
    sessionMeta({
      session_id: childId,
      provider: "custom",
      model_id: "test",
      model_context_window: 1000,
      system_prompt: "test",
      workspace: workspaceDir,
      agent_state: workspaceDir,
      source: "subagent",
    }),
    requestBegin(),
    assistantText("late answer"),
    tokenUsage(emptyTokenCounts(), { cache_read: 0, cache_write: 0, output: 2, total: 12 }),
    requestEnd("completed"),
  ].map((msg) => withOrigin(msg, childId));
  const forwarded: AmspRecord[] = [];
  const notices: unknown[] = [];
  const env = new Environment({
    workspaceDir,
    toolConfig: {
      customTools: [{ name: "run_subagent", description: "test", permission: "rw" }],
      mcpServers: [],
    },
    services: {
      subagentRunner: {
        async spawn() {
          return {
            sessionId: childId,
            async *run() {
              await release.promise;
              yield* records;
              finished.resolve();
              return null;
            },
            dispose() {},
          };
        },
      },
    },
  });
  env.setBackgroundMessageListener((msg) => forwarded.push(msg));
  env.setBackgroundTaskListener((notice) => notices.push(notice));
  try {
    for await (const msg of env.executeTool({
      toolCall: toolCall({
        name: "run_subagent",
        toolCallId: "spawn",
        arguments: JSON.stringify({ prompt: "work", run_in_background: true }),
      }),
    }))
      void msg;
    env.dispose();
    release.resolve();
    await finished.promise;
    expect(forwarded).toEqual(records.filter((msg) => msg !== records[2]));
    expect(notices).toEqual([]);
  } finally {
    release.resolve();
    env.dispose();
    await rm(workspaceDir, { recursive: true, force: true });
  }
});
