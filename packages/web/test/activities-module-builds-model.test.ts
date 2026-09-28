import { describe, expect, it } from "vitest";
import type {
  ModuleBuild,
  ModuleBuildDiff,
  ModuleBuildList,
  VersionStatus,
} from "@prismshadow/penguin-server/api";
import {
  buildFileRows,
  buildLabel,
  buildRows,
  compareOrder,
  olderBuildPlaying,
  pinGone,
  textFiles,
  toggleBuild,
} from "../src/features/activities/module-builds-model";
import { deployedBadges, statusLines } from "../src/features/activities/versions-model";

const A = `run_aaaaaa${"0".repeat(26)}`;
const B = `run_bbbbbb${"0".repeat(26)}`;
const C = `run_cccccc${"0".repeat(26)}`;

const build = (runId: string, day: number, extra: Partial<ModuleBuild> = {}): ModuleBuild => ({
  runId,
  createdAt: `2026-09-2${day}T10:00:00.000Z`,
  finishedAt: `2026-09-2${day}T10:05:00.000Z`,
  files: 12,
  newest: false,
  ...extra,
});

const list = (extra: Partial<ModuleBuildList> = {}): ModuleBuildList => ({
  builds: [build(C, 7, { newest: true }), build(A, 5, { files: null }), build(B, 6, { files: 1 })],
  pinnedRunId: null,
  playingRunId: C,
  ...extra,
});

describe("module build rows", () => {
  it("lists newest first with a short name, file count and which one plays", () => {
    const rows = buildRows(list({ pinnedRunId: B, playingRunId: B }));
    expect(rows.map((row) => row.label)).toEqual(["Build cccccc", "Build bbbbbb", "Build aaaaaa"]);
    expect(rows[0]).toMatchObject({ newest: true, playing: false, files: "12 files" });
    expect(rows[1]).toMatchObject({ playing: true, pinned: true, files: "1 file" });
    expect(rows[2]).toMatchObject({ files: "Folder missing" });
    expect(buildLabel("run_123456789")).toBe("Build 123456");
  });

  it("selects at most two builds and compares the older with the newer", () => {
    let selected = toggleBuild([], C);
    selected = toggleBuild(selected, A);
    expect(compareOrder(list().builds, selected)).toEqual({ from: A, to: C });
    selected = toggleBuild(selected, B);
    expect(selected).toEqual([A, B]);
    expect(compareOrder(list().builds, selected)).toEqual({ from: A, to: B });
    expect(compareOrder(list().builds, toggleBuild(selected, A))).toBeNull();
    expect(compareOrder(list().builds, [A, "run_gone"])).toBeNull();
  });

  it("says when the preview plays an older, pinned build", () => {
    expect(olderBuildPlaying(list())).toBeNull();
    expect(olderBuildPlaying(list({ pinnedRunId: A, playingRunId: A }))).toBe(A);
    // Pinned to the newest, or to a build that is gone, the newest plays.
    expect(olderBuildPlaying(list({ pinnedRunId: C, playingRunId: C }))).toBeNull();
    expect(olderBuildPlaying(list({ pinnedRunId: "run_gone", playingRunId: C }))).toBeNull();
  });

  it("names a pinned build that no longer plays, so it can still be unpinned", () => {
    expect(pinGone(list())).toBeNull();
    expect(pinGone(list({ pinnedRunId: A, playingRunId: A }))).toBeNull();
    expect(pinGone(list({ pinnedRunId: "run_gone", playingRunId: C }))).toBe("run_gone");
    expect(pinGone(list({ builds: [], pinnedRunId: A, playingRunId: null }))).toBe(A);
  });
});

describe("module build compare", () => {
  const diff: ModuleBuildDiff = {
    from: A,
    to: B,
    unchanged: 3,
    files: [
      {
        path: "res/image.png",
        change: "changed",
        beforeBytes: 3,
        afterBytes: 2048,
        text: "binary",
        before: null,
        after: null,
      },
      {
        path: "src/big.js",
        change: "changed",
        beforeBytes: 300_000,
        afterBytes: 300_001,
        text: "too_large",
        before: null,
        after: null,
      },
      {
        path: "src/new.ts",
        change: "added",
        beforeBytes: null,
        afterBytes: 6,
        text: "shown",
        before: null,
        after: "added\n",
      },
    ],
  };

  it("lists each file with its change, sizes and why its text is not shown", () => {
    expect(buildFileRows(diff)).toEqual([
      {
        path: "res/image.png",
        change: "Changed",
        before: "3 B",
        after: "2.0 KB",
        note: "Not shown: not a text file.",
      },
      {
        path: "src/big.js",
        change: "Changed",
        before: "293 KB",
        after: "293 KB",
        note: "Not shown: larger than 200 KB.",
      },
      { path: "src/new.ts", change: "Added", before: "None", after: "6 B", note: null },
    ]);
  });

  it("offers the text of the shown files only", () => {
    expect(textFiles(diff)).toEqual([{ path: "src/new.ts", before: "", after: "added\n" }]);
  });
});

describe("deploy status", () => {
  const when = (iso: string) => `at ${iso.slice(0, 10)}`;

  it("says in sync, changed or never, with the version that went", () => {
    const status: VersionStatus = {
      qa: "changed",
      prod: "never",
      qaVersion: { versionId: "ver_1", seq: 4, deployedAt: "2026-09-28T10:00:00.000Z" },
      prodVersion: null,
    };
    expect(statusLines(status, when)).toEqual([
      {
        target: "qa",
        text: "Changed since the QA deploy",
        tone: "attention",
        detail: "v4, at 2026-09-28",
      },
      { target: "prod", text: "Never deployed to PROD", tone: "muted", detail: null },
    ]);
    expect(
      statusLines(
        { ...status, qa: "in_sync", prod: "in_sync", prodVersion: status.qaVersion },
        when,
      ).map((line) => [line.text, line.tone]),
    ).toEqual([
      ["In sync with QA", "success"],
      ["In sync with PROD", "success"],
    ]);
  });

  it("badges a version that went to QA or PROD, naming when", () => {
    expect(deployedBadges({ deployed: { qa: null, prod: null } }, when)).toEqual([]);
    expect(
      deployedBadges(
        { deployed: { qa: "2026-09-27T10:00:00.000Z", prod: "2026-09-28T10:00:00.000Z" } },
        when,
      ),
    ).toEqual([
      { target: "qa", label: "QA", name: "Went to QA on at 2026-09-27" },
      { target: "prod", label: "PROD", name: "Went to PROD on at 2026-09-28" },
    ]);
  });
});
