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
    expect(kernelFieldLabel("system_prompt")).toBe("系统提示词模板");
    expect(kernelFieldLabel("memory.prompt")).toBe("记忆提示词");
    setActiveStrings(en);
    expect(kernelFieldLabel("system_prompt")).toBe("system prompt template");
  });

  it("renders per-tool paths with the tool name", () => {
    expect(kernelFieldLabel("tools.builtin.read_file")).toBe("工具 read_file");
    setActiveStrings(en);
    expect(kernelFieldLabel("tools.builtin.my_tool")).toBe("tool my_tool");
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
