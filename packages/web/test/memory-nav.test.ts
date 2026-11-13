/**
 * memory-nav.ts unit tests: entry routing (locate target → detail, panel entry → list),
 * back behavior, the list view-model (markers; deleted topics absent once the listing is
 * loaded; change-derived rows while it is not), and the deleted-key filter set.
 *
 * Files a topic keeps (`<topic>/<path>`):
 * - A file the conversation wrote into a topic's folder is listed right under that topic, by
 *   its path, and the topic row counts its files; untouched files stay off the list.
 * - Such a file is still there as far as the memory-changes card is concerned, so the card
 *   keeps its row; one that was deleted afterwards is filtered out like a topic.
 * - Files in a folder no topic keeps are listed apart, not dropped.
 */
import { describe, expect, it } from "vitest";
import type {
  MemoryFileInfo,
  MemoryFolderFile,
  MemoryScopeInfo,
} from "@prismshadow/penguin-server/api";
import { type MemoryChangeRow, memoryRowKey } from "../src/lib/amsp/memory-changes";
import {
  buildMemoryList,
  deletedChangeKeys,
  memoryNavBack,
  memoryNavForRequest,
  type ScopeFiles,
} from "../src/features/chat/memory-nav";

describe("memoryNavForRequest / memoryNavBack", () => {
  it("no request, and a request without a target (panel or card-header entry), land on the list", () => {
    expect(memoryNavForRequest(null)).toEqual({ kind: "list" });
    expect(memoryNavForRequest({ target: null })).toEqual({ kind: "list" });
  });

  it("a locate target (card row click) lands directly on that memory's detail", () => {
    const target = { scope: "user" as const, file: "prefs.md" };
    expect(memoryNavForRequest({ target })).toEqual({ kind: "detail", target });
  });

  it("back always returns to the list", () => {
    expect(memoryNavBack()).toEqual({ kind: "list" });
  });
});

function scopeInfo(
  overrides: Partial<MemoryScopeInfo> & Pick<MemoryScopeInfo, "scopeKey" | "kind">,
): MemoryScopeInfo {
  return { fileCount: 0, hasIndex: true, ...overrides };
}

function kept(filePath: string): MemoryFolderFile {
  return { path: filePath, size: 1, modifiedAt: "2026-08-21T00:00:00.000Z" };
}

function fileInfo(name: string, title = name, files: MemoryFolderFile[] = []): MemoryFileInfo {
  return { name, title, description: "", size: 1, modifiedAt: "2026-08-20T00:00:00.000Z", files };
}

const LISTING: ScopeFiles[] = [
  {
    info: scopeInfo({ scopeKey: "user", kind: "user" }),
    files: [fileInfo("prefs.md", "Prefs")],
    orphanFiles: [],
  },
  {
    info: scopeInfo({ scopeKey: "ws-1", kind: "workspace", workspacePath: "/w/app" }),
    files: [fileInfo("conventions.md")],
    orphanFiles: [],
  },
];

/** A user scope whose csv-tools memory keeps three files, beside a folder no memory keeps. */
const WITH_FILES: ScopeFiles[] = [
  {
    info: scopeInfo({ scopeKey: "user", kind: "user" }),
    files: [
      fileInfo("csv-tools.md", "CSV tools", [
        kept("csv-tools/dedupe.py"),
        kept("csv-tools/lib/io.py"),
        kept("csv-tools/report.sh"),
      ]),
      fileInfo("prefs.md", "Prefs"),
    ],
    orphanFiles: [kept("leftover/old.py")],
  },
];

const change = (
  scope: "user" | "workspace",
  file: string,
  op: "write" | "edit",
  scopeKey?: string,
): MemoryChangeRow => ({
  scope,
  ...(scopeKey !== undefined ? { scopeKey } : {}),
  file,
  op,
});

