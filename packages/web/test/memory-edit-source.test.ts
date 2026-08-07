/**
 * The edit-via-chat draft for one memory: names the memory and its file, ends with the
 * index-sync reminder and a trailing "what to change" line for the user to complete — in
 * whichever language is active.
 */
import { afterEach, describe, expect, it } from "vitest";
import { S, setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { buildMemoryEditPrompt } from "../src/features/agents/memory-edit-source";

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
