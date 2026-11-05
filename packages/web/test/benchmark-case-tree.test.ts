/**
 * The Benchmark case browser's tree rows: two top-level directories, one per material, over
 * listings fetched one directory per level — a closed material holds its children back, a
 * directory whose listing has not arrived reports itself unloaded, and every path names the
 * material it came from so the two file spaces cannot collide.
 */
import { describe, expect, it } from "vitest";
import type { WorkspaceFileEntry } from "@prismshadow/penguin-server/api";
import { caseTreeRows } from "../src/features/benchmark/benchmark-case-browser";
import type { CaseMaterialSpec } from "../src/features/benchmark/benchmark-case-browser";

const MTIME = "2026-09-12T00:00:00.000Z";

const dir = (name: string): WorkspaceFileEntry => ({
  name,
  kind: "dir",
  sizeBytes: 0,
  mtime: MTIME,
});
const file = (name: string, sizeBytes = 12): WorkspaceFileEntry => ({
  name,
  kind: "file",
  sizeBytes,
  mtime: MTIME,
});

const MATERIALS: CaseMaterialSpec[] = [
  { material: "statement", label: "Task materials" },
  { material: "rubric", label: "Scoring rubric" },
];

const LISTINGS = new Map<string, WorkspaceFileEntry[]>([
  ["statement", [dir("assets"), file("README.md")]],
  ["statement/assets", [file("chart.png", 2048)]],
  ["rubric", [file("README.md")]],
]);

describe("caseTreeRows", () => {
  it("walks every open directory and prefixes each path with its material", () => {
    const expanded = new Set(["statement", "statement/assets", "rubric"]);
    expect(
      caseTreeRows(MATERIALS, LISTINGS, expanded).map((r) => [r.path, r.kind, r.depth, r.material]),
    ).toEqual([
      ["statement", "dir", 0, "statement"],
      ["statement/assets", "dir", 1, "statement"],
      ["statement/assets/chart.png", "file", 2, "statement"],
      ["statement/README.md", "file", 1, "statement"],
      ["rubric", "dir", 0, "rubric"],
      ["rubric/README.md", "file", 1, "rubric"],
    ]);
  });

  it("keeps a closed material's row and none of its children", () => {
    const rows = caseTreeRows(MATERIALS, LISTINGS, new Set(["rubric"]));
    expect(rows.map((r) => r.path)).toEqual(["statement", "rubric", "rubric/README.md"]);
    expect(rows[0]).toMatchObject({ expanded: false, loaded: true, empty: false });
  });

  it("reports a directory whose listing has not arrived as unloaded", () => {
    const expanded = new Set(["statement", "statement/assets", "rubric"]);
    const rows = caseTreeRows(MATERIALS, new Map([["statement", [dir("assets")]]]), expanded);
    expect(rows.map((r) => [r.path, r.loaded, r.expanded])).toEqual([
      ["statement", true, true],
      // Open, and waiting for its own listing: no children, and the tree draws no group for it.
      ["statement/assets", false, true],
      ["rubric", false, true],
    ]);
  });

  it("marks a listed directory holding nothing as empty", () => {
    const rows = caseTreeRows(MATERIALS, new Map([["statement", []]]), new Set(["statement"]));
    expect(rows[0]).toMatchObject({ path: "statement", loaded: true, empty: true });
  });

  it("states each row's own position among its siblings, for the flat list to announce", () => {
    const expanded = new Set(["statement", "statement/assets", "rubric"]);
    expect(
      caseTreeRows(MATERIALS, LISTINGS, expanded).map((r) => `${r.posInSet}/${r.setSize}`),
    ).toEqual(["1/2", "1/2", "1/1", "2/2", "2/2", "1/1"]);
  });

  it("carries a file's size for the row to show, and none for a directory", () => {
    const rows = caseTreeRows(MATERIALS, LISTINGS, new Set(["statement", "statement/assets"]));
    const sizes = new Map(rows.map((r) => [r.path, r.sizeBytes] as const));
    expect(sizes.get("statement/assets/chart.png")).toBe(2048);
    expect(sizes.get("statement/assets")).toBe(0);
    expect(sizes.get("statement")).toBe(0);
  });
});
