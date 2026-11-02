/**
 * A host resume that returns after Environment deletion releases its handle before answering
 * gone. A live host resume still starts once. A model's revival of an evicted child follows
 * the same rule when its tool is cancelled or its manager is disposed during the resume.
 * Cleanup itself is gated: refusing a late handle must wait for its asynchronous release.
 */
import { expect, it } from "vitest";
import { Environment } from "../src/environment/index.js";
import { createInputSubagentTool } from "../src/environment/tools/input-subagent.js";
import {
  ManagedSubagentSession,
  SubagentSessionManager,
} from "../src/environment/tools/subagent/index.js";
import { userText } from "@prismshadow/amsp/records";
import type { SubagentHandle } from "../src/interfaces/index.js";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it.each([false, true])(
  "host resume releases its handle exactly once: removed=%s",
  async (removed) => {
    const entered = gate();
    const release = gate();
    const finished = gate();
    const disposing = gate();
    const cleanup = gate();
    let disposals = 0;
    let runs = 0;
    let returned = false;
    const handle: SubagentHandle = {
      sessionId: "session-resume-12345678",
      // eslint-disable-next-line require-yield
      async *run() {
        runs++;
        finished.resolve();
        return null;
      },
      async dispose() {
        disposing.resolve();
        await cleanup.promise;
        disposals++;
      },
    };
    const env = new Environment({
      workspaceDir: process.cwd(),
      toolConfig: { customTools: [], mcpServers: [] },
      services: {
        subagentRunner: {
          async spawn() {
            throw new Error("unexpected spawn");
          },
          async resume() {
            entered.resolve();
            await release.promise;
            return handle;
          },
        },
      },
    });
    const result = env
      .sendToBackgroundSubagent(handle.sessionId, [userText("continue")], {
        resume: { agentId: "default_agent" },
      })
      .then((value) => {
        returned = true;
        return value;
      });
    void result.catch(() => {});
    let disposal: Promise<void> | undefined;
    try {
      await entered.promise;
      if (removed) await env.dispose();
      release.resolve();
      if (!removed) {
        expect(await result).toBe("resumed");
        await finished.promise;
        disposal = env.dispose();
      }
      await disposing.promise;
      if (removed) expect(returned).toBe(false);
      expect(disposals).toBe(0);
      expect(runs).toBe(removed ? 0 : 1);
    } finally {
      release.resolve();
      cleanup.resolve();
      await Promise.allSettled([result, disposal, env.dispose()]);
    }
    expect(await result).toBe(removed ? "gone" : "resumed");
    expect(disposals).toBe(1);
    expect(env.listBackgroundSubagents()).toEqual([]);
  },
);

it.each(["live", "cancelled", "disposed"] as const)(
  "model revival releases its handle: %s",
  async (removal) => {
    const manager = new SubagentSessionManager();
    // Registering nine completed children evicts the first under the normal admission policy.
    let first = "";
    for (let index = 0; index < 9; index++) {
      const session = new ManagedSubagentSession({
        sessionId: `session-${index.toString().padStart(8, "0")}`,
        // eslint-disable-next-line require-yield
        async *run() {
          return null;
        },
        dispose() {},
      });
      manager.track(session);
      const id = manager.register(session);
      if (index === 0) first = id;
    }
    expect(manager.get(first)).toBeUndefined();
    const entered = gate();
    const release = gate();
    const disposing = gate();
    const cleanup = gate();
    let runs = 0;
    let disposals = 0;
    let completed = false;
    const control = new AbortController();
    const tool = createInputSubagentTool(
      { name: "input_subagent", description: "continue", permission: "rw" },
      {
        subagentSessions: manager,
        subagentRunner: {
          async spawn() {
            throw new Error("unexpected spawn");
          },
          async resume({ sessionId }) {
            entered.resolve();
            await release.promise;
            return {
              sessionId,
              // eslint-disable-next-line require-yield
              async *run() {
                runs++;
                return null;
              },
              async dispose() {
                disposing.resolve();
                await cleanup.promise;
                disposals++;
              },
            };
          },
        },
      },
    );
    const result = (async () => {
      const iterator = tool.execute(
        { subagent_id: first, prompt: "continue", yield_time_ms: 0 },
        {
          workspaceDir: process.cwd(),
          toolCallId: "revive",
          signal: control.signal,
        },
      );
      for (;;) {
        const next = await iterator.next();
        if (next.done) {
          completed = true;
          return next.value;
        }
      }
    })();
    void result.catch(() => {});
    try {
      await entered.promise;
      if (removal === "cancelled") control.abort();
      if (removal === "disposed") await manager.dispose();
      release.resolve();
      if (removal === "live") {
        await result;
        void manager.dispose();
      }
      await disposing.promise;
      if (removal !== "live") expect(completed).toBe(false);
      expect(disposals).toBe(0);
      expect(runs).toBe(removal === "live" ? 1 : 0);
    } finally {
      release.resolve();
      cleanup.resolve();
      await Promise.allSettled([result, manager.dispose()]);
    }
    expect(disposals).toBe(1);
    expect((await result)?.status).toBe(removal === "live" ? "completed" : "aborted");
    expect(manager.listLive()).toEqual([]);
  },
);
