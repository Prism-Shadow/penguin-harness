/**
 * Retention: automatic versions beyond the newest 20 go, with the blobs only they held;
 * manual, deployed and restored-from versions stay whatever their age.
 */
import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { ActivityVersions } from "../src/activities/version-service.js";
import { prunableVersions } from "../src/activities/version-retention.js";
import { blobFile, sha256, type VersionRow } from "../src/activities/version-store.js";
import { regenerateNarration, versionsApp, withMedia } from "./activity-version-fixtures.js";

const PROJECT = "versions-prune";
const RUN_X = `run_${"d".repeat(32)}`;
const RUN_Y = `run_${"e".repeat(32)}`;

function row(seq: number, extra: Partial<VersionRow> = {}): VersionRow {
  return {
    versionId: `ver_${seq}`,
    activityId: "act",
    seq,
    label: null,
    kind: "auto",
    reason: "before_proposal",
    contentHash: String(seq),
    manifestSha: String(seq),
    mediaBytes: 0,
    moduleRunId: null,
    sourceVersionId: null,
    authorUserId: null,
    deployedQaAt: null,
    deployedProdAt: null,
    createdAt: "2026-09-28T10:00:00.000Z",
    draftStatus: "draft",
    ...extra,
  };
}

const exists = (file: string) =>
  fs.stat(file).then(
    () => true,
    () => false,
  );

describe("version retention", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("chooses automatic versions past the newest ones that nothing keeps", () => {
    const rows = [
      row(1, { kind: "manual", reason: null }),
      row(2),
      row(3, { deployedQaAt: "2026-09-28T10:00:00.000Z" }),
      row(4),
      row(5, { kind: "restore", reason: null, sourceVersionId: "ver_4" }),
      row(6),
      row(7),
      row(8),
    ];
    expect(prunableVersions(rows, 2).map((r) => r.seq)).toEqual([6, 2]);
    expect(prunableVersions(rows, 20)).toEqual([]);
  });

  it("keeps the automatic version being restored, however old", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    const versions = s.t.deps.tree.api<ActivityVersions>("ActivitiesModule", "ActivityVersions");
    const autos = [];
    for (let i = 0; i < 20; i++) {
      await s.describe(`Script ${i}`);
      autos.push(
        (
          await versions.save(s.project, s.activity.id, {
            kind: "auto",
            reason: "before_proposal",
            author: null,
          })
        ).version,
      );
    }
    await s.describe("The draft now");
    // The version kept before this restore is the 21st automatic one; the oldest would go.
    const restored = await s.client.post(`${s.endpoint}/versions/${autos[0]!.versionId}/restore`, {
      expectedRevision: (await s.read()).draft.contentRevision,
    });
    expect(restored.status, await restored.clone().text()).toBe(200);
    expect((await s.read()).draft.description).toBe("Script 0");
    const list = await s.list();
    expect(list.map((v) => v.versionId)).toContain(autos[0]!.versionId);
    expect(list[0]).toMatchObject({ kind: "restore", current: true });
  });

  it("keeps 20 automatic versions and removes the blobs only the others held", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    const versions = s.t.deps.tree.api<ActivityVersions>("ActivitiesModule", "ActivityVersions");
    const { wave } = await withMedia(s);
    const auto = () =>
      versions.save(s.project, s.activity.id, {
        kind: "auto",
        reason: "before_proposal",
        author: null,
      });
    const manual = await s.saved({ label: "Keep me" });
    // The oldest automatic version holds a narration no later version holds.
    const { wave: waveX } = await regenerateNarration(s, RUN_X, 120);
    const oldest = (await auto()).version;
    const { wave: waveY } = await regenerateNarration(s, RUN_Y, 144);
    const deployed = (await auto()).version;
    await versions.markDeployed({
      projectId: s.project,
      activityId: s.activity.id,
      runId: "dep_1",
      target: "qa",
      revision: (await s.read()).draft.contentRevision,
      deployedAt: "2026-09-28T10:00:00.000Z",
    });
    for (let i = 0; i < 23; i++) {
      await s.describe(`Script ${i}`);
      await auto();
    }

    const list = await s.list();
    const autos = list.filter((v) => v.kind === "auto");
    // 25 automatic versions were kept; the newest 20 stay, and so does the deployed one.
    expect(autos).toHaveLength(21);
    expect(autos.filter((v) => v.versionId !== deployed.versionId)).toHaveLength(20);
    expect(list.map((v) => v.versionId)).toContain(manual.versionId);
    expect(list.map((v) => v.versionId)).toContain(deployed.versionId);
    expect(list.map((v) => v.versionId)).not.toContain(oldest.versionId);
    expect(list.map((v) => v.seq).slice(-3)).toEqual([7, 3, 1]);

    // The narration only the removed version held is gone; the others stay.
    expect(await exists(blobFile(s.activityDir, sha256(waveX)))).toBe(false);
    expect(await exists(blobFile(s.activityDir, sha256(waveY)))).toBe(true);
    expect(await exists(blobFile(s.activityDir, sha256(wave)))).toBe(true);
    // Every remaining version can still be compared: its blobs are all there.
    for (const version of list)
      await expect(
        versions.diff(s.project, s.activity.id, version.versionId, "current"),
      ).resolves.toBeTruthy();
  });
});
