/**
 * memory-nav.ts unit tests: entry routing (locate target → detail, panel entry → list),
 * back behavior, the list view-model (markers; deleted topics absent once the listing is
 * loaded; change-derived rows while it is not), and the deleted-key filter set.
 *
 * - Given a script the conversation wrote and the listing carries under `scripts/`, the list
 *   shows it by its path, marked changed, and the memory-changes card does not treat it as
 *   deleted.
 */
import { describe, expect, it } from "vitest";
import type { MemoryFileInfo, MemoryScopeInfo } from "@prismshadow/penguin-server/api";
import type { MemoryChangeRow } from "../src/lib/amsp/memory-changes";
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

function fileInfo(name: string, title = name): MemoryFileInfo {
  return {
    name,
    path: name,
    kind: "topic",
    title,
    description: "",
    size: 1,
    modifiedAt: "2026-08-20T00:00:00.000Z",
  };
}

/** A script as the listing gives it: under `scripts/`, its name for a title. */
function scriptInfo(name: string): MemoryFileInfo {
  return { ...fileInfo(name), path: `scripts/${name}`, kind: "script" };
}

const LISTING: ScopeFiles[] = [
  { info: scopeInfo({ scopeKey: "user", kind: "user" }), files: [fileInfo("prefs.md", "Prefs")] },
  {
    info: scopeInfo({ scopeKey: "ws-1", kind: "workspace", workspacePath: "/w/app" }),
    files: [fileInfo("conventions.md")],
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
    expect(groups).toHaveLength(2);
    expect(groups[0]!.rows).toEqual([
      {
        target: { scope: "user", file: "prefs.md" },
        kind: "topic",
        title: "Prefs",
        modifiedAt: "2026-08-20T00:00:00.000Z",
        changed: "edit",
      },
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
    expect(groups).toEqual([
      {
        scope: "user",
        scopeKey: "user",
        rows: [
          {
            target: { scope: "user", file: "a.md" },
            kind: "topic",
            title: "a.md",
            changed: "write",
          },
        ],
      },
      {
        scope: "workspace",
        scopeKey: "ws-9",
        rows: [
          {
            target: { scope: "workspace", scopeKey: "ws-9", file: "b.md" },
            kind: "topic",
            title: "b.md",
            changed: "edit",
          },
        ],
      },
    ]);
  });
});

describe("a script in the listing", () => {
  const listing: ScopeFiles[] = [
    LISTING[0]!,
    { ...LISTING[1]!, files: [fileInfo("conventions.md"), scriptInfo("dedupe.py")] },
  ];
  const wrote = [change("workspace", "scripts/dedupe.py", "write", "ws-1")];

  it("is listed by its path after the topics, with this conversation's change marked", () => {
    const rows = buildMemoryList(listing, wrote)[1]!.rows;
    expect(rows.map((r) => [r.kind, r.title, r.changed])).toEqual([
      ["topic", "conventions.md", undefined],
      ["script", "scripts/dedupe.py", "write"],
    ]);
    expect(rows[1]!.target).toEqual({
      scope: "workspace",
      scopeKey: "ws-1",
      file: "scripts/dedupe.py",
    });
  });

  it("is not mistaken for a deleted file by the memory-changes card", () => {
    expect([...deletedChangeKeys(listing, wrote)!]).toEqual([]);
  });

  it("reads as a script from its path while the listing has not loaded", () => {
    expect(buildMemoryList(null, wrote)[0]!.rows[0]!.kind).toBe("script");
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
});
