import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { abortEvent, requestBegin, requestEnd } from "@prismshadow/penguin-core";
import type {
  ActivityDetail,
  ActivityDraft,
  ActivityRun,
  ActivityRunSummary,
} from "../src/activities/domain.js";
import { ActivityGenerationService } from "../src/activities/generation.js";
import { wire, type ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { ActivityAuthoring } from "../src/mechanisms/activities.js";
import type { ProjectActivityWork } from "../src/mechanisms/projects.js";
import type { Reassembly } from "../src/hmr/capabilities.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import { activitySpec } from "./activity-fixtures.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("activity generation through Harness sessions", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function fixture() {
    let complete: () => void = () => {};
    const waiting = new Set<string>();
    const disposed = new Set<string>();
    let output = JSON.stringify(activitySpec);
    let fatal = false;
    const fakeSession = (row: SessionRow): RuntimeSession => ({
      sessionId: row.sessionId,
      dispose: () => {
        disposed.add(row.sessionId);
      },
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok",
      steer: () => false,
      skipReconnectWait: () => false,
      async *compact() {},
      async *run(_input, options) {
        yield requestBegin();
        await new Promise<void>((resolve) => {
          complete = resolve;
          waiting.add(row.sessionId);
          if (options.signal.aborted) resolve();
          else options.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        if (options.signal.aborted) {
          yield abortEvent();
          return;
        }
        await fs.writeFile(path.join(row.workspace!, "activity-spec.json"), output);
        yield requestEnd(fatal ? "fatal" : "completed");
      },
    });
    const t = await createTestApp();
    // Newly created sessions are adopted directly (the loader is only for resumes).
    // Substitute execution at that seam while retaining real creation and indexing.
    const adopt = t.deps.manager.adopt.bind(t.deps.manager);
    vi.spyOn(t.deps.manager, "adopt").mockImplementation((row) => adopt(row, fakeSession(row)));
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "generator");
    const client = apiClient(t.app, owner.cookie);
    expect((await client.post("/api/projects", { projectId: "generator-activities" })).status).toBe(
      201,
    );
    await t.deps.projectConfigService.writeRaw("generator-activities", {
      default_model: { provider: "custom", model_id: "activity-test" },
      models: [
        {
          provider: "custom",
          model_id: "activity-test",
          api_key: "not-a-real-key",
          base_url: "http://localhost:1/v1",
          client_type: "openai-chat",
        },
      ],
    });
    const base = "/api/projects/generator-activities/activities";
    const activity = (await (
      await client.post(base, { productCode: "p", refNum: 1, title: "One" })
    ).json()) as ActivityDetail;
    const endpoint = `${base}/${activity.id}`;
    const draft = (await (
      await client.patch(`${endpoint}/description`, {
        description: "Teach sight words",
        expectedRevision: activity.draft.contentRevision,
      })
    ).json()) as ActivityDraft;
    const service = t.deps.tree.api<ActivityGenerationService>(
      "ActivitiesModule",
      "ActivityGeneration",
    );
    async function start() {
      const current = (await (await client.get(endpoint)).json()) as ActivityDetail;
      const response = await client.post(`${endpoint}/generate-spec`, {
        agentId: "default_agent",
        expectedRevision: current.draft.contentRevision,
      });
      expect(response.status, await response.clone().text()).toBe(202);
      const run = (await response.json()) as ActivityRun;
      expect(run.status, run.error ?? "").toBe("running");
      await waitFor(() => waiting.has(run.sessionId!));
      return run;
    }
    async function finish(run: ActivityRun, value = JSON.stringify(activitySpec), fail = false) {
      output = value;
      fatal = fail;
      complete();
      await waitFor(() => t.deps.manager.statusOf(run.sessionId!) === "idle");
      await service.reconcile();
      const summary = (
        (await (await client.get(`${endpoint}/runs`)).json()) as { runs: ActivityRunSummary[] }
      ).runs.find((r) => r.runId === run.runId)!;
      const { candidate } = (await (
        await client.get(`${endpoint}/runs/${run.runId}/candidate`)
      ).json()) as { candidate: string | null };
      return { ...summary, candidate };
    }
    return {
      t,
      client,
      activity,
      draft,
      endpoint,
      service,
      start,
      finish,
      disposed,
      endTask: async (run: ActivityRun) => {
        complete();
        await waitFor(() => t.deps.manager.statusOf(run.sessionId!) === "idle");
      },
    };
  }

  it("captures inputs in a separate workspace, then validates, applies and reopens the saved result", async () => {
    const f = await fixture();
    const run = await f.start();
    const session = f.t.deps.sessionsRepo.findById(run.sessionId!)!;
    expect(session.approvalMode).toBe("always-ask");
    expect(session.workspace).toBe(path.join(f.t.root, "activity-runs", run.runId));
    const input = JSON.parse(
      await fs.readFile(path.join(session.workspace!, "input.json"), "utf8"),
    );
    expect(input.draft.description).toBe("Teach sight words");
    expect(input.draft.contentRevision).toBe(f.draft.contentRevision);
    expect((await f.finish(run)).status).toBe("succeeded");
    const reopened = (await (await f.client.get(f.endpoint)).json()) as ActivityDetail;
    expect(reopened.draft.spec).toEqual(activitySpec);
    expect(reopened.draft.status).toBe("valid");
    expect(await f.service.candidate("generator-activities", f.activity.id, run.runId)).toBe(
      JSON.stringify(activitySpec),
    );
  });

  it("preserves a candidate when the draft changes, and starts a fresh retry", async () => {
    const f = await fixture();
    const run = await f.start();
    expect(
      (
        await f.client.post(`${f.endpoint}/generate-spec`, {
          agentId: "default_agent",
          expectedRevision: f.draft.contentRevision,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await f.client.patch(`${f.endpoint}/description`, {
          description: "New instructions",
          expectedRevision: f.draft.contentRevision,
        })
      ).status,
    ).toBe(200);
    const conflict = await f.finish(run);
    expect(conflict.status).toBe("conflict");
    expect(conflict.candidate).toBe(JSON.stringify(activitySpec));
    expect(
      ((await (await f.client.get(f.endpoint)).json()) as ActivityDetail).draft.spec,
    ).toBeNull();
    const retry = await f.start();
    expect(retry.runId).not.toBe(run.runId);
    expect(retry.inputRevision).not.toBe(run.inputRevision);
    expect((await f.finish(retry)).status).toBe("succeeded");
  });

  it("keeps invalid output and a failed model's output without changing the draft", async () => {
    const f = await fixture();
    const invalid = await f.finish(await f.start(), "{bad json");
    expect(invalid.status).toBe("failed");
    expect(invalid.candidate).toBe("{bad json");
    const fatal = await f.finish(await f.start(), JSON.stringify(activitySpec), true);
    expect(fatal.status).toBe("failed");
    expect(fatal.candidate).toBe(JSON.stringify(activitySpec));
    expect(
      ((await (await f.client.get(f.endpoint)).json()) as ActivityDetail).draft.contentRevision,
    ).toBe(f.draft.contentRevision);
  });

  it("cancels without applying and retains terminal history", async () => {
    const f = await fixture();
    const run = await f.start();
    const cancelled = await f.client.post(`${f.endpoint}/runs/${run.runId}/cancel`, {});
    expect(cancelled.status).toBe(200);
    await waitFor(() => f.t.deps.manager.statusOf(run.sessionId!) === "idle");
    await f.service.reconcile();
    expect((await f.service.list("generator-activities", f.activity.id))[0]?.status).toBe(
      "cancelled",
    );
    expect(
      ((await (await f.client.get(f.endpoint)).json()) as ActivityDetail).draft.contentRevision,
    ).toBe(f.draft.contentRevision);
  });

  it("lists compact summaries and authorizes candidate retrieval by project and activity", async () => {
    const f = await fixture();
    const run = await f.start();
    await f.finish(run);
    const response = await f.client.get(`${f.endpoint}/runs`);
    const { runs } = (await response.json()) as { runs: ActivityRunSummary[] };
    expect(runs[0]).toMatchObject({ runId: run.runId, hasCandidate: true, status: "succeeded" });
    expect(runs[0]).not.toHaveProperty("candidate");
    expect(JSON.stringify(runs)).not.toContain(activitySpec.activityDescription);
    const candidateUrl = `${f.endpoint}/runs/${run.runId}/candidate`;
    expect(await (await f.client.get(candidateUrl)).json()).toEqual({
      candidate: JSON.stringify(activitySpec),
    });
    const outsider = await provisionUser(f.t.app, "outsider");
    const other = apiClient(f.t.app, outsider.cookie);
    expect((await other.get(candidateUrl)).status).toBe(404);
    expect((await f.client.post("/api/projects", { projectId: "generator-other" })).status).toBe(
      201,
    );
    expect(
      (await f.client.get(candidateUrl.replace("generator-activities", "generator-other"))).status,
    ).toBe(404);
    const second = (await (
      await f.client.post("/api/projects/generator-activities/activities", {
        productCode: "p",
        refNum: 2,
        title: "Two",
      })
    ).json()) as ActivityDetail;
    expect((await f.client.get(candidateUrl.replace(f.activity.id, second.id))).status).toBe(404);
    expect(
      (await f.client.post("/api/projects/generator-activities/members", { userId: "outsider" }))
        .status,
    ).toBe(201);
    expect((await other.get(candidateUrl)).status).toBe(200);
    // Fill the page with payloads much larger than their metadata. None of these
    // candidate bytes should cross the history endpoint or enter its JSON parsing.
    const large = "x".repeat(256 * 1024);
    for (let i = 0; i < 50; i++) {
      const { candidate: _, ...metadata } = run;
      const stored = { ...metadata, runId: `run_large_${i}`, status: "failed", hasCandidate: true };
      f.t.deps.db
        .prepare(
          "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, record_json) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          stored.runId,
          stored.projectId,
          stored.activityId,
          stored.status,
          stored.createdAt,
          JSON.stringify(stored),
        );
      f.t.deps.db
        .prepare("INSERT INTO activity_run_candidates (run_id, candidate) VALUES (?, ?)")
        .run(stored.runId, large);
    }
    const page = await (await f.client.get(`${f.endpoint}/runs`)).text();
    expect(JSON.parse(page).runs).toHaveLength(50);
    expect(page.length).toBeLessThan(50_000);
    expect(page).not.toContain('"candidate":');
    const records = f.t.deps.db.prepare("SELECT record_json FROM activity_runs").all();
    expect(JSON.stringify(records).length).toBeLessThan(50_000);
  });

  it("retains the session reference and releases a creation that finishes during shutdown", async () => {
    const f = await fixture();
    const createSession = f.t.deps.sessionService.createSession.bind(f.t.deps.sessionService);
    const entered = deferred();
    const release = deferred();
    vi.spyOn(f.t.deps.sessionService, "createSession").mockImplementation(async (...args) => {
      entered.resolve();
      await release.promise;
      return createSession(...args);
    });
    const started = f.client.post(`${f.endpoint}/generate-spec`, {
      agentId: "default_agent",
      expectedRevision: f.draft.contentRevision,
    });
    await entered.promise;
    const stopping = (await f.t.deps.hmr.ensure()).api.shutdown();
    release.resolve();
    await stopping;
    const run = (await (await started).json()) as ActivityRun;
    expect(run.status).toBe("interrupted");
    expect(run.sessionId).not.toBeNull();
    expect(f.t.deps.sessionsRepo.findById(run.sessionId!)).toBeDefined();
    expect(f.disposed.has(run.sessionId!)).toBe(true);
    expect((await f.service.list("generator-activities", f.activity.id))[0]).toMatchObject({
      status: "interrupted",
      sessionId: run.sessionId,
    });
  });

  it.each(["shutdown", "reassembly"] as const)(
    "drains an entered publication before %s finishes",
    async (mode) => {
      const f = await fixture();
      const run = await f.start();
      const activities = f.t.deps.tree.api<ActivityAuthoring>(
        "ActivitiesModule",
        "ActivityAuthoring",
      );
      const apply = activities.applySpec.bind(activities);
      const entered = deferred();
      const release = deferred();
      vi.spyOn(activities, "applySpec").mockImplementation(async (...args) => {
        entered.resolve();
        await release.promise;
        return apply(...args);
      });
      const completion = f.finish(run);
      await entered.promise;
      let drained = false;
      const stopping = (
        mode === "shutdown"
          ? (await f.t.deps.hmr.ensure()).api.shutdown()
          : f.t.deps.tree.api<Reassembly>("RuntimeModule", "Reassembly").reassemble()
      ).then(() => {
        drained = true;
      });
      try {
        await new Promise((resolve) => setTimeout(resolve, 25));
        expect(drained).toBe(false);
        expect((await f.service.list("generator-activities", f.activity.id))[0]?.status).toBe(
          "running",
        );
        expect(
          (await activities.getActivity("generator-activities", f.activity.id)).draft.spec,
        ).toBeNull();
      } finally {
        release.resolve();
      }
      await stopping;
      expect((await completion).status).toBe("succeeded");
      const current = (await (await f.client.get(f.endpoint)).json()) as ActivityDetail;
      expect(current.draft.spec).toEqual(activitySpec);
      expect((await f.service.list("generator-activities", f.activity.id))[0]?.status).toBe(
        "succeeded",
      );
    },
  );

  it("drains an entered publication before deleting a project and rejects new activity writes", async () => {
    const f = await fixture();
    const run = await f.start();
    await f.endTask(run);
    const entered = deferred();
    const release = deferred();
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(to).endsWith("draft.json")) {
        entered.resolve();
        await release.promise;
      }
      return rename(from, to);
    });
    const publication = f.service.reconcile();
    await entered.promise;
    let deleted = false;
    const deletion = Promise.resolve(f.client.delete("/api/projects/generator-activities")).then(
      (response) => {
        deleted = true;
        return response;
      },
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(deleted).toBe(false);
      expect(
        (
          await f.client.patch(`${f.endpoint}/description`, {
            description: "Too late",
            expectedRevision: f.draft.contentRevision,
          })
        ).status,
      ).toBe(409);
    } finally {
      release.resolve();
    }
    await publication;
    expect((await deletion).status).toBe(204);
    await f.service.reconcile();
    expect((await f.client.get(f.endpoint)).status).toBe(404);
    await expect(fs.stat(path.join(f.t.root, "generator-activities"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(f.t.deps.db.prepare("SELECT * FROM activity_runs").all()).toEqual([]);
    expect(f.t.deps.db.prepare("SELECT * FROM activity_run_candidates").all()).toEqual([]);
  });

  it("recovers interrupted attempts without resubmitting or applying their output", async () => {
    const f = await fixture();
    const run = await f.start();
    await f.service.shutdown();
    f.t.deps.manager.abortTask(run.sessionId!);
    await waitFor(() => f.t.deps.manager.statusOf(run.sessionId!) === "idle");
    // Simulate the durable record left by abrupt process termination.
    run.candidate = JSON.stringify(activitySpec);
    f.t.deps.db
      .prepare("INSERT INTO activity_run_candidates (run_id, candidate) VALUES (?, ?)")
      .run(run.runId, run.candidate);
    const { candidate: _, ...metadata } = run;
    f.t.deps.db
      .prepare("UPDATE activity_runs SET status = 'running', record_json = ? WHERE run_id = ?")
      .run(JSON.stringify({ ...metadata, hasCandidate: true }), run.runId);
    const restarted = wire(ActivityGenerationService, {
      config: f.t.deps.config,
      projectWork: f.t.deps.tree.api<ProjectActivityWork>("ProjectsModule", "ProjectActivityWork"),
      db: f.t.deps.db,
      activities: f.t.deps.tree.api<ActivityAuthoring>("ActivitiesModule", "ActivityAuthoring"),
      agents: f.t.deps.agentConfigService,
      sessions: f.t.deps.manager,
      sessionService: f.t.deps.sessionService,
      channels: f.t.deps.channels,
      log: { line: () => {} },
    });
    let dispose: () => void = () => {};
    restarted.setup({
      effect: (fn: () => void) => {
        dispose = fn;
      },
    } as ClassCtx);
    try {
      const recovered = (await restarted.list("generator-activities", f.activity.id))[0]!;
      expect(recovered.status).toBe("interrupted");
      expect(await restarted.candidate("generator-activities", f.activity.id, run.runId)).toBe(
        run.candidate,
      );
      expect(recovered.sessionId).toBe(run.sessionId);
      expect(
        ((await (await f.client.get(f.endpoint)).json()) as ActivityDetail).draft.spec,
      ).toBeNull();
    } finally {
      await restarted.shutdown();
      dispose();
    }
  });
});
