/**
 * memory-nav.ts unit tests: entry routing (locate target → detail, panel entry → list),
 * back behavior, the list view-model (markers; deleted topics absent once the listing is
 * loaded; change-derived rows while it is not), and the deleted-key filter set.
 */
import { describe, expect, it } from "vitest";
import type { MemoryFileInfo, MemoryScopeInfo } from "@prismshadow/penguin-server/api";
import type { MemoryChangeRow } from "../src/lib/omni/memory-changes";
import {
  buildMemoryList,
  deletedChangeKeys,
  memoryNavBack,
  memoryNavForRequest,
} from "../src/features/chat/memory-nav";
import type { ScopeFiles } from "../src/features/chat/memory-nav";

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
  return { name, title, description: "", size: 1, modifiedAt: "2026-08-20T00:00:00.000Z" };
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
        rows: [{ target: { scope: "user", file: "a.md" }, title: "a.md", changed: "write" }],
      },
      {
        scope: "workspace",
        scopeKey: "ws-9",
        rows: [
          {
            target: { scope: "workspace", scopeKey: "ws-9", file: "b.md" },
            title: "b.md",
            changed: "edit",
          },
        ],
      },
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
});
