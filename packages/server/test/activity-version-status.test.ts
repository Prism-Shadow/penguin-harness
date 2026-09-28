/**
 * Deployed markers and drift: a finished deploy keeps the draft as a deploy version (or marks
 * the latest one when it holds the same), status says in sync until the draft changes, the
 * deploy events hook marks versions on its own, and a deploy of an older revision marks the
 * version that held it.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { ActivityDeployEvents } from "../src/activities/deploy-events.js";
import type { DeployedEvent } from "../src/activities/deploy-types.js";
import type { ActivityVersions } from "../src/activities/version-service.js";
import type { VersionStatus } from "../src/activities/version-types.js";
import { versionsApp, type VersionsApp } from "./activity-version-fixtures.js";
import { apiClient, provisionUser } from "./helpers.js";

const PROJECT = "versions-status";

function api(s: VersionsApp) {
  const versions = s.t.deps.tree.api<ActivityVersions>("ActivitiesModule", "ActivityVersions");
  const events = s.t.deps.tree.api<ActivityDeployEvents>(
    "ActivitiesModule",
    "ActivityDeployEvents",
  );
  const event = (target: "qa" | "prod", revision: string | null, at: string): DeployedEvent => ({
    projectId: s.project,
    activityId: s.activity.id,
    runId: "dep_1",
    target,
    revision,
    deployedAt: at,
  });
  const status = async () =>
    (await (await s.client.get(`${s.endpoint}/versions/status`)).json()) as VersionStatus;
  return { versions, events, event, status };
}

describe("deployed versions and drift", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("says never deployed, then in sync, then changed since the QA deploy", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    const { versions, event, status } = api(s);
    expect(await status()).toEqual({
      qa: "never",
      prod: "never",
      qaVersion: null,
      prodVersion: null,
    });
    await s.describe("Went to QA");
    const revision = (await s.read()).draft.contentRevision;
    const marked = await versions.markDeployed(event("qa", revision, "2026-09-28T10:00:00.000Z"));
    expect(marked).toMatchObject({
      seq: 1,
      kind: "deploy",
      current: true,
      deployed: { qa: "2026-09-28T10:00:00.000Z", prod: null },
    });
    expect(await status()).toEqual({
      qa: "in_sync",
      prod: "never",
      qaVersion: { versionId: marked!.versionId, seq: 1, deployedAt: "2026-09-28T10:00:00.000Z" },
      prodVersion: null,
    });

    await s.describe("Edited after QA");
    expect(await status()).toMatchObject({ qa: "changed", prod: "never" });
    // The list carries the marker too.
    const [row] = await s.list();
    expect(row).toMatchObject({ seq: 1, current: false, deployed: { qa: expect.any(String) } });
  });

  it("marks the latest version when the draft still holds it, making none", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    const { versions, event, status } = api(s);
    await s.describe("Saved first");
    const manual = await s.saved({ label: "Release" });
    const revision = (await s.read()).draft.contentRevision;
    await versions.markDeployed(event("qa", revision, "2026-09-28T10:00:00.000Z"));
    await versions.markDeployed(event("prod", revision, "2026-09-28T11:00:00.000Z"));
    const list = await s.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      versionId: manual.versionId,
      kind: "manual",
      deployed: { qa: "2026-09-28T10:00:00.000Z", prod: "2026-09-28T11:00:00.000Z" },
    });
    expect(await status()).toMatchObject({
      qa: "in_sync",
      prod: "in_sync",
      prodVersion: { seq: 1, deployedAt: "2026-09-28T11:00:00.000Z" },
    });
  });

  it("marks versions from the deploy events hook", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    const { events, event, status } = api(s);
    await s.describe("Through the hook");
    events.emit(event("qa", (await s.read()).draft.contentRevision, "2026-09-28T10:00:00.000Z"));
    await expect.poll(async () => (await status()).qa).toBe("in_sync");
    expect((await s.list()).map((v) => v.kind)).toEqual(["deploy"]);
  });

  it("marks the version holding an older revision when the draft changed since", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    const { versions, event, status } = api(s);
    await s.describe("What was exported");
    const exported = (await s.read()).draft.contentRevision;
    const v1 = await s.saved();
    await s.describe("Edited while the deploy ran");
    const marked = await versions.markDeployed(event("qa", exported, "2026-09-28T10:00:00.000Z"));
    expect(marked).toMatchObject({ versionId: v1.versionId, current: false });
    expect(await status()).toMatchObject({ qa: "changed", qaVersion: { seq: 1 } });
    // A revision no version holds marks nothing.
    expect(
      await versions.markDeployed(event("prod", "f".repeat(64), "2026-09-28T11:00:00.000Z")),
    ).toBeNull();
    expect((await status()).prod).toBe("never");
  });

  it("lets a member read the status", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    const member = await provisionUser(s.t.app, "status_reader");
    expect(
      (await s.client.post(`/api/projects/${PROJECT}/members`, { userId: "status_reader" })).status,
    ).toBeLessThan(300);
    const reader = apiClient(s.t.app, member.cookie);
    const response = await reader.get(`${s.endpoint}/versions/status`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ qa: "never", prod: "never" });
  });
});
