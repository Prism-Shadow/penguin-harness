/**
 * The bridge-to-chat drafts of the Memory tab: edit names the memory and its file and ends with
 * a trailing "what to change" line; import names the scope directory and carries the required
 * content — both with the index-sync reminder, in whichever language is active.
 */
import { afterEach, describe, expect, it } from "vitest";
import { S, setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import {
  buildMemoryEditPrompt,
  buildMemoryImportPrompt,
} from "../src/features/agents/memory-chat-prompts";

afterEach(() => setActiveStrings(zh));

describe("buildMemoryEditPrompt", () => {
  it("names the memory and its absolute file path", () => {
    const prompt = buildMemoryEditPrompt(
      "prefers-pnpm",
      "/data/agents/dev/agent_state/memory/user/prefers-pnpm.md",
    );
    expect(prompt).toContain("prefers-pnpm");
    expect(prompt).toContain("/data/agents/dev/agent_state/memory/user/prefers-pnpm.md");
    expect(prompt).toContain("MEMORY.md");
    // The requirement line trails, so the user just keeps typing at the end of the draft.
    expect(prompt.endsWith(S.memory.editPromptTail.split("\n").at(-1)!)).toBe(true);
  });

  it("appends the modal's requirement after the trailing line, and trims it", () => {
    const prompt = buildMemoryEditPrompt("t", "/m/user/t.md", "  改成两条命令  ");
    expect(prompt.endsWith("改成两条命令")).toBe(true);
    // Empty and whitespace-only requirements leave the line trailing for the composer.
    expect(buildMemoryEditPrompt("t", "/m/user/t.md", "   ")).toBe(
      buildMemoryEditPrompt("t", "/m/user/t.md"),
    );
  });

  it("follows the active dictionary", () => {
    setActiveStrings(en);
    expect(buildMemoryEditPrompt("t", "/m/user/t.md")).toContain("Please update a memory");
    setActiveStrings(zh);
    expect(buildMemoryEditPrompt("t", "/m/user/t.md")).toContain("请帮我更新一条记忆");
  });
});

describe("buildMemoryImportPrompt", () => {
  it("names the scope directory, reminds about the index, and ends with the trimmed content", () => {
    const prompt = buildMemoryImportPrompt(
      "/data/agents/dev/agent_state/memory/user",
      "  喜欢用 pnpm，Node 版本固定 24  ",
    );
    expect(prompt).toContain("/data/agents/dev/agent_state/memory/user");
    expect(prompt).toContain("MEMORY.md");
    expect(prompt.endsWith("喜欢用 pnpm，Node 版本固定 24")).toBe(true);
  });

  it("follows the active dictionary", () => {
    setActiveStrings(en);
    expect(buildMemoryImportPrompt("/m/user", "c")).toContain(
      "Please turn the following into memories",
    );
    setActiveStrings(zh);
    expect(buildMemoryImportPrompt("/m/user", "c")).toContain("请把下面的内容整理为记忆");
  });
});
