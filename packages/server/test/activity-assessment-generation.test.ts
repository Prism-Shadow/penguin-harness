/**
 * Generating an assessment through a Harness Session: refused where there is no assessment to
 * write or the ref does not own it; a run's files are normalized, checked against the
 * questions it said the screens imply, and accepted as the product's assessment edit, which
 * the preview then asks from.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestBegin, requestEnd } from "@prismshadow/penguin-core";
import type { ActivityDetail, ActivityDraft, ActivityRun } from "../src/activities/domain.js";
import type { ModuleDocuments } from "../src/activities/module-documents.js";
import type { ActivityGenerationService } from "../src/activities/generation.js";
import { ActivitySandboxService } from "../src/activities/sandbox-service.js";
import type { ActivityAuthoring, ActivityGeneration } from "../src/mechanisms/activities.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import { activitySpec } from "./activity-fixtures.js";

// A product code no WAF checkout on the machine has, so the module source is Penguin's own.
const PRODUCT = "zz-assess-gen";
const assessedSpec = {
  ...activitySpec,
  id: PRODUCT,
  runtime: { ...activitySpec.runtime, usesAssessment: true },
  scenes: [
    { id: "pick-cat", description: "The learner picks cat from cat, cot and cut." },
    { id: "pick-dog", description: "The learner picks dog from dog and dig." },
  ],
};

const choice = (id: string, text: string, isCorrect: boolean) => ({
  id,
  isCorrect,
  value: { text },
});
const item = (question: string, choices: ReturnType<typeof choice>[]) => ({
  interactionKey: "SIMPLE_CHOICE",
  configuration: { question: { text: question }, simpleChoice: choices },
});
const hints = {
  items: [
    { sceneId: "pick-cat", source: "selection", choices: ["cat", "cot", "cut"], correct: "cat" },
    { sceneId: "pick-dog", source: "selection", choices: ["dog", "dig"], correct: "dog" },
  ],
};
const good = {
  items: [
    item("Which word is cat?", [
      choice("a", "cat", true),
      choice("b", "cot", false),
      choice("c", "cut", false),
    ]),
    item("Which word is dog?", [choice("a", "Dog.", true), choice("b", "dig", false)]),
  ],
};

describe("assessment generation", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup() {
    let complete: () => void = () => {};
    const waiting = new Set<string>();
    let output: { hints: unknown; assessment: unknown } = { hints, assessment: good };
    const seen: Record<string, string | null>[] = [];
    const fakeSession = (row: SessionRow): RuntimeSession => ({
      sessionId: row.sessionId,
      dispose: () => {},
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
        const read = (name: string) =>
          fs.readFile(path.join(row.workspace!, name), "utf8").catch(() => null);
        seen.push({
          skill: await read("assessment-skill.md"),
          spec: await read("activity-spec.json"),
          current: await read("current-assessment.json"),
        });
        const write = (name: string, value: unknown) =>
          value === undefined
            ? Promise.resolve()
            : fs.writeFile(
                path.join(row.workspace!, name),
                typeof value === "string" ? value : JSON.stringify(value),
              );
        await write("assessment-hints.json", output.hints);
        await write("assessment.json", output.assessment);
        yield requestEnd("completed");
      },
    });
    const t = await createTestApp();
    const adopt = t.deps.manager.adopt.bind(t.deps.manager);
    vi.spyOn(t.deps.manager, "adopt").mockImplementation((row) => adopt(row, fakeSession(row)));
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "assessor");
    const client = apiClient(t.app, owner.cookie);
    const made = await client.post("/api/projects", { projectId: "assessor-work" });
    expect(made.status, await made.clone().text()).toBe(201);
    await t.deps.projectConfigService.writeRaw("assessor-work", {
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
    const base = "/api/projects/assessor-work/activities";
    const service = t.deps.tree.api<ActivityGenerationService>(
      "ActivitiesModule",
      "ActivityGeneration",
    );
    const create = async (refNum: number, spec: unknown = assessedSpec) => {
      const response = await client.post(base, { productCode: PRODUCT, refNum, title: "Ref" });
      expect(response.status, await response.clone().text()).toBe(201);
      const activity = (await response.json()) as ActivityDetail;
      const saved = await client.post(`${base}/${activity.id}/apply-generated-spec`, {
        spec,
        expectedRevision: activity.draft.contentRevision,
      });
      expect(saved.status, await saved.clone().text()).toBe(200);
      return { ...activity, draft: (await saved.json()) as ActivityDraft };
    };
    const generate = (activity: { id: string; draft: ActivityDraft }) =>
      client.post(`${base}/${activity.id}/generate-assessment`, {
        agentId: "default_agent",
        expectedRevision: activity.draft.contentRevision,
      });
    async function run(activity: { id: string; draft: ActivityDraft }, next = output) {
      output = next;
      const response = await generate(activity);
      expect(response.status, await response.clone().text()).toBe(202);
      const started = (await response.json()) as ActivityRun;
      expect(started).toMatchObject({ kind: "assessment", status: "running" });
      await waitFor(() => waiting.has(started.sessionId!));
      complete();
      await waitFor(() => t.deps.manager.statusOf(started.sessionId!) === "idle");
      await service.reconcile();
      const runs = (
        (await (await client.get(`${base}/${activity.id}/runs`)).json()) as {
          runs: ActivityRun[];
        }
      ).runs;
      const { candidate } = (await (
        await client.get(`${base}/${activity.id}/runs/${started.runId}/candidate`)
      ).json()) as { candidate: string | null };
      return { ...runs.find((entry) => entry.runId === started.runId)!, candidate };
    }
    return { t, client, base, create, generate, run, seen };
  }

  it("refuses an activity with no assessment, and a ref that does not own it", async () => {
    const { create, generate } = await setup();
    const unused = await create(1, { ...assessedSpec, runtime: activitySpec.runtime });
    const refused = await generate(unused);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "assessment_unused" } });

    const second = await create(2);
    const notCanonical = await generate(second);
    expect(notCanonical.status).toBe(409);
    expect(await notCanonical.json()).toMatchObject({ error: { code: "not_canonical" } });
  });

  it("normalizes a good run, stages what it reads, and accepts it as the assessment the preview asks", async () => {
    const { t, client, base, create, run, seen } = await setup();
    const one = await create(1);
    const result = await run(one);
    expect(result.status, result.error ?? "").toBe("succeeded");
    expect(seen[0]!.skill).toContain("waf-assessment-patterns");
    expect(JSON.parse(seen[0]!.spec!)).toMatchObject({ id: PRODUCT });
    // Nothing in effect yet, so nothing to update.
    expect(seen[0]!.current).toBeNull();
    const candidate = JSON.parse(result.candidate!);
    expect(candidate).toMatchObject({
      title: `${PRODUCT}-1`,
      configuration: { maxItems: 2, nextItemsSize: 1 },
      behavior: "LINEAR",
    });
    expect(candidate.items[1]).toMatchObject({
      title: `${PRODUCT}-1-2`,
      configuration: {
        simpleChoice: [
          { id: "a", isCorrect: true, score: 1, value: { text: "Dog." } },
          { id: "b", isCorrect: false, score: 0 },
        ],
      },
    });

    // Accepting on a changed draft is refused; on the draft it came from, it is kept.
    const stale = await client.post(`${base}/${one.id}/runs/${result.runId}/accept-assessment`, {
      expectedRevision: "other",
    });
    expect(stale.status).toBe(409);
    const accepted = await client.post(`${base}/${one.id}/runs/${result.runId}/accept-assessment`, {
      expectedRevision: one.draft.contentRevision,
    });
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    const draft = (await accepted.json()) as ActivityDraft;
    expect(draft.moduleDocuments?.assessment?.value).toEqual(candidate);
    const documents = (await (
      await client.get(`${base}/${one.id}/module-documents`)
    ).json()) as ModuleDocuments;
    expect(documents.assessment).toMatchObject({ edited: true, stale: false, value: candidate });

    // A second run is handed the assessment now in effect, to update rather than replace.
    const again = await run({ ...one, draft });
    expect(again.status, again.error ?? "").toBe("succeeded");
    expect(JSON.parse(seen[1]!.current!)).toEqual(candidate);

    // The preview asks the accepted questions.
    const runId = "run_assessed_module";
    const moduleDir = path.join(t.root, "activity-runs", runId, "module");
    await fs.mkdir(moduleDir, { recursive: true });
    await fs.writeFile(path.join(moduleDir, "definition.json"), "{}", "utf8");
    t.deps.db
      .prepare(
        "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES (?, 'assessor-work', ?, 'succeeded', '2026-09-25', 'module', ?)",
      )
      .run(
        runId,
        one.id,
        JSON.stringify({ runId, status: "succeeded", kind: "module", createdAt: "2026-09-25" }),
      );
    const sandbox = new ActivitySandboxService();
    Object.assign(sandbox, {
      activities: t.deps.tree.api<ActivityAuthoring>("ActivitiesModule", "ActivityAuthoring"),
      generation: t.deps.tree.api<ActivityGeneration>("ActivitiesModule", "ActivityGeneration"),
      config: { root: t.root },
      locateWafRoot: async () => null,
    });
    const part = await sandbox.assess("assessor-work", one.id, "/base/", null, []);
    expect(JSON.stringify(part)).toContain("Which word is cat?");
  });

  it("fails a run that drops a question the screens imply, naming it", async () => {
    const { create, run } = await setup();
    const one = await create(1);
    const result = await run(one, { hints, assessment: { items: [good.items[0]] } });
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/missing 1 expected item: pick-dog selection dog \(dog, dig\)/);
    expect(result.candidate).toBeNull();
  });

  it("fails a run whose files are missing or not an assessment", async () => {
    const { create, run } = await setup();
    const one = await create(1);
    const missing = await run(one, { hints, assessment: undefined });
    expect(missing.status).toBe("failed");
    expect(missing.error).toMatch(/without assessment\.json or assessment-hints\.json/);
    const broken = await run(one, {
      hints,
      assessment: { items: [{ ...good.items[0], interactionKey: "ORDER" }] },
    });
    expect(broken.status).toBe("failed");
    expect(broken.error).toMatch(/only SIMPLE_CHOICE and MULTIPLE_RESPONSE_CHOICE/);
    const notJson = await run(one, { hints: "{", assessment: good });
    expect(notJson.status).toBe("failed");
    expect(notJson.error).toMatch(/assessment-hints\.json is not valid JSON/);
  });
});
