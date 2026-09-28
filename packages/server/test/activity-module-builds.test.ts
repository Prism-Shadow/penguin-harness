/**
 * Module builds: the list of succeeded assemblies with their file counts, a file-by-file
 * compare of two builds, and pinning the build the preview plays until it is unpinned.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ActivityDetail, ActivityDraft } from "../src/activities/domain.js";
import type { ModuleBuildDiff, ModuleBuildList } from "../src/activities/module-build-types.js";
import type { ActivityVersions } from "../src/activities/version-service.js";
import type { VersionStatus } from "../src/activities/version-types.js";
import { versionsApp, type VersionsApp } from "./activity-version-fixtures.js";
import { apiClient, provisionUser } from "./helpers.js";

const PROJECT = "versions-builds";
const RUN_A = `run_${"1".repeat(32)}`;
const RUN_B = `run_${"2".repeat(32)}`;
const RUN_C = `run_${"3".repeat(32)}`;
const RUN_FAILED = `run_${"4".repeat(32)}`;

/** A run of another kind, which leaves no module build. */
function otherRun(s: VersionsApp, runId: string, createdAt: string, status = "succeeded") {
  s.t.deps.db
    .prepare(
      "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES (?, ?, ?, ?, ?, 'audio', ?)",
    )
    .run(
      runId,
      s.project,
      s.activity.id,
      status,
      createdAt,
      JSON.stringify({ runId, status, kind: "audio", createdAt, finishedAt: createdAt }),
    );
}

/** A module run of the activity, with these files in its module folder. */
async function build(
  s: VersionsApp,
  runId: string,
  createdAt: string,
  files: Record<string, string | Buffer>,
  status = "succeeded",
) {
  const moduleDir = path.join(s.t.root, "activity-runs", runId, "module");
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(moduleDir, ...name.split("/"));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
  s.t.deps.db
    .prepare(
      "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES (?, ?, ?, ?, ?, 'module', ?)",
    )
    .run(
      runId,
      s.project,
      s.activity.id,
      status,
      createdAt,
      JSON.stringify({ runId, status, kind: "module", createdAt, finishedAt: createdAt }),
    );
}

const COMMON = {
  "definition.json": '{"id":"words"}',
  "res/style.css": "body { color: black; }\n",
  "node_modules/dep/index.js": "ignored",
  "dist/bundle.js": "ignored",
};

