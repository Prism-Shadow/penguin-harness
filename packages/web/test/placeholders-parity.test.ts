/**
 * The Agent Prompt tab's "available placeholders" list must stay in lockstep with the
 * default system prompt it mirrors — same tokens, same order (the dictionary carries that
 * invariant as a comment). This drift went unnoticed once ({{SHELL}} was added to the
 * prompt but not the list), so pin it: derive the tokens from core's real default prompt
 * and compare to both dictionaries.
 */
import { describe, expect, it } from "vitest";
import { defaultSystemConfig } from "@prismshadow/penguin-core";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const dictionaries = { zh, en };

/** Tokens `{{FOO}}` in first-appearance order, de-duplicated (a token may recur in the prompt body). */
function promptTokensInOrder(prompt: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of prompt.matchAll(/\{\{[A-Z_]+\}\}/g)) {
    if (!seen.has(m[0])) {
      seen.add(m[0]);
      out.push(m[0]);
    }
  }
  return out;
}

describe("agent placeholder list ⇔ default system prompt", () => {
  const promptTokens = promptTokensInOrder(defaultSystemConfig().system_prompt);

  it("the prompt actually uses placeholders (guards against a broken extraction)", () => {
    expect(promptTokens.length).toBeGreaterThan(0);
    expect(promptTokens).toContain("{{SHELL}}");
  });

  for (const [locale, dict] of Object.entries(dictionaries)) {
    it(`${locale} lists every prompt placeholder once, in prompt order`, () => {
      const listed = dict.agent.placeholders.map(([token]) => token);
      // No duplicate rows (a copy-paste slip would show the same token twice).
      expect(new Set(listed).size).toBe(listed.length);
      // Same set and same order as the prompt.
      expect(listed).toEqual(promptTokens);
    });
  }
});