describe("buildMemoryList", () => {
  it("keeps listing order and marks changed topics", () => {
    const groups = buildMemoryList(LISTING, [change("user", "prefs.md", "edit")]);
    expect(groups.map((g) => g.scopeKey)).toEqual(["user", "ws-1"]);
    expect(groups[0]!.rows.map((r) => [r.target.file, r.title, r.changed])).toEqual([
      ["prefs.md", "Prefs", "edit"],
    ]);
    expect(groups[1]!.workspacePath).toBe("/w/app");
    expect(groups[1]!.rows[0]!.changed).toBeUndefined();
  });

  it("a changed file the loaded listing no longer carries was deleted: it does not appear", () => {
    const groups = buildMemoryList(LISTING, [change("user", "gone.md", "write")]);
    expect(groups[0]!.rows.map((r) => r.target.file)).toEqual(["prefs.md"]);
  });

  it("a null listing (not loaded) shows change-derived rows — unknown must not read as deleted", () => {
    const groups = buildMemoryList(null, [
      change("user", "a.md", "write"),
      change("workspace", "b.md", "edit", "ws-9"),
    ]);
    expect(
      groups.map((g) => [
        g.scope,
        g.scopeKey,
        g.rows.map((r) => [r.target.scopeKey, r.target.file, r.title, r.changed]),
      ]),
    ).toEqual([
      ["user", "user", [[undefined, "a.md", "a.md", "write"]]],
      ["workspace", "ws-9", [["ws-9", "b.md", "b.md", "edit"]]],
    ]);
  });
});

describe("buildMemoryList — the files a topic keeps", () => {
  it("lists a file the conversation wrote right under the topic that keeps it, by its path", () => {
    const groups = buildMemoryList(WITH_FILES, [change("user", "csv-tools/lib/io.py", "write")]);
    expect(groups[0]!.rows.map((r) => [r.kind, r.title, r.changed])).toEqual([
      ["topic", "CSV tools", undefined],
      ["file", "csv-tools/lib/io.py", "write"],
      ["topic", "Prefs", undefined],
    ]);
    // The topic row says how many files it keeps; the ones nobody touched stay off the list.
    expect(groups[0]!.rows[0]!.fileCount).toBe(3);
  });

  it("lists the files of a folder no topic keeps apart, rather than dropping them", () => {
    const groups = buildMemoryList(WITH_FILES, [change("user", "leftover/old.py", "edit")]);
    expect(groups[0]!.orphanRows.map((r) => [r.title, r.changed])).toEqual([
      ["leftover/old.py", "edit"],
    ]);
  });

  it("while the listing has not loaded, a changed kept file shows as a file row", () => {
    const groups = buildMemoryList(null, [change("user", "csv-tools/dedupe.py", "write")]);
    expect(groups[0]!.rows.map((r) => [r.kind, r.title])).toEqual([
      ["file", "csv-tools/dedupe.py"],
    ]);
  });
});

describe("deletedChangeKeys", () => {
  const changes = [change("user", "prefs.md", "edit"), change("user", "gone.md", "write")];

  it("null while the listing hasn't loaded — unknown must not read as deleted", () => {
    expect(deletedChangeKeys(null, changes)).toBeNull();
  });

  it("marks exactly the changed files the loaded listing no longer carries", () => {
    const keys = deletedChangeKeys(LISTING, changes);
    expect(keys).not.toBeNull();
    expect([...keys!]).toEqual(["user  gone.md"]);
  });

  it("empty set when every changed file is still listed", () => {
    expect([...deletedChangeKeys(LISTING, [change("user", "prefs.md", "edit")])!]).toEqual([]);
  });

  it("keeps a file the conversation wrote into a topic's folder, and drops one deleted since", () => {
    const keys = deletedChangeKeys(WITH_FILES, [
      change("user", "csv-tools/report.sh", "write"),
      change("user", "leftover/old.py", "edit"),
      change("user", "csv-tools/gone.py", "write"),
    ]);
    expect([...keys!]).toEqual([memoryRowKey({ scope: "user", file: "csv-tools/gone.py" })]);
  });
});
