import { describe, expect, it } from "vitest";
import type { VersionDiff } from "@prismshadow/penguin-server/api";
import {
  compareTabs,
  isSame,
  mediaChangeRows,
  restoreProblem,
} from "../src/features/activities/versions-model";

const diff: VersionDiff = {
  files: [
    { name: "description", before: "Old script", after: "New script" },
    { name: "features", before: null, after: '[\n  "a"\n]' },
  ],
  media: [
    { path: "audio/run_b.wav", change: "changed", beforeBytes: 2048, afterBytes: 4096 },
    { path: "media/uploads/new.png", change: "added", beforeBytes: null, afterBytes: 10 },
    { path: "media/uploads/old.png", change: "removed", beforeBytes: 5, afterBytes: null },
  ],
};

describe("compareTabs", () => {
  it("names each changed part, reading a missing side as empty", () => {
    expect(compareTabs(diff)).toEqual([
      { key: "description", label: "Script", before: "Old script", after: "New script" },
      { key: "features", label: "Implementation features", before: "", after: '[\n  "a"\n]' },
    ]);
  });
});

describe("mediaChangeRows", () => {
  it("words each change and each side's size", () => {
    expect(mediaChangeRows(diff)).toEqual([
      { path: "audio/run_b.wav", change: "Changed", before: "2.0 KB", after: "4.0 KB" },
      { path: "media/uploads/new.png", change: "Added", before: "None", after: "10 B" },
      { path: "media/uploads/old.png", change: "Removed", before: "5 B", after: "None" },
    ]);
  });
});

describe("isSame", () => {
  it("is true only when nothing differs", () => {
    expect(isSame({ files: [], media: [] })).toBe(true);
    expect(isSame(diff)).toBe(false);
  });
});

describe("restoreProblem", () => {
  it("names the missing file the server reports", () => {
    expect(restoreProblem("version_incomplete", { path: "audio/run_a.wav" })).toBe(
      "This version cannot be restored: its file audio/run_a.wav is missing or damaged. Nothing changed.",
    );
  });

  it("says the record is missing when no file is named", () => {
    expect(restoreProblem("version_incomplete", undefined)).toMatch(/its record is missing/);
  });

  it("leaves other refusals to the usual error text", () => {
    expect(restoreProblem("draft_conflict", { path: "audio/run_a.wav" })).toBeNull();
  });
});
