/**
 * The built-in browser's load policy (builtin-browser/load.ts): when the pages' memory, the
 * computer's memory or the tab count is worth a warning, the hysteresis that keeps a warning from
 * flickering at its line, which tabs are named the heaviest, and where the system's own memory
 * can be read at all.
 */
import { describe, expect, it } from "vitest";
import type { BuiltinBrowserTabMetrics } from "../../src/api/types.js";
import {
  MANY_TABS,
  MEMORY_CLEAR_KB,
  MEMORY_WARN_KB,
  assessLoad,
  systemMemory,
} from "../../src/builtin-browser/load.js";

const MB = 1024;
const GB = 1024 * 1024;

const tabs = (...memoryKB: number[]): BuiltinBrowserTabMetrics[] =>
  memoryKB.map((kb, i) => ({ tabId: i + 1, memoryKB: kb, cpuPercent: 0 }));
const sum = (list: BuiltinBrowserTabMetrics[]) => list.reduce((n, t) => n + t.memoryKB, 0);

function assess(
  list: BuiltinBrowserTabMetrics[],
  previous: Parameters<typeof assessLoad>[1] = [],
  over: Partial<Parameters<typeof assessLoad>[0]> = {},
) {
  return assessLoad(
    { at: 1, tabs: list, totalKB: sum(list), tabCount: list.length, ...over },
    previous,
  );
}

describe("assessLoad", () => {
  it("is quiet under the lines, and says so with no heavy tabs", () => {
    const calm = assess(tabs(300 * MB, 200 * MB, 100 * MB));
    expect(calm.warnings).toEqual([]);
    expect(calm.heavyTabIds).toEqual([]);
    expect(calm.totalKB).toBe(600 * MB);
  });

  it("warns about memory past 1.5 GB, and names the heaviest tabs, largest first", () => {
    expect(MEMORY_WARN_KB).toBe(1.5 * GB);
    const heavy = assess(tabs(200 * MB, 900 * MB, 100 * MB, 400 * MB, 150 * MB));
    expect(heavy.warnings).toEqual(["memory"]);
    // At most three, and only those holding a tenth of the total (175 MB here).
    expect(heavy.heavyTabIds).toEqual([2, 4, 1]);
  });

  it("keeps the memory warning until the pages fall under 1.35 GB", () => {
    expect(MEMORY_CLEAR_KB).toBe(1.35 * GB);
    const hovering = tabs(700 * MB, 700 * MB);
    expect(assess(hovering, []).warnings).toEqual([]);
    expect(assess(hovering, ["memory"]).warnings).toEqual(["memory"]);
    expect(assess(tabs(600 * MB, 700 * MB), ["memory"]).warnings).toEqual([]);
  });

  it("warns when this computer has less than 10% free, and clears over 12%", () => {
    const list = tabs(300 * MB, 200 * MB);
    const at = (freeGB: number) => ({ system: { freeKB: freeGB * GB, totalKB: 16 * GB } });
    expect(assess(list, [], at(1.5)).warnings).toEqual(["low_system_memory"]);
    expect(assess(list, [], at(1.8)).warnings).toEqual([]);
    expect(assess(list, ["low_system_memory"], at(1.8)).warnings).toEqual(["low_system_memory"]);
    expect(assess(list, ["low_system_memory"], at(2)).warnings).toEqual([]);
    // It points at the tabs worth closing too.
    expect(assess(list, [], at(1)).heavyTabIds).toEqual([1, 2]);
    // With no page open there is nothing of the browser's to close.
    expect(assess([], [], at(1)).warnings).toEqual([]);
  });

  it("warns about more than 12 tabs, naming no tab for it", () => {
    expect(MANY_TABS).toBe(12);
    const thirteen = tabs(...Array.from({ length: 13 }, () => 50 * MB));
    expect(assess(thirteen).warnings).toEqual(["many_tabs"]);
    expect(assess(thirteen).heavyTabIds).toEqual([]);
    expect(assess(thirteen.slice(0, 12)).warnings).toEqual([]);
    // The registry's count decides: a tab the measurement has not reached yet still counts.
    expect(assess(thirteen.slice(0, 12), [], { tabCount: 13 }).warnings).toEqual(["many_tabs"]);
  });

  it("names no single tab the heaviest when only one is open", () => {
    const one = assess(tabs(2 * GB));
    expect(one.warnings).toEqual(["memory"]);
    expect(one.heavyTabIds).toEqual([]);
  });
});

describe("systemMemory", () => {
  it("reads what Linux and Windows report as available", () => {
    expect(systemMemory("linux", 2 * 1024 ** 3, 16 * 1024 ** 3)).toEqual({
      freeKB: 2 * GB,
      totalKB: 16 * GB,
    });
    expect(systemMemory("win32", 1024 ** 3, 8 * 1024 ** 3)).toEqual({
      freeKB: GB,
      totalKB: 8 * GB,
    });
  });

  it("leaves macOS out, whose free count reads a healthy Mac as full", () => {
    expect(systemMemory("darwin", 200 * 1024 ** 2, 16 * 1024 ** 3)).toBeUndefined();
  });

  it("leaves out numbers that mean nothing", () => {
    expect(systemMemory("linux", 1, 0)).toBeUndefined();
    expect(systemMemory("linux", Number.NaN, 16)).toBeUndefined();
  });
});
