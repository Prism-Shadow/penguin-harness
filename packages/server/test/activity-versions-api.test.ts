/**
 * Saving and listing versions through the routes: an unchanged activity saves no second
 * version, a change makes the next one, the version holds the generated and uploaded files
 * (each stored once) and only names checkout media, and only the owner may save.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectDir } from "@prismshadow/penguin-core";
import type { ActivityDetail, ActivityDraft } from "../src/activities/domain.js";
import type { VersionManifest } from "../src/activities/version-manifest.js";
import { readBlob, sha256 } from "../src/activities/version-store.js";
import type { VersionSaveResult, VersionSummary } from "../src/activities/version-types.js";
import type { ActivityAuthoring } from "../src/mechanisms/activities.js";
import { activitySpec } from "./activity-fixtures.js";
import { speechWave } from "./audio-fixtures.js";
import { imagePng } from "./image-fixtures.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

const PROJECT = "versions-work";
const AUDIO_RUN = `run_${"a".repeat(32)}`;
const IMAGE_RUN = `run_${"c".repeat(32)}`;

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else out.push(full);
  }
  return out;
}

describe("activity versions", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup() {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "versions");
    const client = apiClient(t.app, owner.cookie);
    expect((await client.post("/api/projects", { projectId: PROJECT })).status).toBe(201);
    const base = `/api/projects/${PROJECT}/activities`;
    const created = await client.post(base, { productCode: "words", refNum: 1, title: "Words" });
    expect(created.status).toBe(201);
    const activity = (await created.json()) as ActivityDetail;
    const endpoint = `${base}/${activity.id}`;
    const read = async () => (await (await client.get(endpoint)).json()) as ActivityDetail;
    const save = (body: Record<string, unknown> = {}) => client.post(`${endpoint}/versions`, body);
    /** Save, and return the version the answer carries. */
    const saved = async (body: Record<string, unknown> = {}) =>
      ((await (await save(body)).json()) as VersionSaveResult).version;
    const list = async () =>
      ((await (await client.get(`${endpoint}/versions`)).json()) as { versions: VersionSummary[] })
        .versions;
    const collectionDir = path.join(
      projectDir(t.root, PROJECT),
      "activities",
      activity.collectionId,
    );
    const activityDir = path.join(collectionDir, "activities", activity.id);
    return {
      t,
      client,
      base,
      endpoint,
      activity,
      read,
      save,
      saved,
      list,
      collectionDir,
      activityDir,
    };
  }

  /** A narration and an image generated and accepted, an image bound to an upload and one to the checkout. */
  async function withMedia(s: Awaited<ReturnType<typeof setup>>) {
    const { t, client, endpoint, activity } = s;
    const authoring = t.deps.tree.api<ActivityAuthoring>("ActivitiesModule", "ActivityAuthoring");
    const specced = (await (
      await client.post(`${endpoint}/apply-generated-spec`, {
        spec: {
          ...activitySpec,
          scenes: [
            {
              id: "intro",
              description: "Look",
              media: {
                images: [
                  { key: "cat", description: "A cat" },
                  { key: "dog", description: "A dog" },
                  { key: "puppy", description: "The dog again" },
                  { key: "tree", description: "A tree" },
                ],
              },
              audio: { tracks: [{ key: "hello", description: "Greeting", script: "Hello" }] },
            },
          ],
        },
        expectedRevision: activity.draft.contentRevision,
      })
    ).json()) as ActivityDraft;
    const planned = await client.post(`${endpoint}/plan-media`, {
      expectedRevision: specced.contentRevision,
    });
    expect(planned.status, await planned.clone().text()).toBe(200);
    const wave = speechWave();
    const audio = await authoring.storeAudio(PROJECT, activity.id, AUDIO_RUN, wave);
    let draft = await authoring.applyAudio(
      PROJECT,
      activity.id,
      { language: "en-US", assetKey: "hello", script: "Hello", voice: "Kore", model: "m" },
      audio,
      ((await planned.json()) as ActivityDraft).contentRevision,
    );
    const png = imagePng(2, 2);
    const image = await authoring.storeImage(PROJECT, activity.id, IMAGE_RUN, png);
    draft = await authoring.applyImage(
      PROJECT,
      activity.id,
      { language: "en-US", assetKey: "cat", prompt: "A cat", model: "m" },
      image,
      draft.contentRevision,
    );
    const uploadBytes = imagePng(3, 3);
    const uploaded = await client.post(`${endpoint}/media-uploads`, {
      name: "dog.png",
      dataBase64: uploadBytes.toString("base64"),
    });
    expect(uploaded.status).toBe(201);
    const dogPath = ((await uploaded.json()) as { path: string }).path;
    const manifest = structuredClone(draft.mediaPlan!.manifest);
    const assets = manifest.assets["en-US"]!;
    assets.find((asset) => asset.key === "dog")!.path = dogPath;
    assets.find((asset) => asset.key === "puppy")!.path = dogPath;
    assets.find((asset) => asset.key === "tree")!.path = "media/loom/intro/tree.png";
    const bound = await client.put(`${endpoint}/media`, {
      manifest,
      expectedRevision: draft.contentRevision,
    });
    expect(bound.status, await bound.clone().text()).toBe(200);
    return { wave, png, uploadBytes, dogPath };
  }

  it("saves a named version, and saving again without a change keeps that one", async () => {
    const { save, list, t } = await setup();
    expect(await list()).toEqual([]);
    const first = await save({ label: "  First draft  " });
    expect(first.status).toBe(201);
    const made = (await first.json()) as VersionSaveResult;
    expect(made.created).toBe(true);
    const v1 = made.version;
    expect(v1).toMatchObject({
      seq: 1,
      label: "First draft",
      kind: "manual",
      reason: null,
      author: "versions",
      mediaBytes: 0,
      current: true,
      deployed: { qa: null, prod: null },
    });
    const repeat = await save({ label: "Same" });
    expect(repeat.status).toBe(200);
    const { version: again, created } = (await repeat.json()) as VersionSaveResult;
    expect(created).toBe(false);
    expect(again.versionId).toBe(v1.versionId);
    expect(again.label).toBe("First draft");
    expect(await list()).toEqual([v1]);
    expect(
      (t.deps.db.prepare("SELECT COUNT(*) AS n FROM activity_versions").get() as { n: number }).n,
    ).toBe(1);
  });

  it("makes v2 after the script changes, and marks which one is current", async () => {
    const { client, endpoint, read, saved, list } = await setup();
    const v1 = await saved();
    expect(v1.label).toBeNull();
    const draft = (await read()).draft;
    const changed = await client.patch(`${endpoint}/description`, {
      description: "A new script",
      expectedRevision: draft.contentRevision,
    });
    expect(changed.status).toBe(200);
    // The draft no longer matches v1.
    expect((await list()).map((v) => [v.seq, v.current])).toEqual([[1, false]]);
    const v2 = await saved({ label: "After the change" });
    expect(v2.seq).toBe(2);
    expect((await list()).map((v) => [v.seq, v.label, v.current])).toEqual([
      [2, "After the change", true],
      [1, null, false],
    ]);
  });

  it("keeps generated and uploaded files once, and only names checkout media", async () => {
    const s = await setup();
    const { client, endpoint, saved, t, activityDir, collectionDir } = s;
    const { wave, png, uploadBytes, dogPath } = await withMedia(s);
    const features = (await (await client.get(`${endpoint}/implementation-features`)).json()) as {
      features: { id: string }[];
    };
    const featureId = features.features[0]!.id;
    await client.put(`${endpoint}/implementation-features`, { selectedIds: [featureId] });

    const before = await listFiles(path.dirname(collectionDir)).catch((): string[] => []);
    const v1 = await saved({ label: "With media" });
    expect(v1.mediaBytes).toBe(wave.length + png.length + uploadBytes.length);
    const row = t.deps.db
      .prepare("SELECT manifest_sha, content_hash FROM activity_versions WHERE version_id = ?")
      .get(v1.versionId) as { manifest_sha: string; content_hash: string };
    expect(row.manifest_sha).toBe(row.content_hash);
    const manifest = JSON.parse(
      (await readBlob(activityDir, row.manifest_sha)).toString("utf8"),
    ) as VersionManifest;
    expect(manifest.media).toEqual([
      { path: `audio/${AUDIO_RUN}.wav`, sha256: sha256(wave), bytes: wave.length },
      { path: `images/${IMAGE_RUN}.png`, sha256: sha256(png), bytes: png.length },
      { path: dogPath, sha256: sha256(uploadBytes), bytes: uploadBytes.length },
    ]);
    expect(manifest.references).toEqual(["media/loom/intro/tree.png"]);
    expect(manifest.implementationFeatures).toEqual([featureId]);
    for (const file of manifest.media)
      expect(await readBlob(activityDir, file.sha256)).toHaveLength(file.bytes);

    // A second version sharing every file adds only its own manifest.
    const blobs = path.join(activityDir, "versions", "blobs");
    expect(await fs.readdir(blobs)).toHaveLength(4);
    const draft = (await s.read()).draft;
    await client.patch(`${endpoint}/description`, {
      description: "Changed script",
      expectedRevision: draft.contentRevision,
    });
    const v2 = await saved();
    expect(v2.seq).toBe(2);
    expect(await fs.readdir(blobs)).toHaveLength(5);

    // Everything written went under this activity's directory: nothing into the checkout,
    // nothing elsewhere in the project.
    const after = await listFiles(path.dirname(collectionDir));
    const added = after.filter((file) => !before.includes(file));
    expect(added.length).toBeGreaterThan(0);
    for (const file of added) expect(file.startsWith(activityDir + path.sep)).toBe(true);
    expect(added.some((file) => file.includes("tree.png"))).toBe(false);
  });

  it("treats an emptied feature selection like one never made", async () => {
    const { client, endpoint, save, saved, list } = await setup();
    const v1 = await saved();
    const features = (await (await client.get(`${endpoint}/implementation-features`)).json()) as {
      features: { id: string }[];
    };
    await client.put(`${endpoint}/implementation-features`, {
      selectedIds: [features.features[0]!.id],
    });
    expect((await list()).map((v) => v.current)).toEqual([false]);
    await client.put(`${endpoint}/implementation-features`, { selectedIds: [] });
    expect((await list()).map((v) => v.current)).toEqual([true]);
    const again = await save();
    expect(again.status).toBe(200);
    expect(((await again.json()) as VersionSaveResult).version.versionId).toBe(v1.versionId);
  });

  it("refuses to save when a generated file changed on disk", async () => {
    const s = await setup();
    await withMedia(s);
    const drafts = path.join(s.activityDir, "drafts");
    const [draftId] = await fs.readdir(drafts);
    await fs.appendFile(path.join(drafts, draftId!, "images", `${IMAGE_RUN}.png`), "x");
    const response = await s.save();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "version_media_changed" } });
    expect(await s.list()).toEqual([]);
  });

  it("validates the name", async () => {
    const { save } = await setup();
    expect((await save({ label: "x".repeat(81) })).status).toBe(400);
    expect((await save({ label: 3 })).status).toBe(400);
    expect((await save({ label: "bad\u0007name" })).status).toBe(400);
    expect((await save({ label: "x".repeat(80) })).status).toBe(201);
  });

  it("lets a member list versions but only the owner save them", async () => {
    const { t, client, base, activity, save } = await setup();
    await save({ label: "Owner's" });
    const member = await provisionUser(t.app, "version_reader");
    expect(
      (await client.post(`/api/projects/${PROJECT}/members`, { userId: "version_reader" })).status,
    ).toBe(201);
    const reader = apiClient(t.app, member.cookie);
    const listed = await reader.get(`${base}/${activity.id}/versions`);
    expect(listed.status).toBe(200);
    expect(
      ((await listed.json()) as { versions: VersionSummary[] }).versions.map((v) => v.label),
    ).toEqual(["Owner's"]);
    expect((await reader.post(`${base}/${activity.id}/versions`, {})).status).toBe(403);
    expect((await client.get(`${base}/act_missing/versions`)).status).toBe(404);
  });
});
