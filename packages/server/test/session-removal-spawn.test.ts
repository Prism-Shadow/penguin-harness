/**
 * Given a background spawn waiting for its handle, when deletion starts before the handle
 * arrives, completing the spawn must not start a child while parent cleanup is still pending.
 * RuntimeSession and SubagentRunner are scripted boundaries; the manager and Environment are real.
 */
import { expect, it } from "vitest";
import { Environment, requestBegin, toolCall, userText } from "@prismshadow/penguin-core";
import { wire } from "@prismshadow/penguin-core/kernel";
import { openDatabase } from "../src/db/database.js";
import { SessionsRepo } from "../src/db/repos/sessions.js";
import { ChannelHub } from "../src/runtime/channel.js";
import { SessionSources } from "../src/runtime/session-sources.js";
import { SessionManager } from "../src/runtime/session-manager.js";
import { fakeSession, sessionRow } from "./fixtures/session.js";

const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

it("does not launch a child whose spawn finishes after session removal begins", async () => {
  const db = openDatabase(":memory:");
  const sessions = wire(SessionsRepo, { db });
  const channels = new ChannelHub();
  const row = sessionRow("session-spawn-race");
  sessions.insert(row);
  const spawning = gate(),
    releaseSpawn = gate(),
    toolReturned = gate(),
    releaseParent = gate();
  let childRuns = 0;
  const env = new Environment({
    workspaceDir: process.cwd(),
    toolConfig: {
      customTools: [{ name: "run_subagent", description: "test", permission: "rw" }],
      mcpServers: [],
    },
    services: {
      subagentRunner: {
        spawn: async () => {
          spawning.resolve();
          await releaseSpawn.promise;
          return {
            sessionId: "child-spawn-race",
            async *run() {
              childRuns++;
              yield requestBegin();
              return null;
            },
            dispose() {},
          };
        },
      },
    },
  });
  const manager = new SessionManager({
    sessions,
    channels,
    sources: new SessionSources(),
    loader: {
      load: async () => {
        throw new Error("unexpected reload");
      },
    },
    recorder: { record: async () => {} },
    log: () => {},
  });
  manager.adopt(
    row,
    fakeSession(row.sessionId, {
      dispose: () => env.dispose(),
      listBackgroundSubagents: () => env.listBackgroundSubagents(),
      abortBackgroundSubagentRun: (id) => env.abortBackgroundSubagentRun(id),
      async *run(_input, { signal }) {
        try {
          yield* env.executeTool({
            toolCall: toolCall({
              name: "run_subagent",
              toolCallId: "spawn",
              arguments: JSON.stringify({ prompt: "work", run_in_background: true }),
            }),
            signal,
          });
        } finally {
          toolReturned.resolve();
          await releaseParent.promise;
        }
      },
    }),
  );
  let removal: Promise<void>[] = [];
  try {
    await manager.startTask(row.sessionId, [userText("start child")]);
    await spawning.promise;
    removal = manager.beginSessionDeletion(row.sessionId);
    releaseSpawn.resolve();
    await toolReturned.promise;
    expect(childRuns).toBe(0);
  } finally {
    releaseSpawn.resolve();
    releaseParent.resolve();
    await Promise.allSettled(removal);
    await env.dispose();
    await manager.shutdown();
    channels.dispose();
    db.close();
  }
});
