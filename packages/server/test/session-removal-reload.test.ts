/**
 * Given a running child of an idle parent, when a credential refresh replaces that parent
 * runtime and the Session is then removed, deletion must still cancel the original child.
 */
import { expect, it } from "vitest";
import { Environment, toolCall } from "@prismshadow/penguin-core";
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

it.each(["session", "agent", "project", "shutdown", "task", "reload-failure"] as const)(
  "%s preserves child ownership across runtime reload",
  async (scope) => {
    const db = openDatabase(":memory:");
    const sessions = wire(SessionsRepo, { db });
    const channels = new ChannelHub();
    const row = sessionRow("session-reloaded-removal");
    sessions.insert(row);
    const started = gate(),
      stopped = gate();
    let childSignal: AbortSignal | undefined;
    const env = new Environment({
      workspaceDir: process.cwd(),
      toolConfig: {
        customTools: [{ name: "run_subagent", description: "test", permission: "rw" }],
        mcpServers: [],
      },
      services: {
        subagentRunner: {
          spawn: async () => ({
            sessionId: "child-original-runtime",
            async *run({ signal }) {
              childSignal = signal;
              started.resolve();
              await new Promise<void>((resolve) => {
                if (signal?.aborted) resolve();
                else signal?.addEventListener("abort", () => resolve(), { once: true });
              });
              stopped.resolve();
              return null;
            },
            dispose() {},
          }),
        },
      },
    });
    const manager = new SessionManager({
      sessions,
      channels,
      sources: new SessionSources(),
      loader: {
        load: async () => {
          if (scope === "reload-failure") throw new Error("reload failed");
          return fakeSession(row.sessionId);
        },
      },
      recorder: { record: async () => {} },
      log: () => {},
    });
    manager.adopt(
      row,
      fakeSession(row.sessionId, {
        dispose: () => env.dispose(),
        hasRunningBackgroundSubagents: () => env.hasRunningBackgroundSubagents(),
        listBackgroundSubagents: () => env.listBackgroundSubagents(),
        abortBackgroundSubagentRun: (id) => env.abortBackgroundSubagentRun(id),
      }),
    );
    try {
      for await (const msg of env.executeTool({
        toolCall: toolCall({
          name: "run_subagent",
          toolCallId: "spawn",
          arguments: JSON.stringify({ prompt: "work", run_in_background: true }),
        }),
      }))
        void msg;
      await started.promise;
      manager.invalidateProjectRuntimes(row.projectId);
      if (scope === "reload-failure")
        await expect(manager.preload(row.sessionId)).rejects.toThrow("reload failed");
      else {
        await manager.preload(row.sessionId);
        manager.invalidateProjectRuntimes(row.projectId);
        await manager.preload(row.sessionId);
      }
      expect(childSignal?.aborted).toBe(false);
      manager.sweepIdle(Date.now() + 60 * 60 * 1000, 1);
      if (scope === "shutdown") await manager.shutdown();
      else if (scope === "task") manager.abortTask(row.sessionId);
      else
        await Promise.allSettled(
          scope === "project"
            ? manager.abortProject(row.projectId)
            : scope === "agent"
              ? manager.beginAgentDeletion(row.projectId, row.agentId)
              : manager.beginSessionDeletion(row.sessionId),
        );
      expect(childSignal?.aborted).toBe(scope !== "task");
    } finally {
      await env.dispose();
      await stopped.promise;
      await manager.shutdown();
      channels.dispose();
      db.close();
    }
  },
);