describe("module builds", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup() {
    const s = await versionsApp(PROJECT, cleanups);
    await build(s, RUN_A, "2026-09-25T10:00:00.000Z", {
      ...COMMON,
      "src/index.ts": "export const version = 1;\n",
      "src/old.ts": "gone later\n",
      "res/image.png": Buffer.from([1, 2, 3]),
      "src/big.js": "a".repeat(210 * 1024),
    });
    await build(s, RUN_B, "2026-09-26T10:00:00.000Z", {
      ...COMMON,
      "src/index.ts": "export const version = 2;\n",
      "src/new.ts": "added\n",
      "res/image.png": Buffer.from([4, 5, 6]),
      "src/big.js": "b".repeat(210 * 1024),
    });
    await build(s, RUN_FAILED, "2026-09-27T10:00:00.000Z", COMMON, "failed");
    const list = async () =>
      (await (await s.client.get(`${s.endpoint}/module-builds`)).json()) as ModuleBuildList;
    const served = async () => {
      const response = await s.client.get(`${s.endpoint}/sandbox/module/src/marker.json`);
      return response.status === 200 ? await response.text() : `status ${response.status}`;
    };
    const pin = (runId: string, expectedRevision: string) =>
      s.client.post(`${s.endpoint}/module-builds/${runId}/pin`, { expectedRevision });
    const unpin = (expectedRevision: string) =>
      s.client.post(`${s.endpoint}/module-builds/unpin`, { expectedRevision });
    return { s, list, served, pin, unpin };
  }

  it("lists succeeded builds newest first with their source files", async () => {
    const { list } = await setup();
    expect(await list()).toEqual({
      builds: [
        {
          runId: RUN_B,
          createdAt: "2026-09-26T10:00:00.000Z",
          finishedAt: "2026-09-26T10:00:00.000Z",
          // definition, style, index, new, image, big: not node_modules or dist.
          files: 6,
          newest: true,
        },
        {
          runId: RUN_A,
          createdAt: "2026-09-25T10:00:00.000Z",
          finishedAt: "2026-09-25T10:00:00.000Z",
          files: 6,
          newest: false,
        },
      ],
      pinnedRunId: null,
      playingRunId: RUN_B,
    });
  });

  it("compares two builds file by file, with text only for small text files", async () => {
    const { s } = await setup();
    const response = await s.client.get(
      `${s.endpoint}/module-builds/diff?from=${RUN_A}&to=${RUN_B}`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const diff = (await response.json()) as ModuleBuildDiff;
    expect(diff.from).toBe(RUN_A);
    expect(diff.to).toBe(RUN_B);
    expect(diff.unchanged).toBe(2);
    expect(diff.files.map((file) => [file.path, file.change, file.text])).toEqual([
      ["res/image.png", "changed", "binary"],
      ["src/big.js", "changed", "too_large"],
      ["src/index.ts", "changed", "shown"],
      ["src/new.ts", "added", "shown"],
      ["src/old.ts", "removed", "shown"],
    ]);
    expect(diff.files.find((file) => file.path === "src/index.ts")).toMatchObject({
      before: "export const version = 1;\n",
      after: "export const version = 2;\n",
      beforeBytes: 26,
      afterBytes: 26,
    });
    expect(diff.files.find((file) => file.path === "src/new.ts")).toMatchObject({
      before: null,
      after: "added\n",
      beforeBytes: null,
    });
    expect(diff.files.find((file) => file.path === "src/big.js")).toMatchObject({
      before: null,
      after: null,
    });

    // Only this activity's succeeded builds can be compared.
    expect(
      (await s.client.get(`${s.endpoint}/module-builds/diff?from=${RUN_A}&to=${RUN_FAILED}`))
        .status,
    ).toBe(404);
    expect((await s.client.get(`${s.endpoint}/module-builds/diff?from=x&to=y`)).status).toBe(400);
  });

  it("plays a pinned build until it is unpinned, even after a newer build", async () => {
    const { s, list, served, pin, unpin } = await setup();
    for (const [runId, marker] of [
      [RUN_A, "A"],
      [RUN_B, "B"],
    ] as const)
      await fs.writeFile(
        path.join(s.t.root, "activity-runs", runId, "module", "src", "marker.json"),
        JSON.stringify(marker),
      );
    expect(await served()).toBe('"B"');
    const before = (await s.read()).draft;

    const pinned = await pin(RUN_A, before.contentRevision);
    expect(pinned.status, await pinned.clone().text()).toBe(200);
    const draft = (await pinned.json()) as ActivityDraft;
    expect(draft.pinnedModuleRunId).toBe(RUN_A);
    // The pin only chooses what the preview plays: the draft's revision stays.
    expect(draft.contentRevision).toBe(before.contentRevision);
    expect(await served()).toBe('"A"');
    expect(await list()).toMatchObject({ pinnedRunId: RUN_A, playingRunId: RUN_A });

    // A newer build does not move the preview off the pinned one.
    await build(s, RUN_C, "2026-09-28T10:00:00.000Z", {
      ...COMMON,
      "src/marker.json": JSON.stringify("C"),
    });
    expect(await served()).toBe('"A"');

    // A stale revision is refused; unpinning returns to the newest.
    const edited = await s.describe("Edited while pinned");
    expect(edited.pinnedModuleRunId).toBe(RUN_A);
    expect((await unpin(before.contentRevision)).status).toBe(409);
    const unpinned = await unpin(edited.contentRevision);
    expect(unpinned.status, await unpinned.clone().text()).toBe(200);
    const after = (await unpinned.json()) as ActivityDraft;
    expect(after.pinnedModuleRunId).toBeUndefined();
    expect(after.contentRevision).toBe(edited.contentRevision);
    expect(await served()).toBe('"C"');
    const read = (await s.read()) as ActivityDetail;
    expect(read.draft.contentRevision).toBe(edited.contentRevision);
    expect(await list()).toMatchObject({ pinnedRunId: null, playingRunId: RUN_C });
  });

  it("keeps the pinned build however many runs of other kinds come after it", async () => {
    const { s, list, served, pin } = await setup();
    await fs.writeFile(
      path.join(s.t.root, "activity-runs", RUN_A, "module", "src", "marker.json"),
      JSON.stringify("A"),
    );
    const pinned = await pin(RUN_A, (await s.read()).draft.contentRevision);
    expect(pinned.status, await pinned.clone().text()).toBe(200);
    for (let index = 0; index < 60; index++)
      otherRun(
        s,
        `run_${index.toString(16).padStart(32, "e")}`,
        `2026-09-27T11:${String(index).padStart(2, "0")}:00.000Z`,
      );
    expect(await served()).toBe('"A"');
    expect(await list()).toMatchObject({
      builds: [{ runId: RUN_B }, { runId: RUN_A }],
      pinnedRunId: RUN_A,
      playingRunId: RUN_A,
    });
    const diff = await s.client.get(`${s.endpoint}/module-builds/diff?from=${RUN_A}&to=${RUN_B}`);
    expect(diff.status).toBe(200);
  });

  it("pins while a run is in progress, since the pin leaves the draft's revision alone", async () => {
    const { s, pin } = await setup();
    otherRun(s, `run_${"5".repeat(32)}`, "2026-09-28T09:00:00.000Z", "running");
    const before = (await s.read()).draft;
    const pinned = await pin(RUN_A, before.contentRevision);
    expect(pinned.status, await pinned.clone().text()).toBe(200);
    const read = (await s.read()).draft;
    expect(read.pinnedModuleRunId).toBe(RUN_A);
    expect(read.contentRevision).toBe(before.contentRevision);
  });

  it("leaves the pin out of what a deploy records, and a deploy version records the newest build", async () => {
    const { s, pin } = await setup();
    const versions = s.t.deps.tree.api<ActivityVersions>("ActivitiesModule", "ActivityVersions");
    const status = async () =>
      (await (await s.client.get(`${s.endpoint}/versions/status`)).json()) as VersionStatus;
    const unpinned = (await s.read()).draft;
    const draft = (await (await pin(RUN_A, unpinned.contentRevision)).json()) as ActivityDraft;
    // The PROD gate and the deploy compare this revision, so a pin never makes QA out of date.
    expect(draft.contentRevision).toBe(unpinned.contentRevision);

    // A deploy of the pinned draft: its version records the build a release ships, the newest.
    const marked = await versions.markDeployed({
      projectId: s.project,
      activityId: s.activity.id,
      runId: "dep_1",
      target: "qa",
      revision: draft.contentRevision,
      deployedAt: "2026-09-28T10:00:00.000Z",
    });
    expect(marked).toMatchObject({ kind: "deploy", deployed: { qa: "2026-09-28T10:00:00.000Z" } });
    const recorded = s.t.deps.db
      .prepare("SELECT module_run_id FROM activity_versions WHERE version_id = ?")
      .get(marked!.versionId) as { module_run_id: string | null };
    expect(recorded.module_run_id).toBe(RUN_B);
    expect(await status()).toMatchObject({ qa: "in_sync" });

    // Edited while a deploy of the pinned draft ran: the version that held it is still found.
    await s.describe("Edited during the PROD deploy");
    const prod = await versions.markDeployed({
      projectId: s.project,
      activityId: s.activity.id,
      runId: "dep_2",
      target: "prod",
      revision: draft.contentRevision,
      deployedAt: "2026-09-28T11:00:00.000Z",
    });
    expect(prod?.versionId).toBe(marked!.versionId);
    expect(await status()).toMatchObject({ qa: "changed", prod: "changed" });
  });

  it("refuses to pin a run that is not a succeeded build, and a member may not pin", async () => {
    const { s, pin } = await setup();
    const revision = (await s.read()).draft.contentRevision;
    expect((await pin(RUN_FAILED, revision)).status).toBe(404);
    expect((await pin(`run_${"9".repeat(32)}`, revision)).status).toBe(404);
    expect((await pin("nope", revision)).status).toBe(400);

    const member = await provisionUser(s.t.app, "builds_reader");
    expect(
      (await s.client.post(`/api/projects/${PROJECT}/members`, { userId: "builds_reader" })).status,
    ).toBeLessThan(300);
    const reader = apiClient(s.t.app, member.cookie);
    expect((await reader.get(`${s.endpoint}/module-builds`)).status).toBe(200);
    expect(
      (
        await reader.post(`${s.endpoint}/module-builds/${RUN_A}/pin`, {
          expectedRevision: revision,
        })
      ).status,
    ).toBe(403);
  });
});
