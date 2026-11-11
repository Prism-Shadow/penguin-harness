/**
 * The Memory tab's whole-scope transfer helpers: what counts as a scope document, and what each
 * import mode would cost the group it is aimed at.
 *
 * The plan is what the confirmation reads from, so these pin the two halves that matter — the
 * default mode destroys nothing, and every mode that does report exactly which memories.
 *
 * A memory moves with the files its folder keeps: a document of either version reads, and
 * `replace` names a folder no memory keeps among what it deletes, while one that a memory in the
 * file is named after counts as that memory being here.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { MemoryScopeExport } from "@prismshadow/penguin-server/api";
import { S, setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import {
  MemoryDocumentError,
  memoryDocumentFileName,
  parseMemoryScopeDocument,
  planMemoryImport,
} from "../src/features/agents/memory-transfer";

afterEach(() => setActiveStrings(zh));

const doc = (names: string[], index: string | null = "# Memories\n"): MemoryScopeExport => ({
  format: "penguin-memory-scope",
  version: 2,
  scopeKey: "my-app-a81f32c4",
  kind: "workspace",
  exportedAt: "2026-08-20T00:00:00.000Z",
  index,
  files: names.map((name) => ({
    name,
    content: `---\nname: ${name}\n---\nbody\n`,
    files: [{ path: "run.py", content: "print(1)\n" }],
  })),
  omitted: [],
});

describe("parseMemoryScopeDocument", () => {
  it("reads a document the export route produced", () => {
    const parsed = parseMemoryScopeDocument(JSON.stringify(doc(["a.md", "b.md"])));
    expect(parsed.files.map((f) => f.name)).toEqual(["a.md", "b.md"]);
    expect(parsed.scopeKey).toBe("my-app-a81f32c4");
  });

  it("reads a version 1 document, written before a memory kept files", () => {
    const v1 = {
      format: "penguin-memory-scope",
      version: 1,
      scopeKey: "my-app-a81f32c4",
      kind: "workspace",
      exportedAt: "2026-08-20T00:00:00.000Z",
      index: null,
      files: [{ name: "old.md", content: "x" }],
    };
    expect(parseMemoryScopeDocument(JSON.stringify(v1)).files.map((f) => f.name)).toEqual([
      "old.md",
    ]);
  });

  it("refuses anything that is not one, in the active language", () => {
    const refusals = [
      "not json at all",
      JSON.stringify([1, 2]),
      JSON.stringify({ ...doc(["a.md"]), format: "some-other-tool" }),
      JSON.stringify({ ...doc(["a.md"]), version: 3 }),
      JSON.stringify({ ...doc(["a.md"]), files: "nope" }),
      JSON.stringify({ ...doc([]), files: [{ name: "a.md" }] }),
    ];
    for (const text of refusals) {
      expect(() => parseMemoryScopeDocument(text)).toThrow(MemoryDocumentError);
    }
    setActiveStrings(en);
    expect(() => parseMemoryScopeDocument("{}")).toThrow(S.memory.importInvalidFile);
    setActiveStrings(zh);
    expect(() => parseMemoryScopeDocument("{}")).toThrow(S.memory.importInvalidFile);
  });

  it("calls a document with neither memories nor an index empty", () => {
    expect(() => parseMemoryScopeDocument(JSON.stringify(doc([], null)))).toThrow(
      S.memory.importEmptyFile,
    );
    // An index alone is still worth importing: it is the only part the model reads.
    expect(parseMemoryScopeDocument(JSON.stringify(doc([], "# Memories\n"))).files).toEqual([]);
  });
});

describe("planMemoryImport", () => {
  const scope = { names: ["keep.md", "gone.md"], orphanFolders: [], hasIndex: true };

  it("destroys nothing in the default mode", () => {
    const plan = planMemoryImport(doc(["keep.md", "new.md"]), scope, "skip");
    expect(plan).toMatchObject({
      added: ["new.md"],
      skipped: ["keep.md"],
      overwritten: [],
      removed: [],
      replacesIndex: false,
      destroys: false,
    });
  });

  it("names the memories overwrite would replace, and keeps the rest", () => {
    const plan = planMemoryImport(doc(["keep.md", "new.md"]), scope, "overwrite");
    expect(plan).toMatchObject({
      added: ["new.md"],
      overwritten: ["keep.md"],
      skipped: [],
      // A memory the file does not carry survives an overwrite.
      removed: [],
      destroys: true,
    });
  });

  it("names the memories replace would delete, and the index it would take over", () => {
    const plan = planMemoryImport(doc(["keep.md"]), scope, "replace");
    expect(plan).toMatchObject({
      added: [],
      overwritten: ["keep.md"],
      removed: ["gone.md"],
      replacesIndex: true,
      destroys: true,
    });
  });

  it("has nothing to confirm when the group is empty, whatever the mode", () => {
    const empty = { names: [], orphanFolders: [], hasIndex: false };
    for (const mode of ["skip", "overwrite", "replace"] as const) {
      const plan = planMemoryImport(doc(["new.md"]), empty, mode);
      expect(plan.destroys, mode).toBe(false);
      expect(plan.added).toEqual(["new.md"]);
    }
  });

  it("leaves an index alone that the document does not carry", () => {
    const plan = planMemoryImport(
      doc(["keep.md"], null),
      { names: [], orphanFolders: [], hasIndex: true },
      "replace",
    );
    expect(plan.replacesIndex).toBe(false);
    expect(plan.destroys).toBe(false);
  });

  it("names a folder no memory keeps among what replace deletes", () => {
    const withStray = { names: ["keep.md"], orphanFolders: ["leftover"], hasIndex: false };
    const plan = planMemoryImport(doc(["keep.md"]), withStray, "replace");
    expect(plan.removed).toEqual(["leftover/"]);
    expect(plan.destroys).toBe(true);
  });

  it("counts a folder named after a memory in the file as that memory being here", () => {
    const withStray = { names: [], orphanFolders: ["tools"], hasIndex: false };
    expect(planMemoryImport(doc(["tools.md"]), withStray, "skip")).toMatchObject({
      added: [],
      skipped: ["tools.md"],
      destroys: false,
    });
    expect(planMemoryImport(doc(["tools.md"]), withStray, "overwrite")).toMatchObject({
      overwritten: ["tools.md"],
      destroys: true,
    });
  });
});

describe("memoryDocumentFileName", () => {
  it("stamps the document's exportedAt in the viewer's local time", () => {
    const iso = "2026-08-21T03:07:00.000Z";
    // The expected stamp is computed with the same local-time getters the formatter uses,
    // so the assertion holds in any timezone the suite runs in.
    const d = new Date(iso);
    const p = (n: number): string => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    expect(memoryDocumentFileName("default_agent", "my-app-a81f32c4", iso)).toBe(
      `default_agent-my-app-a81f32c4-memory-${stamp}.json`,
    );
  });

  it("falls back to the unstamped name when exportedAt is unreadable", () => {
    expect(memoryDocumentFileName("default_agent", "my-app-a81f32c4", "not-a-date")).toBe(
      "default_agent-my-app-a81f32c4-memory.json",
    );
  });
});
