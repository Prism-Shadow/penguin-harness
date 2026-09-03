/**
 * The prompt material of the three "Create with AI" surfaces — the Agents page's create dialog,
 * the Models page's add dialog and the Vault tab's add dialog: in both dictionaries each offers
 * examples that fill the draft and a fixed tail naming the skill the receiving agent must use;
 * the tail follows the draft when composed the way the dialogs compose it; and the parameterized
 * tails carry the ids they are fed, since the prompt goes to the Project's default agent rather
 * than the target. Both CLI tails also name `--root`: the harness strips `PENGUIN_HOME` from a
 * command's environment, so a `penguin config` call without it configures another data root.
 *
 * The vault's cards additionally have to agree with the warning printed above them, so the
 * key-names-only ask leads and no card hands the user a secret-shaped placeholder to fill.
 */
import { describe, expect, it } from "vitest";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { composeAiPrompt } from "../src/features/ai-create/ai-create-prompt";
import type { AiExample } from "../src/features/ai-create/ai-create-panel";

/** Every example fills the draft with something, and no two share a key (React keys, and the selected-state match). */
function expectUsableExamples(examples: AiExample[]): void {
  expect(examples.length).toBeGreaterThan(0);
  expect(new Set(examples.map((e) => e.key)).size).toBe(examples.length);
  for (const example of examples) {
    expect(example.label.trim()).not.toBe("");
    expect(example.prompt.trim()).not.toBe("");
  }
}

describe.each([
  ["zh", zh],
  ["en", en],
] as const)("%s dictionary", (_locale, dict) => {
  it("offers examples on every surface", () => {
    expectUsableExamples(dict.agent.aiExamples);
    expectUsableExamples(dict.models.aiAddExamples);
    expectUsableExamples(dict.vault.aiAddExamples);
  });

  it("leads the vault examples with the key-names-only ask, and never asks for a pasted secret", () => {
    // The dialog's intro recommends letting AI create the key names and filling the values in by
    // hand; the first card is the one a scanning eye reads as the default, so it must be that ask.
    const examples = dict.vault.aiAddExamples;
    expect(examples[0]?.key).toBe("audit");
    for (const example of examples) {
      // `<paste key>` / `<新 token>`: the placeholder shape that tells the user to put a secret
      // into the prompt, which is exactly what the intro above the cards warns against.
      expect(example.prompt).not.toMatch(/<[^>]+>/);
      // Two-line card, as on the sibling surfaces.
      expect(example.description?.trim()).toBeTruthy();
    }
  });

  it("ends the agent prompt with a tail that runs agent-initialization, and seeds the onboarding agent by id", () => {
    const tail = dict.agent.aiCreateTail;
    expect(tail).toContain("agent-initialization");
    expect(tail).toContain("AGENTS.md");
    const prompt = composeAiPrompt("Create a jotting agent", tail);
    expect(prompt.startsWith("Create a jotting agent\n\n")).toBe(true);
    expect(prompt.endsWith(tail)).toBe(true);
    const onboarding = dict.agent.aiExamples.find((e) => e.key === "report-writer");
    expect(onboarding?.prompt).toContain("report-writer");
  });

  it("names the Project and the data root in the models tail, since the CLI would default both", () => {
    const tail = dict.models.aiAddTail("alice-default_project");
    expect(tail).toContain("penguin-config");
    expect(tail).toContain("penguin config model add --provider");
    expect(tail).toContain("--project-id alice-default_project");
    expect(tail).toContain("penguin config model list");
    // Every penguin invocation in the tail is rooted; the CLI's own default is not the
    // server's root, because a command's environment carries no PENGUIN_HOME.
    for (const line of tail.split("\n").filter((l) => l.includes("penguin config"))) {
      expect(line).toContain("--root");
    }
    expect(composeAiPrompt("x", tail).endsWith(tail)).toBe(true);
  });

  it("names the target agent, the Project and the data root in the vault tail, and lists the keys at the end", () => {
    const tail = dict.vault.aiAddTail("report-writer", "alice-default_project");
    expect(tail).toContain("penguin config vault set");
    expect(tail).toContain("--agent-id report-writer --project-id alice-default_project");
    expect(tail).toContain("penguin config vault list");
    expect(tail).toContain(".vault.toml");
    for (const line of tail.split("\n").filter((l) => l.includes("penguin config"))) {
      expect(line).toContain("--root");
    }
    expect(composeAiPrompt("x", tail).endsWith(tail)).toBe(true);
  });
});
