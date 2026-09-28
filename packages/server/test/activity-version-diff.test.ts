/**
 * Comparing a version: with the draft as it is now, part by part and media by media, and with
 * another version. Any member may compare.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { versionDiff } from "../src/activities/version-diff.js";
import type { VersionManifest } from "../src/activities/version-manifest.js";
import type { VersionDiff } from "../src/activities/version-types.js";
import { apiClient, provisionUser } from "./helpers.js";
import {
  AUDIO_RUN,
  regenerateNarration,
  versionsApp,
  withMedia,
} from "./activity-version-fixtures.js";

const PROJECT = "versions-diff";
const RUN_2 = `run_${"b".repeat(32)}`;

describe("comparing activity versions", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("shows only the script after a script edit, with its lines", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    await s.describe("Line one\nLine two");
    const v1 = await s.saved();
    await s.describe("Line one\nLine 2\nLine three");
    const response = await s.client.get(`${s.endpoint}/versions/${v1.versionId}/diff`);
    expect(response.status).toBe(200);
    expect((await response.json()) as VersionDiff).toEqual({
      files: [
        {
          name: "description",
          before: "Line one\nLine two",
          after: "Line one\nLine 2\nLine three",
        },
      ],
      media: [],
    });
    // Unchanged since the version: nothing differs.
    const v2 = await s.saved();
    const same = await s.client.get(`${s.endpoint}/versions/${v2.versionId}/diff?against=current`);
    expect(await same.json()).toEqual({ files: [], media: [] });
  });

  it("shows a regenerated narration as that narration's file changing", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    const { wave } = await withMedia(s);
    const v1 = await s.saved();
    const { wave: again } = await regenerateNarration(s, RUN_2);
    const diff = (await (
      await s.client.get(`${s.endpoint}/versions/${v1.versionId}/diff`)
    ).json()) as VersionDiff;
    expect(diff.media).toEqual([
      {
        path: `audio/${RUN_2}.wav`,
        change: "changed",
        beforeBytes: wave.length,
        afterBytes: again.length,
      },
    ]);
    // The plan changed with it, and nothing else did.
    expect(diff.files.map((file) => file.name)).toEqual(["mediaPlan"]);
    const plan = diff.files[0]!;
    expect(plan.before).toContain(`"runId": "run_${"a".repeat(32)}"`);
    expect(plan.after).toContain(`"runId": "${RUN_2}"`);
  });

  it("shows a file the draft lost as removed instead of refusing", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    const { wave } = await withMedia(s);
    const v1 = await s.saved();
    await fs.rm(path.join(s.workspace, "audio", `${AUDIO_RUN}.wav`));
    const response = await s.client.get(`${s.endpoint}/versions/${v1.versionId}/diff`);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(((await response.json()) as VersionDiff).media).toEqual([
      {
        path: `audio/${AUDIO_RUN}.wav`,
        change: "removed",
        beforeBytes: wave.length,
        afterBytes: null,
      },
    ]);
  });

  it("compares two versions, and pretty-prints JSON with sorted keys", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    const v1 = await s.saved();
    const features = (await (
      await s.client.get(`${s.endpoint}/implementation-features`)
    ).json()) as { features: { id: string }[] };
    const id = features.features[0]!.id;
    await s.client.put(`${s.endpoint}/implementation-features`, { selectedIds: [id] });
    const v2 = await s.saved();
    const diff = (await (
      await s.client.get(`${s.endpoint}/versions/${v1.versionId}/diff?against=${v2.versionId}`)
    ).json()) as VersionDiff;
    expect(diff).toEqual({
      files: [{ name: "features", before: null, after: JSON.stringify([id], null, 2) }],
      media: [],
    });
  });

  it("lists added and removed media by path", () => {
    const base: VersionManifest = {
      schemaVersion: 1,
      draft: { description: "", spec: null },
      implementationFeatures: null,
      media: [
        { path: "media/uploads/a.png", sha256: "1".repeat(64), bytes: 3 },
        { path: "media/uploads/b.png", sha256: "2".repeat(64), bytes: 4 },
      ],
      references: [],
    };
    const next: VersionManifest = {
      ...base,
      draft: { description: "", spec: { b: 1, a: { d: 2, c: 3 } } },
      media: [
        { path: "media/uploads/b.png", sha256: "3".repeat(64), bytes: 5 },
        { path: "media/uploads/c.png", sha256: "4".repeat(64), bytes: 6 },
      ],
    };
    expect(versionDiff(base, next)).toEqual({
      files: [
        {
          name: "spec",
          before: null,
          after: '{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1\n}',
        },
      ],
      media: [
        { path: "media/uploads/a.png", change: "removed", beforeBytes: 3, afterBytes: null },
        { path: "media/uploads/b.png", change: "changed", beforeBytes: 4, afterBytes: 5 },
        { path: "media/uploads/c.png", change: "added", beforeBytes: null, afterBytes: 6 },
      ],
    });
  });

  it("lets a member compare, and refuses unknown versions and bad input", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    const v1 = await s.saved();
    const member = await provisionUser(s.t.app, "diff_reader");
    expect(
      (await s.client.post(`/api/projects/${PROJECT}/members`, { userId: "diff_reader" })).status,
    ).toBe(201);
    const reader = apiClient(s.t.app, member.cookie);
    expect((await reader.get(`${s.endpoint}/versions/${v1.versionId}/diff`)).status).toBe(200);
    const missing = `ver_${"0".repeat(32)}`;
    const unknown = await s.client.get(`${s.endpoint}/versions/${missing}/diff`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "version_not_found" } });
    expect(
      (await s.client.get(`${s.endpoint}/versions/${v1.versionId}/diff?against=${missing}`)).status,
    ).toBe(404);
    expect(
      (await s.client.get(`${s.endpoint}/versions/${v1.versionId}/diff?against=../x`)).status,
    ).toBe(400);
  });
});
