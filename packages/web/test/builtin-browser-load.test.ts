/**
 * The built-in browser's load as the window words it (features/builtin-browser/load.ts): sizes,
 * the toolbar mark's warning for each of the server's verdicts, the heavy tabs' memory, and which
 * warnings are new (one toast each).
 */
import { describe, expect, it } from "vitest";
import type { BuiltinBrowserMetrics } from "@prismshadow/penguin-server/api";
import {
  formatMemory,
  heavyTabMemory,
  loadWarningText,
  newWarnings,
} from "../src/features/builtin-browser/load";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const EN = en.builtinBrowser.load;

const GB = 1024 * 1024;

function metrics(over: Partial<BuiltinBrowserMetrics> = {}): BuiltinBrowserMetrics {
  return {
    at: 1,
    tabs: [
      { tabId: 3, memoryKB: 1.2 * GB, cpuPercent: 4 },
      { tabId: 5, memoryKB: 0.6 * GB, cpuPercent: 0.5 },
      { tabId: 9, memoryKB: 0.3 * GB, cpuPercent: 0 },
    ],
    totalKB: 2.1 * GB,
    warnings: [],
    heavyTabIds: [],
    ...over,
  };
}

describe("formatMemory", () => {
  it("reads megabytes under about a gigabyte, gigabytes with one decimal above", () => {
    expect(formatMemory(640 * 1024)).toBe("640 MB");
    expect(formatMemory(12)).toBe("1 MB");
    expect(formatMemory(0.97 * GB)).toBe("1.0 GB");
    expect(formatMemory(2.1 * GB)).toBe("2.1 GB");
  });
});

describe("loadWarningText", () => {
  it("says nothing without a measurement or a warning", () => {
    expect(loadWarningText(null, 3, EN)).toBeNull();
    expect(loadWarningText(metrics(), 3, EN)).toBeNull();
  });

  it("names the browser's memory and the tabs, then what to do", () => {
    expect(loadWarningText(metrics({ warnings: ["memory"] }), 7, EN)).toBe(
      "The browser is using 2.1 GB across 7 tabs. Close tabs you no longer need.",
    );
  });

  it("puts the computer's own shortage first, with what the browser holds of it", () => {
    const low = metrics({
      totalKB: 0.6 * GB,
      warnings: ["low_system_memory"],
      system: { freeKB: 0.8 * GB, totalKB: 16 * GB },
    });
    expect(loadWarningText(low, 1, EN)).toBe(
      "This computer is low on memory (5% free). The browser is using 614 MB across 1 tab. Close tabs you no longer need.",
    );
  });

  it("counts the tabs when there are too many, once when the memory sentence already does", () => {
    expect(loadWarningText(metrics({ warnings: ["many_tabs"] }), 14, EN)).toBe(
      "14 tabs are open. Close tabs you no longer need.",
    );
    expect(loadWarningText(metrics({ warnings: ["memory", "many_tabs"] }), 14, EN)).toBe(
      "The browser is using 2.1 GB across 14 tabs. Close tabs you no longer need.",
    );
  });

  it("joins Chinese sentences without spaces", () => {
    expect(loadWarningText(metrics({ warnings: ["memory"] }), 7, zh.builtinBrowser.load)).toBe(
      "浏览器正在使用 2.1 GB 内存（7 个标签页）。请关闭不再需要的标签页。",
    );
  });
});

describe("heavyTabMemory", () => {
  it("gives the memory of the tabs the warning points at, and nothing for the others", () => {
    const warned = metrics({ warnings: ["memory"], heavyTabIds: [3, 5] });
    expect(heavyTabMemory(warned, 3)).toBe(1.2 * GB);
    expect(heavyTabMemory(warned, 5)).toBe(0.6 * GB);
    expect(heavyTabMemory(warned, 9)).toBeNull();
    expect(heavyTabMemory(null, 3)).toBeNull();
  });
});

describe("newWarnings", () => {
  it("is each warning as it appears, once, and again after it cleared", () => {
    expect(newWarnings([], ["memory"])).toEqual(["memory"]);
    expect(newWarnings(["memory"], ["memory"])).toEqual([]);
    expect(newWarnings(["memory"], ["memory", "many_tabs"])).toEqual(["many_tabs"]);
    expect(newWarnings(["memory", "many_tabs"], [])).toEqual([]);
    expect(newWarnings([], ["memory"])).toEqual(["memory"]);
  });
});
