/**
 * Context composition rows: the estimate-to-measured rescaling behind the context ring's panel,
 * and the palette it is zipped with.
 */
import { describe, expect, it } from "vitest";
import type { SessionContextResponse } from "@prismshadow/penguin-server/api";
import {
  CONTEXT_PART_KEYS,
  contextComposition,
  splitFilePath,
} from "../src/features/chat/context-parts";
import { CONTEXT_PART_COLORS } from "../src/lib/category-colors";

function response(over: Partial<SessionContextResponse> = {}): SessionContextResponse {
  const base = {
    systemPrompt: 1000,
    toolDefs: 4000,
    userMessages: 1000,
    assistantMessages: 2000,
    toolRequests: 2000,
    toolResults: 10000,
    topTools: [
      { name: "read_file", tokens: 6000 },
      { name: "exec_command", tokens: 4000 },
    ],
    topFiles: [],
    contextClosed: false,
    compactionThreshold: null,
    ...over,
  };
  return {
    ...base,
    total:
      over.total ??
      base.systemPrompt +
        base.toolDefs +
        base.userMessages +
        base.assistantMessages +
        base.toolRequests +
        base.toolResults,
  };
}

describe("contextComposition", () => {
  it("rescales the estimate so the parts add up to the measured occupancy", () => {
    // Estimate totals 20000; the provider measured 50000. Each part keeps its share.
    const c = contextComposition(response(), 50_000)!;
    expect(c.parts.map((p) => p.tokens)).toEqual([2500, 10_000, 2500, 5000, 5000, 25_000]);
    expect(c.parts.map((p) => p.percent)).toEqual([5, 20, 5, 10, 10, 50]);
    expect(c.parts.reduce((n, p) => n + p.tokens, 0)).toBe(50_000);
    expect(c.parts.reduce((n, p) => n + p.percent, 0)).toBe(100);
  });

  it("apportions both columns so neither drifts off the total it describes", () => {
    // Independently rounded, these six shares read 50/40/1/9/1/1 — 102% of a context whose
    // parts would also miss the header figure.
    const c = contextComposition(
      response({
        systemPrompt: 3279,
        toolDefs: 2616,
        userMessages: 65,
        assistantMessages: 562,
        toolRequests: 38,
        toolResults: 51,
        topTools: [],
      }),
      350,
    )!;
    expect(c.parts.reduce((n, p) => n + p.percent, 0)).toBe(100);
    expect(c.parts.reduce((n, p) => n + p.tokens, 0)).toBe(350);
  });

  it("gives the parts the palette in its documented order", () => {
    const c = contextComposition(response(), 1000)!;
    expect(c.parts.map((p) => p.key)).toEqual([...CONTEXT_PART_KEYS]);
    expect(c.parts.map((p) => p.color)).toEqual([...CONTEXT_PART_COLORS]);
    // Zipped by index: a part added on one side and not the other would silently lose its colour.
    expect(CONTEXT_PART_COLORS).toHaveLength(CONTEXT_PART_KEYS.length);
    expect(new Set(CONTEXT_PART_COLORS).size).toBe(CONTEXT_PART_COLORS.length);
  });

  it("scales the tool ranking on the same basis, as shares of the whole context", () => {
    const c = contextComposition(response(), 50_000)!;
    expect(c.tools).toEqual([
      { name: "read_file", tokens: 15_000, percent: 30 },
      { name: "exec_command", tokens: 10_000, percent: 20 },
    ]);
    // A ranking inside two of the six parts: it never claims the whole context.
    expect(c.tools.reduce((n, t) => n + t.percent, 0)).toBeLessThan(100);
  });

  it("scales the file ranking the same way and splits each path for display", () => {
    const c = contextComposition(
      response({
        topFiles: [
          { path: "src/state/config.ts", tokens: 5000, ops: { read: 2, edit: 1, write: 0 } },
          { path: "~/notes.md", tokens: 1000, ops: { read: 1, edit: 0, write: 0 } },
        ],
      }),
      50_000,
    )!;
    expect(c.files).toEqual([
      {
        path: "src/state/config.ts",
        name: "config.ts",
        dir: "src/state",
        ops: { read: 2, edit: 1, write: 0 },
        tokens: 12_500,
        percent: 25,
      },
      {
        path: "~/notes.md",
        name: "notes.md",
        dir: "~",
        ops: { read: 1, edit: 0, write: 0 },
        tokens: 2500,
        percent: 5,
      },
    ]);
  });

  it("has nothing to break down for an empty estimate or a closed context", () => {
    const empty = response({
      systemPrompt: 0,
      toolDefs: 0,
      userMessages: 0,
      assistantMessages: 0,
      toolRequests: 0,
      toolResults: 0,
      topTools: [],
    });
    expect(empty.total).toBe(0);
    expect(contextComposition(empty, 0)).toBeNull();
    // A completed compaction closed the context these figures describe; the next one is unmeasured.
    expect(contextComposition(response({ contextClosed: true }), 50_000)).toBeNull();
  });
});

describe("splitFilePath", () => {
  it("splits on either separator, keeping a root's own separator as the directory", () => {
    expect(splitFilePath("src/state/config.ts")).toEqual({ name: "config.ts", dir: "src/state" });
    expect(splitFilePath("C:\\ws\\src\\a.ts")).toEqual({ name: "a.ts", dir: "C:\\ws\\src" });
    expect(splitFilePath("/etc/hosts")).toEqual({ name: "hosts", dir: "/etc" });
    expect(splitFilePath("/hosts")).toEqual({ name: "hosts", dir: "/" });
    expect(splitFilePath("README.md")).toEqual({ name: "README.md", dir: "" });
  });
});
