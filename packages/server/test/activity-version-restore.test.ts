/**
 * Restoring a version: the draft and its media become the version's, the draft as it was is
 * kept first, a stale revision or a version missing a file changes nothing, and restoring the
 * kept version returns to exactly where the author was.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ActivityDraft } from "../src/activities/domain.js";
import { manifestBytes, manifestHash } from "../src/activities/version-manifest.js";
import type { VersionManifest } from "../src/activities/version-manifest.js";
import {
  blobFile,
  getVersion,
  readBlob,
  sha256,
  writeBlob,
  writeVersion,
} from "../src/activities/version-store.js";
import { REF_FEATURES_FILE } from "../src/activities/ref-files.js";
import { apiClient, provisionUser } from "./helpers.js";
import { refFilesDir } from "./activity-fixtures.js";
import {
  HELLO,
  regenerateNarration,
  versionsApp,
  withMedia,
  type VersionsApp,
} from "./activity-version-fixtures.js";

const PROJECT = "versions-restore";
const RUN_2 = `run_${"b".repeat(32)}`;

function restore(s: VersionsApp, versionId: string, expectedRevision: string) {
  return s.client.post(`${s.endpoint}/versions/${versionId}/restore`, { expectedRevision });
}

describe("restoring activity versions", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("makes the draft equal the version, keeping the draft as it was first", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    const { wave, dogPath, uploadBytes } = await withMedia(s);
    const v1Draft = (await s.read()).draft;
    const v1 = await s.saved({ label: "Good one" });

    // Change everything: script, narration, the uploaded file's bytes, and the spec.
    await regenerateNarration(s, RUN_2);
    await fs.writeFile(path.join(s.workspace, dogPath), Buffer.from("not the dog"));
    await s.describe("A different script");
    const before = (await s.read()).draft;

    const response = await restore(s, v1.versionId, before.contentRevision);
    expect(response.status, await response.clone().text()).toBe(200);
    const draft = (await response.json()) as ActivityDraft;
    expect(draft.description).toBe(v1Draft.description);
    expect(draft.spec).toEqual(v1Draft.spec);
    expect(draft.mediaPlan).toEqual(v1Draft.mediaPlan);
    expect(draft.contentRevision).toBe(v1Draft.contentRevision);
    expect(draft.status).toBe("valid");
    expect((await s.read()).draft.contentRevision).toBe(v1Draft.contentRevision);
    // Bound media bytes equal the version's: the regenerated narration's file, at the same
    // path, holds the version's narration again.
    expect(await fs.readFile(path.join(s.workspace, HELLO))).toEqual(wave);
    expect(await fs.readFile(path.join(s.workspace, dogPath))).toEqual(uploadBytes);

    const versions = await s.list();
    expect(versions.map((v) => [v.seq, v.kind, v.reason, v.current])).toEqual([
      [3, "restore", null, true],
      [2, "auto", "before_restore", false],
      [1, "manual", null, true],
    ]);
    const source = s.t.deps.db
      .prepare("SELECT source_version_id FROM activity_versions WHERE seq = 3")
      .get() as { source_version_id: string };
    expect(source.source_version_id).toBe(v1.versionId);
  });

  it("restores a version saved under another number into this ref's media folder", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    const { wave, dogPath, uploadBytes } = await withMedia(s);
    const v1 = await s.saved();
    const renumbered = await s.client.post(`${s.endpoint}/ref-number`, {
      refNum: 2,
      expectedRevision: (await s.read()).draft.contentRevision,
    });
    expect(renumbered.status, await renumbered.clone().text()).toBe(200);
    const moved = (p: string) => p.replace("/words-1/", "/words-2/");
    // The files moved with the number; lose them, so only the version can bring them back.
    await fs.rm(path.join(s.workspace, moved(HELLO)));
    await fs.rm(path.join(s.workspace, moved(dogPath)));
    const response = await restore(s, v1.versionId, (await s.read()).draft.contentRevision);
    expect(response.status, await response.clone().text()).toBe(200);
    const draft = (await response.json()) as ActivityDraft;
    expect(draft.mediaPlan!.manifest.refNum).toBe(2);
    const assets = draft.mediaPlan!.manifest.assets["en-US"]!;
    expect(assets.find((asset) => asset.key === "hello")!.path).toBe(moved(HELLO));
    expect(assets.find((asset) => asset.key === "dog")!.path).toBe(moved(dogPath));
    expect(await fs.readFile(path.join(s.workspace, moved(HELLO)))).toEqual(wave);
    expect(await fs.readFile(path.join(s.workspace, moved(dogPath)))).toEqual(uploadBytes);
    // Nothing is written back under the number the version was saved with.
    await expect(fs.stat(path.join(s.workspace, HELLO))).rejects.toThrow();
  });

  it("returns to the exact revision before a restore by restoring the kept version", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    await withMedia(s);
    const v1 = await s.saved();
    await regenerateNarration(s, RUN_2);
    await s.describe("Edited after v1");
    const before = (await s.read()).draft;
    const restored = (await (
      await restore(s, v1.versionId, before.contentRevision)
    ).json()) as ActivityDraft;
    const kept = (await s.list()).find((v) => v.reason === "before_restore")!;
    const back = await restore(s, kept.versionId, restored.contentRevision);
    expect(back.status).toBe(200);
    const draft = (await back.json()) as ActivityDraft;
    expect(draft.contentRevision).toBe(before.contentRevision);
    expect(draft.description).toBe("Edited after v1");
    // The script was edited after the specification, and it still reads so.
    expect(before.status).toBe("draft");
    expect(draft.status).toBe("draft");
    expect((await s.read()).draft.status).toBe("draft");
    expect((await s.list()).find((v) => v.current && v.seq === kept.seq)).toBeTruthy();
  });

  it("brings back the implementation-features selection", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    const features = (await (
      await s.client.get(`${s.endpoint}/implementation-features`)
    ).json()) as { features: { id: string }[] };
    const id = features.features[0]!.id;
    await s.client.put(`${s.endpoint}/implementation-features`, { selectedIds: [id] });
    const v1 = await s.saved();
    await s.client.put(`${s.endpoint}/implementation-features`, { selectedIds: [] });
    await s.describe("Other");
    expect((await restore(s, v1.versionId, (await s.read()).draft.contentRevision)).status).toBe(
      200,
    );
    const now = (await (await s.client.get(`${s.endpoint}/implementation-features`)).json()) as {
      selectedIds: string[];
    };
    expect(now.selectedIds).toEqual([id]);
  });

  it("refuses a stale revision and changes nothing", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    const v1 = await s.saved();
    const stale = (await s.read()).draft.contentRevision;
    await s.describe("Newer");
    const before = (await s.read()).draft;
    const response = await restore(s, v1.versionId, stale);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "draft_conflict" } });
    expect((await s.read()).draft).toEqual(before);
    expect((await s.list()).map((v) => v.seq)).toEqual([1]);
  });

  it("refuses a version missing a file, naming it, and changes nothing", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    const { wave } = await withMedia(s);
    const v1 = await s.saved();
    const { wave: again } = await regenerateNarration(s, RUN_2);
    const before = (await s.read()).draft;
    await fs.rm(blobFile(s.activityDir, sha256(wave)));
    const response = await restore(s, v1.versionId, before.contentRevision);
    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      error: { code: string; message: string; detail?: Record<string, string> };
    };
    expect(body.error.code).toBe("version_incomplete");
    expect(body.error.detail).toEqual({ path: HELLO });
    expect((await s.read()).draft).toEqual(before);
    expect((await s.list()).map((v) => v.seq)).toEqual([1]);
    // The regenerated narration stays in place.
    expect(await fs.readFile(path.join(s.workspace, HELLO))).toEqual(again);
  });

  it("restores when a file of the draft is missing, keeping the draft without it first", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    const { wave } = await withMedia(s);
    const v1 = await s.saved();
    await regenerateNarration(s, RUN_2);
    await fs.rm(path.join(s.workspace, HELLO));
    const before = (await s.read()).draft;
    const response = await restore(s, v1.versionId, before.contentRevision);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await fs.readFile(path.join(s.workspace, HELLO))).toEqual(wave);
    const versions = await s.list();
    expect(versions.map((v) => [v.seq, v.kind, v.reason])).toEqual([
      [3, "restore", null],
      [2, "auto", "before_restore"],
      [1, "manual", null],
    ]);
    // The kept version restores too, without the file it never had.
    const restored = (await s.read()).draft;
    const back = await restore(s, versions[1]!.versionId, restored.contentRevision);
    expect(back.status, await back.clone().text()).toBe(200);
    expect(((await back.json()) as ActivityDraft).contentRevision).toBe(before.contentRevision);
  });

  it("keeps no second version when the draft is already the latest one", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    const v1 = await s.saved();
    await s.describe("Saved again");
    await s.saved();
    const response = await restore(s, v1.versionId, (await s.read()).draft.contentRevision);
    expect(response.status).toBe(200);
    // v2 already holds the draft as it was, so it is the version a restore goes back to.
    expect((await s.list()).map((v) => [v.seq, v.kind, v.reason])).toEqual([
      [3, "restore", null],
      [2, "manual", null],
      [1, "manual", null],
    ]);
    expect((await s.read()).draft.description).not.toBe("Saved again");
  });

  it("refuses a version whose media plan no longer fits the activity, changing nothing", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    await withMedia(s);
    const v1 = await s.saved();
    // A version whose stored plan names another product, as a plan kept before the activity
    // changed would.
    const row = getVersion(s.t.deps.db, s.activity.id, v1.versionId)!;
    const manifest = JSON.parse(
      (await readBlob(s.activityDir, row.manifestSha)).toString("utf8"),
    ) as VersionManifest;
    manifest.draft.mediaPlan!.manifest.productCode = "other";
    manifest.draft.description = "Planned elsewhere";
    const odd = { ...row, versionId: `ver_${"e".repeat(32)}`, seq: 2 };
    odd.manifestSha = await writeBlob(s.activityDir, manifestBytes(manifest));
    odd.contentHash = manifestHash(manifest);
    writeVersion(s.t.deps.db, odd);
    await s.describe("Other");
    const before = (await s.read()).draft;
    const features = path.join(refFilesDir(s.t.root, "words", 1), REF_FEATURES_FILE);
    const featuresBefore = await fs.readFile(features, "utf8").catch(() => null);
    const response = await restore(s, odd.versionId, before.contentRevision);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "media_invalid" } });
    expect((await s.list()).map((v) => v.seq)).toEqual([2, 1]);
    expect((await s.read()).draft).toEqual(before);
    expect(await fs.readFile(features, "utf8").catch(() => null)).toBe(featuresBefore);
  });

  it("does nothing for the version the draft already holds, and only the owner restores", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    const v1 = await s.saved();
    const draft = (await s.read()).draft;
    const same = await restore(s, v1.versionId, draft.contentRevision);
    expect(same.status).toBe(200);
    expect(((await same.json()) as ActivityDraft).contentRevision).toBe(draft.contentRevision);
    expect((await s.list()).map((v) => v.seq)).toEqual([1]);

    const member = await provisionUser(s.t.app, "restore_reader");
    await s.client.post(`/api/projects/${PROJECT}/members`, { userId: "restore_reader" });
    const reader = apiClient(s.t.app, member.cookie);
    expect(
      (
        await reader.post(`${s.endpoint}/versions/${v1.versionId}/restore`, {
          expectedRevision: draft.contentRevision,
        })
      ).status,
    ).toBe(403);
    expect((await restore(s, `ver_${"0".repeat(32)}`, draft.contentRevision)).status).toBe(404);
    expect((await s.client.post(`${s.endpoint}/versions/${v1.versionId}/restore`, {})).status).toBe(
      400,
    );
  });
});
