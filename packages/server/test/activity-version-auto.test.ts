/**
 * Automatic versions before an agent's proposal: the draft as it was is kept first, a draft
 * that equals the latest version keeps nothing new, a stale revision keeps nothing, and a
 * proposal that fails leaves the draft and keeps only what it already was.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { ProposalChange } from "../src/activities/assist.js";
import type { ActivityVersions } from "../src/activities/version-service.js";
import { activitySpec } from "./activity-fixtures.js";
import { versionsApp, type VersionsApp } from "./activity-version-fixtures.js";

const PROJECT = "versions-auto";

function api(s: VersionsApp) {
  const versions = s.t.deps.tree.api<ActivityVersions>("ActivitiesModule", "ActivityVersions");
  /** Apply a proposal the way the route does: keep the draft first, then apply it. */
  const apply = (changes: ProposalChange[], expectedRevision: string) =>
    versions.keepBefore(
      s.project,
      s.activity.id,
      { reason: "before_proposal", author: "author", expectedRevision },
      () => s.authoring.applyProposal(s.project, s.activity.id, changes, expectedRevision),
    );
  return { versions, apply };
}

describe("automatic versions before a proposal", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("keeps the draft as it was before applying a proposal", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    const { versions, apply } = api(s);
    await s.describe("The script before");
    const before = (await s.read()).draft;
    const draft = await apply(
      [
        { target: "description", text: "The script after" },
        { target: "spec", spec: activitySpec },
      ],
      before.contentRevision,
    );
    expect(draft.description).toBe("The script after");
    const list = await s.list();
    expect(list.map((v) => [v.seq, v.kind, v.reason, v.author, v.current])).toEqual([
      [1, "auto", "before_proposal", "author", false],
    ]);
    // The version holds the script as it was: compared with the draft, only that differs.
    const diff = await versions.diff(s.project, s.activity.id, list[0]!.versionId, "current");
    expect(diff.files.find((file) => file.name === "description")).toEqual({
      name: "description",
      before: "The script before",
      after: "The script after",
    });
  });

  it("keeps nothing new when the draft equals the latest version", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    const { apply } = api(s);
    await s.describe("Saved by hand");
    const manual = await s.saved({ label: "By hand" });
    await apply(
      [{ target: "description", text: "From the agent" }],
      (await s.read()).draft.contentRevision,
    );
    const list = await s.list();
    expect(list.map((v) => [v.seq, v.kind])).toEqual([[1, "manual"]]);
    expect(list[0]!.versionId).toBe(manual.versionId);
  });

  it("refuses a stale revision before keeping anything", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    const { apply } = api(s);
    const stale = (await s.read()).draft.contentRevision;
    await s.describe("Changed meanwhile");
    await expect(apply([{ target: "description", text: "Never" }], stale)).rejects.toMatchObject({
      status: 409,
      code: "draft_conflict",
    });
    expect(await s.list()).toEqual([]);
    expect((await s.read()).draft.description).toBe("Changed meanwhile");
  });

  it("leaves the draft when the proposal fails, and a second try keeps nothing new", async () => {
    const s = await versionsApp(PROJECT, cleanups);
    const { apply } = api(s);
    await s.describe("Unchanged");
    const revision = (await s.read()).draft.contentRevision;
    const bad: ProposalChange[] = [{ target: "spec", spec: { not: "a spec" } }];
    await expect(apply(bad, revision)).rejects.toMatchObject({ status: 422 });
    await expect(apply(bad, revision)).rejects.toMatchObject({ status: 422 });
    expect((await s.read()).draft.description).toBe("Unchanged");
    const list = await s.list();
    expect(list.map((v) => [v.seq, v.kind, v.current])).toEqual([[1, "auto", true]]);
  });
});
