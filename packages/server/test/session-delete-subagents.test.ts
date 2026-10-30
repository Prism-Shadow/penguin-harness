/**
 * Deleting a Session waits for its background children's cancellation writes before removing
 * their Traces, whether the parent is idle or running. Stopping only the parent's Task leaves
 * a background child running, as intended.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { Session, Environment, Writer, tracesDir } from "@prismshadow/penguin-core";
import type { AmspRecord, SessionMetaPayload } from "@prismshadow/amsp/records";
import {
  requestBegin,
  subagentEvent,
  toolCall,
  userText,
  withOrigin,
} from "@prismshadow/amsp/records";
import type { LLMInterface, SubagentHandle } from "@prismshadow/penguin-core";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { adoptSession, fakeSession, sessionRow, uniqueSessionId } from "./fixtures/session.js";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let t: TestApp;
let api: ReturnType<typeof apiClient>;
const projectId = "owner-default_project";
beforeAll(async () => {
  t = await createTestApp();
  api = apiClient(t.app, (await provisionUser(t.app, "owner")).cookie);
});
afterAll(async () => {
  await t.cleanup();
});

async function setup(running: boolean, agentId = "default_agent") {
  const parentId = uniqueSessionId();
  const childId = uniqueSessionId();
  const releaseCleanup = gate();
  let childSignal: AbortSignal | undefined;
  let childDisposed = false;
  const childWriter = new Writer({
    tracesDir: tracesDir(t.root, projectId, agentId),
    sessionId: childId,
  });
  const meta: SessionMetaPayload = {
    session_id: childId,
    provider: "custom",
    model_id: "m1",
    model_context_window: 1000,
    system_prompt: "test",
    agent_state: t.root,
    workspace: t.root,
    source: "subagent",
  };
  const llm: LLMInterface = {
    async *streamGenerate(params) {
      childSignal = params.signal;
      yield requestBegin();
      await new Promise<void>((resolve) => {
        if (params.signal?.aborted) resolve();
        else params.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      // A cooperative provider has received cancellation, but still has async cleanup.
      await releaseCleanup.promise;
      return { status: "aborted", errorCode: "user_abort" };
    },
  };
  const child = new Session({
    meta,
    bootstrap: async () => ({ llm }),
    trace: childWriter,
    imagesDir: path.join(t.root, "probe-images", childId),
    modelHasVision: true,
    environment: {
      listTools: async () => [],
      toolPermission: () => undefined,
      async *executeTool() {
        throw new Error("unexpected tool");
      },
      dispose: () => {
        childDisposed = true;
      },
    },
  });
  await childWriter.write(child.metaMessage);
  t.deps.sessionsRepo.insert(
    sessionRow(childId, { projectId, agentId, createdAt: "2026-01-01T00:00:00.000Z" }),
  );
  const handle: SubagentHandle = {
    sessionId: childId,
    async *run({ messages, signal, approve }) {
      const iterator = child.run(messages, { signal, approve });
      for (;;) {
        const next = await iterator.next();
        if (next.done) return next.value;
        yield withOrigin(next.value, childId);
      }
    },
    dispose: () => child.dispose(),
  };
  const env = new Environment({
    workspaceDir: t.root,
    toolConfig: {
      customTools: [{ name: "run_subagent", description: "test", permission: "rw" }],
      mcpServers: [],
    },
    services: { subagentRunner: { spawn: async () => handle } },
  });
  adoptSession(
    t.deps,
    fakeSession(parentId, {
      dispose: () => env.dispose(),
      listBackgroundSubagents: () => env.listBackgroundSubagents(),
      async *run(_input, { signal }) {
        yield requestBegin();
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    }),
    { projectId, agentId, createdAt: "2026-01-01T00:00:00.000Z" },
  );
  const parentWriter = new Writer({
    tracesDir: tracesDir(t.root, projectId, agentId),
    sessionId: parentId,
  });
  await parentWriter.write({
    ...child.metaMessage,
    payload: { ...meta, session_id: parentId, source: "user" },
  } as AmspRecord);
  await parentWriter.write(subagentEvent(childId));
  for await (const msg of env.executeTool({
    toolCall: toolCall({
      name: "run_subagent",
      toolCallId: "probe",
      arguments: JSON.stringify({ prompt: "work", run_in_background: true }),
    }),
  }))
    void msg;
  await waitFor(() => childSignal !== undefined);
  expect(env.listBackgroundSubagents().filter((s) => s.running)).toHaveLength(1);
  if (running) {
    await t.deps.manager.startTask(parentId, [userText("parent task")]);
    await waitFor(() => t.deps.manager.statusOf(parentId) === "running");
  }
  return {
    parentId,
    childId,
    childWriter,
    env,
    releaseCleanup,
    aborted: () => childSignal?.aborted ?? false,
    disposed: () => childDisposed,
  };
}

it("stopping only the parent preserves its background child by design", async () => {
  const p = await setup(true);
  try {
    expect(t.deps.manager.abortTask(p.parentId)).toBe(true);
    await waitFor(() => t.deps.manager.statusOf(p.parentId) === "idle");
    expect(p.aborted()).toBe(false);
    expect(p.env.listBackgroundSubagents().some((s) => s.running)).toBe(true);
  } finally {
    p.releaseCleanup.resolve();
    await api.delete(`/api/sessions/${p.parentId}`);
    await waitFor(p.disposed);
  }
});

it("Agent DELETE cancels and drains its child's cleanup through the real route", async () => {
  const agentId = "cleanup_agent";
  expect((await api.post(`/api/projects/${projectId}/agents`, { agentId })).status).toBe(201);
  const p = await setup(false, agentId);
  try {
    const deletion = api.delete(`/api/projects/${projectId}/agents/${agentId}`);
    await waitFor(p.aborted);
    expect(p.disposed()).toBe(false);
    p.releaseCleanup.resolve();
    // Current main accepts the background directory purge after logical deletion.
    expect((await deletion).status).toBe(202);
    await waitFor(p.disposed);
    expect(t.deps.sessionsRepo.findById(p.parentId)).toBeNull();
    expect(t.deps.sessionsRepo.findById(p.childId)).toBeNull();
    expect(await fs.readFile(p.childWriter.currentPath(), "utf8").catch(() => null)).toBeNull();
  } finally {
    p.releaseCleanup.resolve();
    await p.env.dispose();
  }
});

it.each([false, true])(
  "deleting a parent (running=%s) leaves no child Trace after cancellation cleanup",
  async (running) => {
    const p = await setup(running);
    try {
      const deletion = api.delete(`/api/sessions/${p.parentId}`);
      await waitFor(p.aborted);
      expect(p.aborted()).toBe(true);
      expect(p.disposed()).toBe(false);
      // The files must stay available while cancellation still has records to write.
      expect(t.deps.sessionsRepo.findById(p.childId)).not.toBeNull();
      await fs.stat(p.childWriter.currentPath());
      p.releaseCleanup.resolve();
      expect((await deletion).status).toBe(204);
      expect(p.disposed()).toBe(true);
      expect(t.deps.sessionsRepo.findById(p.childId)).toBeNull();
      // The real child Session/engine writes request_end, abort and task_end during cleanup.
      // None of those should recreate a Trace belonging to an already-deleted Session.
      const contents = await fs.readFile(p.childWriter.currentPath(), "utf8").catch(() => null);
      expect(contents).toBeNull();
    } finally {
      p.releaseCleanup.resolve();
      p.env.dispose();
      await waitFor(p.disposed);
    }
  },
);
