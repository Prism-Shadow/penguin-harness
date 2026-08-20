/**
 * memory-changes.ts unit tests: classifying file-tool paths against the Memory root
 * (scopes, index/marker filtering, separator tolerance) and merging a Task's entries
 * into one row per file.
 */
import { describe, expect, it } from "vitest";
import { classifyMemoryPath, mergeMemoryChanges } from "../src/lib/omni/memory-changes";
import type { MemoryChangeEntry } from "../src/lib/omni/memory-changes";

const STATE = "/root/proj/agents/a1/agent_state";

describe("classifyMemoryPath", () => {
  it("classifies a User-scope topic file", () => {
    expect(classifyMemoryPath(`${STATE}/memory/user/prefs.md`, STATE)).toEqual({
      scope: "user",
      file: "prefs.md",
    });
  });

  it("classifies a Workspace-scope topic file with its scope key", () => {
    expect(classifyMemoryPath(`${STATE}/memory/ws-1a2b/conventions.md`, STATE)).toEqual({
      scope: "workspace",
      scopeKey: "ws-1a2b",
      file: "conventions.md",
    });
  });

  it("keeps subdirectory structure below the scope in `file`", () => {
    expect(classifyMemoryPath(`${STATE}/memory/user/topics/deep.md`, STATE)).toEqual({
      scope: "user",
      file: "topics/deep.md",
    });
  });

  it("filters the MEMORY.md index and the .workspace marker", () => {
    expect(classifyMemoryPath(`${STATE}/memory/user/MEMORY.md`, STATE)).toBeNull();
    expect(classifyMemoryPath(`${STATE}/memory/ws-1a2b/.workspace`, STATE)).toBeNull();
  });

  it("keeps a nested file that merely ends in MEMORY.md-like names", () => {
    // Only the scope's own index is noise; a topic file inside a subdirectory is content.
    expect(classifyMemoryPath(`${STATE}/memory/user/notes/MEMORY.md`, STATE)).toEqual({
      scope: "user",
      file: "notes/MEMORY.md",
    });
  });

  it("rejects paths outside the memory root", () => {
    expect(classifyMemoryPath("/w/src/app.ts", STATE)).toBeNull();
    expect(classifyMemoryPath(`${STATE}/AGENTS.md`, STATE)).toBeNull();
    expect(classifyMemoryPath(`${STATE}/memories/user/x.md`, STATE)).toBeNull();
  });

  it("rejects the memory root and a bare scope directory", () => {
    expect(classifyMemoryPath(`${STATE}/memory`, STATE)).toBeNull();
    expect(classifyMemoryPath(`${STATE}/memory/user`, STATE)).toBeNull();
  });

  it("tolerates Windows separators on either side", () => {
    const winState = "C:\\penguin\\proj\\agents\\a1\\agent_state";
    expect(
      classifyMemoryPath(
        "C:\\penguin\\proj\\agents\\a1\\agent_state\\memory\\user\\prefs.md",
        winState,
      ),
    ).toEqual({
      scope: "user",
      file: "prefs.md",
    });
    expect(classifyMemoryPath(`${STATE}\\memory\\user\\prefs.md`, STATE)).toEqual({
      scope: "user",
      file: "prefs.md",
    });
  });
});

describe("mergeMemoryChanges", () => {
  const write = (file: string): MemoryChangeEntry => ({ scope: "user", file, op: "write" });
  const edit = (file: string): MemoryChangeEntry => ({ scope: "user", file, op: "edit" });

  it("keeps one row per file, preserving first-seen order", () => {
    expect(mergeMemoryChanges([edit("a.md"), write("b.md"), edit("a.md")])).toEqual([
      { scope: "user", file: "a.md", op: "edit" },
      { scope: "user", file: "b.md", op: "write" },
    ]);
  });

  it("write dominates regardless of order", () => {
    expect(mergeMemoryChanges([edit("a.md"), write("a.md")])).toEqual([
      { scope: "user", file: "a.md", op: "write" },
    ]);
    expect(mergeMemoryChanges([write("a.md"), edit("a.md")])).toEqual([
      { scope: "user", file: "a.md", op: "write" },
    ]);
  });

  it("does not merge the same file name across scopes", () => {
    const rows = mergeMemoryChanges([
      { scope: "user", file: "notes.md", op: "edit" },
      { scope: "workspace", scopeKey: "ws-1", file: "notes.md", op: "edit" },
      { scope: "workspace", scopeKey: "ws-2", file: "notes.md", op: "edit" },
    ]);
    expect(rows).toHaveLength(3);
  });
});
