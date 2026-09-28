/**
 * Editing the module's configuration and assessment through the API: the edit is kept in the
 * draft, read back in place of the module's own document, reported stale when what it came
 * from changes, shared from the canonical ref, and discarded back to the exact old revision.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ActivityDetail, ActivityDraft } from "../src/activities/domain.js";
import type { ModuleDocuments } from "../src/activities/module-documents.js";
import { ActivitySandboxService } from "../src/activities/sandbox-service.js";
import type { ActivityAuthoring, ActivityGeneration } from "../src/mechanisms/activities.js";
import { activitySpec } from "./activity-fixtures.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

// A product code no WAF checkout on the machine has, so the module source is Penguin's own.
const PRODUCT = "zz-edit-docs";
const spec = { ...activitySpec, id: PRODUCT };
const configuration = { [PRODUCT]: { telemetry: false, rounds: 5 } };
const choice = (id: string, isCorrect: boolean) => ({ id, isCorrect });
const assessment = {
  items: [
    {
      title: "first",
      configuration: { simpleChoice: [choice("a", true), choice("b", false)] },
    },
  ],
};

describe("module document edits", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup() {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "editor");
    const client = apiClient(t.app, owner.cookie);
    expect((await client.post("/api/projects", { projectId: "editor-work" })).status).toBe(201);
    const base = "/api/projects/editor-work/activities";
    const create = async (refNum: number) => {
      const response = await client.post(base, {
        productCode: PRODUCT,
        refNum,
        title: `Ref ${refNum}`,
      });
      expect(response.status, await response.clone().text()).toBe(201);
      return (await response.json()) as ActivityDetail;
    };
    const documents = async (id: string, as = client) => {
      const response = await as.get(`${base}/${id}/module-documents`);
      expect(response.status, await response.clone().text()).toBe(200);
      return (await response.json()) as ModuleDocuments;
    };
    const put = (id: string, kind: string, value: unknown, expectedRevision: string) =>
      client.put(`${base}/${id}/module-documents/${kind}`, { value, expectedRevision });
    const discard = (id: string, kind: string, expectedRevision: string) =>
      client.post(`${base}/${id}/module-documents/${kind}/discard`, { expectedRevision });
    const specify = async (id: string, revision: string, value: unknown = spec) => {
      const response = await client.post(`${base}/${id}/apply-generated-spec`, {
        spec: value,
        expectedRevision: revision,
      });
      expect(response.status, await response.clone().text()).toBe(200);
      return (await response.json()) as ActivityDraft;
    };
    const plan = async (id: string, revision: string) => {
      const response = await client.post(`${base}/${id}/plan-media`, {
        expectedRevision: revision,
      });
      expect(response.status, await response.clone().text()).toBe(200);
      return (await response.json()) as ActivityDraft;
    };
    return { t, client, base, create, documents, put, discard, specify, plan };
  }

  it("keeps a configuration edit in the draft, reads it back, and discards it to the old revision", async () => {
    const { t, create, documents, put, specify, plan } = await setup();
    const one = await create(1);
    const specced = await specify(one.id, one.draft.contentRevision);
    const planned = await plan(one.id, specced.contentRevision);

    const saved = await put(one.id, "configuration", configuration, planned.contentRevision);
    expect(saved.status, await saved.clone().text()).toBe(200);
    const edited = (await saved.json()) as ActivityDraft;
    expect(edited.contentRevision).not.toBe(planned.contentRevision);
    expect(edited.moduleDocuments?.configuration?.value).toEqual(configuration);

    let read = await documents(one.id);
    expect(read.source).toBe("draft");
    expect(read.configuration).toEqual({
      file: `configurations/${PRODUCT}-1.json`,
      value: configuration,
      edited: true,
      stale: false,
      editable: true,
    });

    // The edit lives in the draft, which is Penguin's, not in any checkout.
    const draftFile = path.join(
      t.deps.tree
        .api<ActivityAuthoring>("ActivitiesModule", "ActivityAuthoring")
        .draftWorkspace("editor-work", one.collectionId, one.id, one.draft.draftId),
      "draft.json",
    );
    expect(
      JSON.parse(await fs.readFile(draftFile, "utf8")).moduleDocuments.configuration.value,
    ).toEqual(configuration);

    // A stale revision is refused.
    const stale = await put(one.id, "configuration", {}, planned.contentRevision);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "draft_conflict" } });

    // A new plan from a changed specification leaves the edit stale, and still used.
    const respecced = await specify(one.id, edited.contentRevision, {
      ...spec,
      scenes: [
        {
          id: "intro",
          description: "Look",
          media: { images: [{ key: "cat", description: "A cat" }] },
        },
      ],
    });
    await plan(one.id, respecced.contentRevision);
    read = await documents(one.id);
    expect(read.configuration).toMatchObject({ value: configuration, edited: true, stale: true });
  });

  it("does not report a configuration edit stale when only the ref is renumbered", async () => {
    const { client, base, create, documents, put, specify, plan } = await setup();
    const one = await create(1);
    const specced = await specify(one.id, one.draft.contentRevision);
    const planned = await plan(one.id, specced.contentRevision);
    const saved = (await (
      await put(one.id, "configuration", configuration, planned.contentRevision)
    ).json()) as ActivityDraft;
    const renumbered = await client.post(`${base}/${one.id}/ref-number`, {
      refNum: 7,
      expectedRevision: saved.contentRevision,
    });
    expect(renumbered.status, await renumbered.clone().text()).toBe(200);
    expect((await documents(one.id)).configuration).toMatchObject({
      value: configuration,
      edited: true,
      stale: false,
    });
  });

  it("saves an assessment that keeps a problem the module's own file already had", async () => {
    const { t, create, documents, put } = await setup();
    const one = await create(1);
    const twoCorrect = {
      title: "q",
      configuration: { simpleChoice: [choice("a", true), choice("b", true)] },
    };
    const runId = "run_one_module";
    const moduleDir = path.join(t.root, "activity-runs", runId, "module");
    await fs.mkdir(path.join(moduleDir, "assessments"), { recursive: true });
    await fs.writeFile(path.join(moduleDir, "definition.json"), "{}", "utf8");
    await fs.writeFile(
      path.join(moduleDir, "assessments", `${PRODUCT}-1.json`),
      JSON.stringify({ items: [twoCorrect] }),
      "utf8",
    );
    t.deps.db
      .prepare(
        "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES (?, 'editor-work', ?, 'succeeded', '2026-09-25', 'module', ?)",
      )
      .run(
        runId,
        one.id,
        JSON.stringify({ runId, status: "succeeded", kind: "module", createdAt: "2026-09-25" }),
      );
    expect((await documents(one.id)).assessment).toMatchObject({ edited: false });

    const kept = { items: [{ ...twoCorrect, prompt: "changed" }] };
    const saved = await put(one.id, "assessment", kept, one.draft.contentRevision);
    expect(saved.status, await saved.clone().text()).toBe(200);
    const draft = (await saved.json()) as ActivityDraft;

    // A problem the edit introduces is still refused.
    const introduced = await put(
      one.id,
      "assessment",
      { items: [...kept.items, { ...twoCorrect, title: "r" }] },
      draft.contentRevision,
    );
    expect(introduced.status).toBe(422);
    expect(await introduced.json()).toMatchObject({
      error: {
        code: "document_invalid",
        message: "Item 2 is a single choice, so it needs exactly one correct choice.",
      },
    });
  });

  it("discards back to the exact revision a draft had before it was edited", async () => {
    const { create, documents, put, discard } = await setup();
    const one = await create(1);
    const before = one.draft.contentRevision;
    const edited = (await (
      await put(one.id, "configuration", configuration, before)
    ).json()) as ActivityDraft;
    const dropped = await discard(one.id, "configuration", edited.contentRevision);
    expect(dropped.status, await dropped.clone().text()).toBe(200);
    const after = (await dropped.json()) as ActivityDraft;
    expect(after.contentRevision).toBe(before);
    expect(after.moduleDocuments).toBeUndefined();
    const read = await documents(one.id);
    expect(read.configuration).toBeNull();
    expect(read.source).toBeNull();
  });

  it("edits the assessment on the canonical ref only, validated, and serves it to every ref", async () => {
    const { t, create, documents, put } = await setup();
    const one = await create(1);
    const two = await create(2);

    const refused = await put(two.id, "assessment", assessment, two.draft.contentRevision);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "not_canonical" } });

    const invalid = await put(
      one.id,
      "assessment",
      {
        items: [
          { title: "q", configuration: { simpleChoice: [choice("a", true), choice("b", true)] } },
        ],
      },
      one.draft.contentRevision,
    );
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({
      error: {
        code: "document_invalid",
        message: "Item 1 is a single choice, so it needs exactly one correct choice.",
      },
    });

    const saved = await put(one.id, "assessment", assessment, one.draft.contentRevision);
    expect(saved.status, await saved.clone().text()).toBe(200);

    const onTwo = await documents(two.id);
    expect(onTwo.canonicalRefNum).toBe(1);
    expect(onTwo.assessment).toEqual({
      file: `assessments/${PRODUCT}-1.json`,
      value: assessment,
      edited: true,
      stale: false,
      editable: false,
    });
    expect((await documents(one.id)).assessment).toMatchObject({ edited: true, editable: true });

    // A preview of ref 2 asks the canonical ref's edited questions.
    const runId = "run_two_module";
    const moduleDir = path.join(t.root, "activity-runs", runId, "module");
    await fs.mkdir(moduleDir, { recursive: true });
    await fs.writeFile(path.join(moduleDir, "definition.json"), "{}", "utf8");
    t.deps.db
      .prepare(
        "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES (?, 'editor-work', ?, 'succeeded', '2026-09-25', 'module', ?)",
      )
      .run(
        runId,
        two.id,
        JSON.stringify({ runId, status: "succeeded", kind: "module", createdAt: "2026-09-25" }),
      );
    // The sandbox is not exported from its module; it is stood up over the real services.
    const sandbox = new ActivitySandboxService();
    Object.assign(sandbox, {
      activities: t.deps.tree.api<ActivityAuthoring>("ActivitiesModule", "ActivityAuthoring"),
      generation: t.deps.tree.api<ActivityGeneration>("ActivitiesModule", "ActivityGeneration"),
      config: { root: t.root },
      locateWafRoot: async () => null,
    });
    const part = (await sandbox.assess("editor-work", two.id, "/base/", null, [])) as {
      assessmentItems?: { title?: string }[];
      [key: string]: unknown;
    };
    expect(JSON.stringify(part)).toContain('"first"');
  });

  it("lets a member read but not edit, and refuses an unknown document", async () => {
    const { t, client, base, create, documents, put } = await setup();
    const one = await create(1);
    await put(one.id, "configuration", configuration, one.draft.contentRevision);
    const member = await provisionUser(t.app, "viewer");
    expect(
      (await client.post("/api/projects/editor-work/members", { userId: "viewer" })).status,
    ).toBe(201);
    const reader = apiClient(t.app, member.cookie);
    const read = await documents(one.id, reader);
    expect(read.configuration).toMatchObject({ edited: true, editable: false });
    expect(
      (
        await reader.put(`${base}/${one.id}/module-documents/configuration`, {
          value: {},
          expectedRevision: "x",
        })
      ).status,
    ).toBe(403);
    expect((await put(one.id, "definition", {}, "x")).status).toBe(400);
    expect((await put(one.id, "configuration", [1, 2], "x")).status).toBe(400);
  });

  it("lists the assessment in the Build readiness only for an assessed activity", async () => {
    const { client, base, create, put, specify } = await setup();
    const one = await create(1);
    const readiness = async () => {
      const response = await client.get(`${base}/${one.id}/readiness`);
      expect(response.status, await response.clone().text()).toBe(200);
      const { checks } = (await response.json()) as { checks: { id: string }[] };
      return checks.find((check) => check.id === "assessment");
    };
    const plain = await specify(one.id, one.draft.contentRevision);
    expect(await readiness()).toBeUndefined();

    const assessed = await specify(one.id, plain.contentRevision, {
      ...spec,
      runtime: { ...spec.runtime, usesAssessment: true },
    });
    expect(await readiness()).toEqual({
      id: "assessment",
      level: "fail",
      state: "missing",
      problems: 0,
    });

    const saved = await put(
      one.id,
      "assessment",
      { ...assessment, title: `${PRODUCT}-1` },
      assessed.contentRevision,
    );
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(await readiness()).toEqual({
      id: "assessment",
      level: "ok",
      state: "valid",
      problems: 0,
    });
  });

  it("only warns in the Build readiness about problems the module's own assessment had", async () => {
    const { t, client, base, create, put, specify } = await setup();
    const one = await create(1);
    const twoCorrect = {
      title: "q",
      configuration: { simpleChoice: [choice("a", true), choice("b", true)] },
    };
    const runId = "run_readiness_module";
    const moduleDir = path.join(t.root, "activity-runs", runId, "module");
    await fs.mkdir(path.join(moduleDir, "assessments"), { recursive: true });
    await fs.writeFile(path.join(moduleDir, "definition.json"), "{}", "utf8");
    // Two correct answers on a single choice, and a title that does not name the file.
    await fs.writeFile(
      path.join(moduleDir, "assessments", `${PRODUCT}-1.json`),
      JSON.stringify({ title: "old name", items: [twoCorrect] }),
      "utf8",
    );
    t.deps.db
      .prepare(
        "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES (?, 'editor-work', ?, 'succeeded', '2026-09-25', 'module', ?)",
      )
      .run(
        runId,
        one.id,
        JSON.stringify({ runId, status: "succeeded", kind: "module", createdAt: "2026-09-25" }),
      );
    const assessed = await specify(one.id, one.draft.contentRevision, {
      ...spec,
      runtime: { ...spec.runtime, usesAssessment: true },
    });
    const readiness = async () => {
      const response = await client.get(`${base}/${one.id}/readiness`);
      expect(response.status, await response.clone().text()).toBe(200);
      const { checks } = (await response.json()) as { checks: { id: string }[] };
      return checks.find((check) => check.id === "assessment");
    };
    // A warning, not a failure, so Assemble stays on offer.
    expect(await readiness()).toEqual({
      id: "assessment",
      level: "warn",
      state: "problems",
      problems: 2,
    });

    // An edit that keeps those problems still only warns.
    const saved = await put(
      one.id,
      "assessment",
      { title: "old name", items: [{ ...twoCorrect, prompt: "changed" }] },
      assessed.contentRevision,
    );
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(await readiness()).toMatchObject({ level: "warn", problems: 2 });
  });
});
