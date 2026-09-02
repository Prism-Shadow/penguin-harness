/**
 * The prompt material of the three "Create with AI" surfaces — the Agents page's create dialog
 * (agent-ai-prompts.ts), the Models page's add dialog (models-ai-prompts.ts) and the Vault tab's
 * add dialog (vault-ai-prompts.ts): in both dictionaries each offers examples that fill the
 * draft and a fixed tail naming the skill the receiving agent must use; the tail follows the
 * draft when composed the way the dialogs compose it; and the parameterized tails carry the ids
 * they are fed, since the prompt goes to the Project's default agent rather than the target.
 */
import { afterEach, describe, expect, it } from "vitest";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { composeAiPrompt } from "../src/features/ai-create/ai-create-prompt";
import type { AiExample } from "../src/features/ai-create/ai-create-panel";
import { agentAiExamples, agentAiTail } from "../src/features/agents/agent-ai-prompts";
import { vaultAiExamples, vaultAiTail } from "../src/features/agents/vault-ai-prompts";
import { modelsAiExamples, modelsAiTail } from "../src/features/models/models-ai-prompts";

afterEach(() => setActiveStrings(zh));

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
  it("offers examples on every surface, read from the active dictionary", () => {
    setActiveStrings(dict);
    expectUsableExamples(agentAiExamples());
    expectUsableExamples(modelsAiExamples());
    expectUsableExamples(vaultAiExamples());
    expect(agentAiExamples()).toEqual(dict.agent.aiExamples);
    expect(modelsAiExamples()).toEqual(dict.models.aiAddExamples);
    expect(vaultAiExamples()).toEqual(dict.vault.aiAddExamples);
  });

  it("ends the agent prompt with a tail that runs agent-initialization, and seeds the onboarding agent by id", () => {
    setActiveStrings(dict);
    const tail = agentAiTail();
    expect(tail).toContain("agent-initialization");
    expect(tail).toContain("AGENTS.md");
    const prompt = composeAiPrompt("Create a jotting agent", tail);
    expect(prompt.startsWith("Create a jotting agent\n\n")).toBe(true);
    expect(prompt.endsWith(tail)).toBe(true);
    const onboarding = agentAiExamples().find((e) => e.key === "report-writer");
    expect(onboarding?.prompt).toContain("report-writer");
  });

  it("names the Project in the models tail, since the CLI would default it", () => {
    setActiveStrings(dict);
    const tail = modelsAiTail("alice-default_project");
    expect(tail).toContain("penguin-config");
    expect(tail).toContain("penguin config model add --provider");
    expect(tail).toContain("--project-id alice-default_project");
    expect(tail).toContain("penguin config model list");
    expect(composeAiPrompt("x", tail).endsWith(tail)).toBe(true);
  });

  it("names the target agent and Project in the vault tail, and lists the keys at the end", () => {
    setActiveStrings(dict);
    const tail = vaultAiTail("report-writer", "alice-default_project");
    expect(tail).toContain("penguin config vault set");
    expect(tail).toContain("--agent-id report-writer --project-id alice-default_project");
    expect(tail).toContain("penguin config vault list");
    expect(tail).toContain(".vault.toml");
    expect(composeAiPrompt("x", tail).endsWith(tail)).toBe(true);
  });
});
