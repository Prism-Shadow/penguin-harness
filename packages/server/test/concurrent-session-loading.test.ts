/**
 * Concurrent Task and child-message requests must load one runtime and retain its running
 * task until deletion aborts and releases it. A child dispatch paused after loading must
 * not hold the Task admission lock. Both scenarios use real HTTP routes and SQLite.
 */
import { expect, it, vi } from "vitest";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import { fakeSession, sessionRow, uniqueSessionId } from "./fixtures/session.js";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("concurrent public requests share the runtime that deletion cancels", async () => {
  const loading = gate();
  const release = gate();
  const messageEntered = gate();
  const started = gate();
  const finishTask = gate();
  const finished = gate();
  const disposals: number[] = [];
  let signal: AbortSignal | undefined;
  const t = await createTestApp({
    loader: {
      async load(row) {
        const index = disposals.length;
        disposals.push(0);
        loading.resolve();
        if (index === 0) await release.promise;
        else await started.promise;
        return fakeSession(row.sessionId, {
          // eslint-disable-next-line require-yield
          async *run(_input, opts) {
            signal = opts.signal;
            signal.addEventListener("abort", () => finishTask.resolve(), { once: true });
            started.resolve();
            try {
              await finishTask.promise;
            } finally {
              finished.resolve();
            }
          },
          sendToBackgroundSubagent: async () => "gone",
          dispose() {
            disposals[index] = disposals[index]! + 1;
          },
        });
      },
    },
  });
  const api = apiClient(t.app, (await provisionUser(t.app, "owner")).cookie);
  const projectId = "owner-concurrent_load";
  expect((await api.post("/api/projects", { projectId, name: "Concurrent" })).status).toBe(201);
  const id = uniqueSessionId();
  t.deps.sessionsRepo.insert(sessionRow(id, { projectId, workspace: t.root }));
  const send = t.deps.manager.sendToSubagent.bind(t.deps.manager);
  const entered = vi.spyOn(t.deps.manager, "sendToSubagent").mockImplementation((...args) => {
    messageEntered.resolve();
    return send(...args);
  });
  try {
    const task = api.post(`/api/sessions/${id}/tasks`, { input: [{ type: "text", text: "work" }] });
    await loading.promise;
    const message = api.post(`/api/sessions/${id}/subagents/child/message`, { text: "work" });
    await messageEntered.promise;
    // Let both HTTP handlers reach their load boundary before releasing the first load.
    await new Promise<void>((resolve) => setImmediate(resolve));
    release.resolve();
    expect((await task).status).toBe(202);
    await started.promise;
    expect((await message).status).toBe(404);
    expect(t.deps.manager.statusOf(id)).toBe("running");
    expect((await api.delete(`/api/sessions/${id}`)).status).toBe(204);
    expect(signal?.aborted).toBe(true);
    expect(disposals).toEqual([1]);
  } finally {
    entered.mockRestore();
    release.resolve();
    finishTask.resolve();
    await finished.promise;
    await t.cleanup();
  }
});

it("a child dispatch waiting after its load does not hold the Task admission lock", async () => {
  const dispatching = gate();
  const releaseDispatch = gate();
  const running = gate();
  let loads = 0;
  let disposed = 0;
  const t = await createTestApp({
    loader: {
      async load(row) {
        loads++;
        return fakeSession(row.sessionId, {
          // eslint-disable-next-line require-yield
          async *run() {
            running.resolve();
          },
          async sendToBackgroundSubagent() {
            dispatching.resolve();
            await releaseDispatch.promise;
            return "gone";
          },
          dispose() {
            disposed++;
          },
        });
      },
    },
  });
  const api = apiClient(t.app, (await provisionUser(t.app, "owner")).cookie);
  const projectId = "owner-dispatch_lock";
  expect((await api.post("/api/projects", { projectId, name: "Dispatch" })).status).toBe(201);
  const id = uniqueSessionId();
  t.deps.sessionsRepo.insert(sessionRow(id, { projectId, workspace: t.root }));
  const message = api.post(`/api/sessions/${id}/subagents/child/message`, { text: "work" });
  try {
    await dispatching.promise;
    expect(
      (
        await api.post(`/api/sessions/${id}/tasks`, {
          input: [{ type: "text", text: "work" }],
        })
      ).status,
    ).toBe(202);
    await running.promise;
    expect(loads).toBe(1);
    expect((await api.delete(`/api/sessions/${id}`)).status).toBe(204);
    expect(disposed).toBe(1);
  } finally {
    releaseDispatch.resolve();
    await message;
    await t.cleanup();
  }
});
