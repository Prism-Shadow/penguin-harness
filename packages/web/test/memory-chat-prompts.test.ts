/**
 * The bridge-to-chat drafts of the Memory tab, deliberately minimal (the save mechanics live in
 * the agent's Memory prompt): edit names the memory and ends with a trailing "what to change"
 * line; add names the scope by kind and carries the required content — in whichever language is
 * active.
 */
import { afterEach, describe, expect, it } from "vitest";
import { S, setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import {
  buildMemoryAddPrompt,
  buildMemoryEditPrompt,
} from "../src/features/agents/memory-chat-prompts";

afterEach(() => setActiveStrings(zh));

describe("buildMemoryEditPrompt", () => {
  it("names the memory and leaves the requirement line trailing", () => {
    const prompt = buildMemoryEditPrompt("prefers-pnpm");
    expect(prompt).toContain("prefers-pnpm");
    // Minimal on purpose: no file path, no index-upkeep instructions — the Memory prompt has them.
    expect(prompt).not.toContain("/");
    expect(prompt).not.toContain("MEMORY.md");
    // The requirement line trails, so the user just keeps typing at the end of the draft.
    expect(prompt.endsWith(S.memory.editPromptTail)).toBe(true);
  });

  it("appends the modal's requirement after the trailing line, and trims it", () => {
    const prompt = buildMemoryEditPrompt("t", "  改成两条命令  ");
    expect(prompt.endsWith("改成两条命令")).toBe(true);
    // Empty and whitespace-only requirements leave the line trailing for the composer.
    expect(buildMemoryEditPrompt("t", "   ")).toBe(buildMemoryEditPrompt("t"));
  });

  it("follows the active dictionary", () => {
    for (const dict of [en, zh]) {
      setActiveStrings(dict);
      expect(buildMemoryEditPrompt("t")).toBe(
        `${dict.memory.editPromptLead("t")}\n${dict.memory.editPromptTail}`,
      );
    }
  });
});

describe("buildMemoryAddPrompt", () => {
  it("names the scope by kind and ends with the trimmed content", () => {
    const user = buildMemoryAddPrompt("user", "  喜欢用 pnpm，Node 版本固定 24  ");
    expect(user).toContain(S.memory.addPromptLead.user);
    expect(user.endsWith("喜欢用 pnpm，Node 版本固定 24")).toBe(true);
    // The two scopes read differently, so a wrong lead cannot pass as the right one.
    expect(S.memory.addPromptLead.workspace).not.toBe(S.memory.addPromptLead.user);
    expect(buildMemoryAddPrompt("workspace", "c")).toContain(S.memory.addPromptLead.workspace);
  });

  it("follows the active dictionary", () => {
    for (const dict of [en, zh]) {
      setActiveStrings(dict);
      for (const kind of ["user", "workspace"] as const) {
        expect(buildMemoryAddPrompt(kind, "c")).toBe(`${dict.memory.addPromptLead[kind]}\nc`);
      }
    }
  });
});
