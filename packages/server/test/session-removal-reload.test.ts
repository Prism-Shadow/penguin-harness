/**
 * Given a running child of an idle parent, when a credential refresh replaces that parent
 * runtime and the Session is then removed, deletion must still cancel the original child.
 */
import { expect, it } from "vitest";
import { Environment, toolCall, userText } from "@prismshadow/penguin-core";
import { wire } from "@prismshadow/penguin-core/kernel";
import { openDatabase } from "@prismshadow/penguin-library-db";
import { SessionsRepo } from "@prismshadow/penguin-library-session/repos/sessions";
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

it("waits for a retired runtime that finished its child and is already being cleaned up", async () => {
  const db = openDatabase(":memory:");
  const sessions = wire(SessionsRepo, { db });
  const channels = new ChannelHub();
  const row = sessionRow("session-retired-cleanup");
  sessions.insert(row);
  const disposing = gate();
  const release = gate();
  let running = true;
  let cleanups = 0;
  const manager = new SessionManager({
    sessions,
    channels,
    sources: new SessionSources(),
    loader: { load: async () => fakeSession(row.sessionId) },
    recorder: { record: async () => {} },
    log: () => {},
  });
  manager.adopt(
    row,
    fakeSession(row.sessionId, {
      hasRunningBackgroundSubagents: () => running,
      async dispose() {
        cleanups++;
        disposing.resolve();
        await release.promise;
      },
    }),
  );
  try {
    manager.invalidateProjectRuntimes(row.projectId);
    await manager.preload(row.sessionId);
    running = false;
    manager.sweepIdle();
    await disposing.promise;
    let removed = false;
    const removal = Promise.all(manager.beginSessionDeletion(row.sessionId)).then(() => {
      removed = true;
    });
    await Promise.resolve();
    expect(removed).toBe(false);
    release.resolve();
    await removal;
    expect(cleanups).toBe(1);
  } finally {
    release.resolve();
    await manager.shutdown();
    channels.dispose();
    db.close();
  }
});

it.each([false, true])(
  "drains a host child resume before deletion (credentials reloaded: %s)",
  async (reload) => {
    const db = openDatabase(":memory:");
    const sessions = wire(SessionsRepo, { db });
    const channels = new ChannelHub();
    const row = sessionRow("session-parent-with-pending-revival");
    sessions.insert(row);
    const childId = "session-child-87654321";
    const entered = gate(),
      releaseHandle = gate(),
      disposing = gate(),
      releaseCleanup = gate();
    const parentEntered = gate(),
      releaseParent = gate();
    let runs = 0,
      removals = 0;
    const env = new Environment({
      workspaceDir: process.cwd(),
      toolConfig: { customTools: [], mcpServers: [] },
      services: {
        subagentRunner: {
          async spawn() {
            throw new Error("unexpected child creation");
          },
          async resume() {
            entered.resolve();
            await releaseHandle.promise;
            return {
              sessionId: childId,
              async *run() {
                runs++;
                return null;
              },
              async dispose() {
                disposing.resolve();
                await releaseCleanup.promise;
                removals++;
              },
            };
          },
        },
      },
    });
    const active = {
      async *run() {
        parentEntered.resolve();
        await releaseParent.promise;
        return null;
      },
    };
    const manager = new SessionManager({
      sessions,
      channels,
      sources: new SessionSources(),
      traces: {
        ownedSubagents: async () => [
          {
            sessionId: childId,
            agentId: row.agentId,
            alias: null,
            spawnedAt: row.createdAt,
            title: null,
            position: "0.1",
            turnKey: "0.0",
          },
        ],
      },
      loader: { load: async () => fakeSession(row.sessionId, active) },
      recorder: { record: async () => {} },
      log: () => {},
    });
    manager.adopt(
      row,
      fakeSession(row.sessionId, {
        ...active,
        hasRunningBackgroundSubagents: () => env.hasRunningBackgroundSubagents(),
        sendToBackgroundSubagent: (...args) => env.sendToBackgroundSubagent(...args),
        disposeSubagents: () => env.disposeSubagents(),
        dispose: () => env.dispose(),
      }),
    );
    try {
      const message = manager.sendToSubagent(row.sessionId, childId, [userText("resume original")]);
      await entered.promise;
      if (reload) {
        manager.invalidateProjectRuntimes(row.projectId);
        await manager.preload(row.sessionId);
      }
      await manager.startTask(row.sessionId, [userText("another parent task")]);
      await parentEntered.promise;
      let removed = false;
      const removal = Promise.all(manager.beginSessionDeletion(row.sessionId)).then(() => {
        removed = true;
      });
      releaseHandle.resolve();
      await disposing.promise;
      releaseParent.resolve();
      await Promise.resolve();
      expect(removed).toBe(false);
      expect(runs).toBe(0);
      releaseCleanup.resolve();
      expect(await message).toBe("gone");
      await removal;
      expect(removals).toBe(1);
    } finally {
      releaseHandle.resolve();
      releaseParent.resolve();
      releaseCleanup.resolve();
      await manager.shutdown();
      await env.dispose();
      channels.dispose();
      db.close();
    }
  },
);
