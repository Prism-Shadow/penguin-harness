/**
 * handbook-tree.ts unit tests: the listing shaped into the pinned index, the documents beside
 * it and the top-level folders (root documents first, folders and documents in path order, a
 * deeper path labelled by its remainder); the path rule mirrored from the server; what the
 * new-document dialog sends for what was typed; the body a new document starts with; and how
 * a relative link inside a document resolves to another document of the handbook.
 */
import { describe, expect, it } from "vitest";
import type { OrgHandbookFile } from "@prismshadow/penguin-server/api";
import {
  HANDBOOK_INDEX,
  buildHandbookTree,
  completeHandbookPath,
  fileName,
  isHandbookPath,
  isMarkdownPath,
  newDocumentBody,
  resolveHandbookLink,
} from "../src/features/company/handbook-tree";

const file = (path: string, size = 10): OrgHandbookFile => ({
  path,
  size,
  updatedAt: "2026-09-02T10:00:00.000Z",
});

describe("buildHandbookTree", () => {
  it("pins the index apart, lists root documents by path, then one group per top-level folder", () => {
    const tree = buildHandbookTree([
      file("README.md"),
      file("decisions/2026-09-02-hire-plan.md"),
      file("conventions.md"),
      file("decisions/2026-09-01-mission.md"),
      file("roles/hr.md"),
      file("brand.md"),
    ]);
    expect(tree.index?.path).toBe(HANDBOOK_INDEX);
    expect(tree.root.map((d) => d.label)).toEqual(["brand.md", "conventions.md"]);
    expect(tree.folders.map((f) => f.name)).toEqual(["decisions", "roles"]);
    expect(tree.folders[0]?.docs.map((d) => d.label)).toEqual([
      "2026-09-01-mission.md",
      "2026-09-02-hire-plan.md",
    ]);
    // A row keeps the whole path for selection, and its label for display.
    expect(tree.folders[0]?.docs[0]?.path).toBe("decisions/2026-09-01-mission.md");
  });

  it("labels a document two levels down by its remainder under the top-level folder", () => {
    const tree = buildHandbookTree([file("README.md"), file("decisions/2026/09/plan.md")]);
    expect(tree.folders).toEqual([
      {
        name: "decisions",
        docs: [{ ...file("decisions/2026/09/plan.md"), label: "2026/09/plan.md" }],
      },
    ]);
  });

  it("orders by path whatever order the listing came in, and copes with a missing index", () => {
    const tree = buildHandbookTree([file("z.md"), file("a.md"), file("m/x.md"), file("b/y.md")]);
    expect(tree.index).toBeNull();
    expect(tree.root.map((d) => d.path)).toEqual(["a.md", "z.md"]);
    expect(tree.folders.map((f) => f.name)).toEqual(["b", "m"]);
  });

  it("is empty but for the index when the handbook holds nothing else", () => {
    const tree = buildHandbookTree([file("README.md")]);
    expect(tree.index).not.toBeNull();
    expect(tree.root).toEqual([]);
    expect(tree.folders).toEqual([]);
  });
});

describe("isHandbookPath", () => {
  it("accepts plain segments joined by slashes", () => {
    for (const rel of [
      "README.md",
      "conventions.md",
      "decisions/2026-09-02-hire-plan.md",
      "a/b/c/d/e/f/g/h.md",
      "notes.v2",
      "2026",
    ]) {
      expect(isHandbookPath(rel), rel).toBe(true);
    }
  });

  it("refuses hidden files, traversal, empty segments, other characters and a ninth level", () => {
    for (const rel of [
      "",
      ".hidden.md",
      "decisions/.draft.md",
      "../org_config.toml",
      "a/../b.md",
      "/abs.md",
      "a//b.md",
      "a/",
      "hire plan.md",
      "notes:1.md",
      "a/b/c/d/e/f/g/h/i.md",
    ]) {
      expect(isHandbookPath(rel), rel).toBe(false);
    }
  });
});

describe("completeHandbookPath", () => {
  it("trims, drops a leading ./ or / and a trailing /, and adds .md when the name has no extension", () => {
    expect(completeHandbookPath("  decisions/hire-plan  ")).toBe("decisions/hire-plan.md");
    expect(completeHandbookPath("./conventions.md")).toBe("conventions.md");
    expect(completeHandbookPath("/roles/hr")).toBe("roles/hr.md");
    expect(completeHandbookPath("roles/")).toBe("roles.md");
  });

  it("leaves a name with an extension alone, and an empty input empty", () => {
    expect(completeHandbookPath("notes.txt")).toBe("notes.txt");
    expect(completeHandbookPath("notes.v2")).toBe("notes.v2");
    expect(completeHandbookPath("   ")).toBe("");
  });
});

describe("file names and bodies", () => {
  it("names a file by its last segment and renders Markdown by extension", () => {
    expect(fileName("decisions/2026-09-02-hire-plan.md")).toBe("2026-09-02-hire-plan.md");
    expect(fileName("README.md")).toBe("README.md");
    expect(isMarkdownPath("README.md")).toBe(true);
    expect(isMarkdownPath("notes.MARKDOWN")).toBe(true);
    expect(isMarkdownPath("notes.txt")).toBe(false);
    expect(isMarkdownPath("2026")).toBe(false);
  });

  it("starts a new document with a title made of its file name", () => {
    expect(newDocumentBody("decisions/2026-09-02-hire-plan.md")).toBe("# 2026-09-02-hire-plan\n");
    expect(newDocumentBody("notes.v2")).toBe("# notes\n");
  });
});

describe("resolveHandbookLink", () => {
  it("resolves a relative link against the linking document's folder", () => {
    expect(resolveHandbookLink("README.md", "decisions/hire-plan.md")).toBe(
      "decisions/hire-plan.md",
    );
    expect(resolveHandbookLink("README.md", "./conventions.md")).toBe("conventions.md");
    expect(resolveHandbookLink("decisions/hire-plan.md", "../conventions.md")).toBe(
      "conventions.md",
    );
    expect(resolveHandbookLink("decisions/hire-plan.md", "mission.md")).toBe(
      "decisions/mission.md",
    );
    expect(resolveHandbookLink("decisions/hire-plan.md", "/roles/hr.md")).toBe("roles/hr.md");
  });

  it("drops a fragment or query, and decodes the path", () => {
    expect(resolveHandbookLink("README.md", "conventions.md#naming")).toBe("conventions.md");
    expect(resolveHandbookLink("README.md", "conventions.md?x=1")).toBe("conventions.md");
    expect(resolveHandbookLink("README.md", "hire%2Dplan.md")).toBe("hire-plan.md");
  });

  it("is null for anything that is not a document of the handbook", () => {
    for (const href of [
      "",
      "#top",
      "https://example.com/README.md",
      "mailto:ceo@example.com",
      "//example.com/x.md",
      "../org_config.toml",
      "../../etc/passwd",
      ".hidden.md",
      "%E0%A4%A",
    ]) {
      expect(resolveHandbookLink("README.md", href), href).toBeNull();
    }
    expect(resolveHandbookLink("decisions/plan.md", "../../out.md")).toBeNull();
  });
});
