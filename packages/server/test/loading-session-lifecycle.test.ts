/**
 * Given a runtime load paused at the loader boundary, deleting its Session or Project,
 * including recreating that Project ID, must reject the old result and release resources.
 * A live Project accepts the result and records usage once. Concurrent Task requests
 * waiting behind the same load must not revive a deleted Session.
 * Real HTTP routes and SQLite; only the runtime loader is scripted.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { emptyTokenCounts, tokenUsage } from "@prismshadow/penguin-core";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { fakeSession, sessionRow, uniqueSessionId } from "./fixtures/session.js";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let t: TestApp;
let api: ReturnType<typeof apiClient>;
let started = gate();
let release = gate();
let disposed = 0;
let runs = 0;
let loads = 0;
let sequence = 0;

beforeAll(async () => {
  t = await createTestApp({
    loader: {
      async load(row) {
        loads++;
        started.resolve();
        await release.promise;
        return fakeSession(row.sessionId, {
          async *run() {
            runs++;
            const counts = { ...emptyTokenCounts(), output: 2, total: 12 };
            yield tokenUsage(counts, counts);
          },
          dispose() {
            disposed++;
          },
        });
      },
    },
  });
  api = apiClient(t.app, (await provisionUser(t.app, "owner")).cookie);
});
afterAll(async () => t.cleanup());

it.each(["neither", "session", "project", "recreated", "concurrent", "concurrent-load"] as const)(
  "validates the original lifetime after loading across %s removal",
  async (removal) => {
    started = gate();
    release = gate();
    disposed = 0;
    runs = 0;
    loads = 0;
    const projectId = `owner-loading_${++sequence}`;
    expect((await api.post("/api/projects", { projectId, name: "Loading" })).status).toBe(201);
    const sessionId = uniqueSessionId();
    t.deps.sessionsRepo.insert(sessionRow(sessionId, { projectId, workspace: t.root }));
    const task = () =>
      api.post(`/api/sessions/${sessionId}/tasks`, {
        input: [{ type: "text", text: "work" }],
      });
    const first = task();
    await started.promise;
    const second =
      removal === "concurrent"
        ? task()
        : removal === "concurrent-load"
          ? api.post(`/api/sessions/${sessionId}/subagents/child/message`, { text: "work" })
          : undefined;
    try {
      if (removal === "session" || removal === "concurrent") {
        expect((await api.delete(`/api/sessions/${sessionId}`)).status).toBe(204);
      } else if (removal !== "neither") {
        expect((await api.delete(`/api/projects/${projectId}`)).status).toBe(204);
        if (removal === "recreated") {
          expect((await api.post("/api/projects", { projectId, name: "Replacement" })).status).toBe(
            201,
          );
        }
      }
    } finally {
      release.resolve();
    }
    const response = await first;
    if (removal === "neither") {
      expect(response.status).toBeLessThan(300);
      await waitFor(() => t.deps.manager.statusOf(sessionId) === "idle");
      expect(runs).toBe(1);
    } else {
      expect(response.status).toBe(404);
      if (second) expect([404, 409]).toContain((await second).status);
      expect(runs).toBe(0);
      expect(disposed).toBe(1);
      expect(loads).toBe(1);
    }
    expect(
      t.deps.db.prepare("SELECT total FROM usage_records WHERE project_id = ?").all(projectId),
    ).toEqual(removal === "neither" ? [{ total: 12 }] : []);
  },
);
