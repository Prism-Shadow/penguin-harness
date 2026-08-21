/**
 * memory-changes.ts unit tests: classifying file-tool paths against the Memory root
 * (scopes, index/marker filtering, separator tolerance) and merging a Task's entries
 * into one row per file.
 */
import { describe, expect, it } from "vitest";
import {
  aggregateMemoryChanges,
  classifyMemoryPath,
  mergeMemoryChanges,
  sameMemoryChanges,
} from "../src/lib/omni/memory-changes";
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

const write = (file: string, atMs?: number): MemoryChangeEntry => ({
  scope: "user",
  file,
  op: "write",
  ...(atMs !== undefined ? { atMs } : {}),
});
const edit = (file: string, atMs?: number): MemoryChangeEntry => ({
  scope: "user",
  file,
  op: "edit",
  ...(atMs !== undefined ? { atMs } : {}),
});

describe("mergeMemoryChanges", () => {
  it("keeps one row per file, preserving first-seen order; atMs follows the latest call", () => {
    expect(mergeMemoryChanges([edit("a.md", 1), write("b.md", 2), edit("a.md", 3)])).toEqual([
      { scope: "user", file: "a.md", op: "edit", atMs: 3 },
      { scope: "user", file: "b.md", op: "write", atMs: 2 },
    ]);
  });

  it("write dominates the summary op regardless of order", () => {
    expect(mergeMemoryChanges([edit("a.md"), write("a.md")])[0]!.op).toBe("write");
    expect(mergeMemoryChanges([write("a.md"), edit("a.md")])[0]!.op).toBe("write");
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

describe("aggregateMemoryChanges", () => {
  it("merges one file across Tasks (write-dominant, latest atMs) and keeps first-appearance order", () => {
    const task1 = mergeMemoryChanges([edit("a.md", 1), write("b.md", 2)]);
    const task2 = mergeMemoryChanges([write("a.md", 5)]);
    expect(aggregateMemoryChanges([task1, task2])).toEqual([
      { scope: "user", file: "a.md", op: "write", atMs: 5 },
      { scope: "user", file: "b.md", op: "write", atMs: 2 },
    ]);
  });

  it("returns [] for no lists and leaves single-task rows unchanged", () => {
    expect(aggregateMemoryChanges([])).toEqual([]);
    const task = mergeMemoryChanges([edit("a.md", 1)]);
    expect(aggregateMemoryChanges([task])).toEqual(task);
  });
});

describe("sameMemoryChanges", () => {
  it("treats re-derived rows with identical content as the same — a streaming tick must not re-fire effects keyed on identity", () => {
    const a = mergeMemoryChanges([edit("a.md", 1), write("b.md", 2)]);
    const b = mergeMemoryChanges([edit("a.md", 1), write("b.md", 2)]);
    expect(a).not.toBe(b);
    expect(sameMemoryChanges(a, b)).toBe(true);
  });

  it("detects every content move: rows, ops, files, and times", () => {
    const base = mergeMemoryChanges([edit("a.md", 1)]);
    expect(sameMemoryChanges(base, mergeMemoryChanges([write("a.md", 1)]))).toBe(false);
    expect(sameMemoryChanges(base, mergeMemoryChanges([edit("b.md", 1)]))).toBe(false);
    expect(sameMemoryChanges(base, mergeMemoryChanges([edit("a.md", 2)]))).toBe(false);
    expect(sameMemoryChanges(base, [])).toBe(false);
  });
});
