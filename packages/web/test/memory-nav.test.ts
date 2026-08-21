/**
 * memory-nav.ts unit tests: entry routing (locate target → detail, tab entry → list),
 * back behavior, and merging the server listing with this conversation's changes into
 * the list view's groups.
 */
import { describe, expect, it } from "vitest";
import type { MemoryFileInfo, MemoryScopeInfo } from "@prismshadow/penguin-server/api";
import type { MemoryChangeRow } from "../src/lib/omni/memory-changes";
import {
  buildMemoryList,
  findChangeRow,
  memoryNavBack,
  memoryNavForRequest,
} from "../src/features/chat/memory-nav";
import type { ScopeFiles } from "../src/features/chat/memory-nav";

describe("memoryNavForRequest / memoryNavBack", () => {
  it("no request, and a request without a target (tab or card-header entry), land on the list", () => {
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
  return { fileCount: 0, ...overrides };
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
  events: [{ op }],
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
        listed: true,
      },
    ]);
    expect(groups[1]!.workspacePath).toBe("/w/app");
    expect(groups[1]!.rows[0]!.changed).toBeUndefined();
  });

  it("appends a changed file the listing doesn't carry to its scope's group", () => {
    const groups = buildMemoryList(LISTING, [change("user", "topics/new.md", "write")]);
    const rows = groups[0]!.rows;
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({
      target: { scope: "user", file: "topics/new.md" },
      title: "topics/new.md",
      changed: "write",
      listed: false,
    });
  });

  it("creates a missing group — a new User group goes first, a new Workspace group last", () => {
    const wsOnly: ScopeFiles[] = [LISTING[1]!];
    const groups = buildMemoryList(wsOnly, [
      change("user", "a.md", "write"),
      change("workspace", "b.md", "edit", "ws-2"),
    ]);
    expect(groups.map((g) => g.scopeKey)).toEqual(["user", "ws-1", "ws-2"]);
    expect(groups[0]!.rows[0]!.listed).toBe(false);
    expect(groups[2]!.rows[0]!.target).toEqual({
      scope: "workspace",
      scopeKey: "ws-2",
      file: "b.md",
    });
  });

  it("a null listing (loading or failed) yields groups from the changes alone", () => {
    const groups = buildMemoryList(null, [change("workspace", "b.md", "edit", "ws-9")]);
    expect(groups).toEqual([
      {
        scope: "workspace",
        scopeKey: "ws-9",
        rows: [
          {
            target: { scope: "workspace", scopeKey: "ws-9", file: "b.md" },
            title: "b.md",
            changed: "edit",
            listed: false,
          },
        ],
      },
    ]);
  });
});

describe("findChangeRow", () => {
  it("resolves a target to its change row by scope + key + file, and misses cleanly", () => {
    const rows = [change("workspace", "b.md", "edit", "ws-1")];
    expect(findChangeRow(rows, { scope: "workspace", scopeKey: "ws-1", file: "b.md" })).toBe(
      rows[0],
    );
    expect(
      findChangeRow(rows, { scope: "workspace", scopeKey: "ws-2", file: "b.md" }),
    ).toBeUndefined();
    expect(findChangeRow(rows, { scope: "user", file: "b.md" })).toBeUndefined();
  });
});
