/**
 * kernelFieldLabel unit tests: the kernel merge report's path → display-name mapping — fixed
 * paths through the dictionary, per-tool paths rendered with the tool name, and unknown
 * (future) paths falling back to the raw path in both locales.
 */
import { afterEach, describe, expect, it } from "vitest";
import { kernelFieldLabel } from "../src/features/agents/kernel-labels";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

afterEach(() => setActiveStrings(zh));

describe("kernelFieldLabel", () => {
  it("maps fixed paths through the active dictionary", () => {
    for (const [locale, dict] of [
      ["zh", zh],
      ["en", en],
    ] as const) {
      setActiveStrings(dict);
      for (const path of Object.keys(dict.agent.kernelFields)) {
        expect(kernelFieldLabel(path), `${locale} ${path}`).toBe(dict.agent.kernelFields[path]);
      }
    }
  });

  it("renders per-tool paths with the tool name", () => {
    for (const dict of [zh, en]) {
      setActiveStrings(dict);
      // The tool name is interpolated, not dropped, and the rest comes from the dictionary.
      expect(kernelFieldLabel("tools.builtin.read_file")).toBe(
        dict.agent.kernelFieldTool("read_file"),
      );
      expect(kernelFieldLabel("tools.builtin.read_file")).toContain("read_file");
    }
  });

  it("covers every fixed kernel merge leaf in both dictionaries (no raw-path fallbacks for known paths)", () => {
    // The dictionaries must agree on the covered paths — a path only one locale knows would
    // render raw in the other.
    expect(Object.keys(en.agent.kernelFields).sort()).toEqual(
      Object.keys(zh.agent.kernelFields).sort(),
    );
  });

  it("falls back to the raw path for unknown leaves (a future default the dictionary predates)", () => {
    expect(kernelFieldLabel("future.section.key")).toBe("future.section.key");
    // The bare prefix with no tool name is not a per-tool path either.
    expect(kernelFieldLabel("tools.builtin.")).toBe("tools.builtin.");
  });
});
