/**
 * The prompt material of the three "Create with AI" surfaces — the Agents page's create dialog,
 * the Models page's add dialog and the Vault tab's add dialog. The prompt goes to the Project's
 * default agent rather than the target, so the tails have to carry the ids they are fed.
 *
 * - Both dictionaries offer the same example cards, and no two cards on a surface share a key
 *   (React keys, and the selected-state match).
 * - The vault's cards agree with the warning printed above them: the key-names-only ask leads,
 *   and no card hands the user a secret-shaped placeholder to fill.
 * - The agent tail runs agent-initialization, and the onboarding card names the agent it seeds.
 * - The models and vault tails name the Project (and the vault tail the target agent), and every
 *   CLI call in them names `--root`: the harness strips `PENGUIN_HOME` from a command's
 *   environment, so a `penguin config` call without it configures another data root.
 */
import { describe, expect, it } from "vitest";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

it("offers the same example cards in both dictionaries, no two on a surface sharing a key", () => {
  const surfaces = (dict: typeof zh): { key: string }[][] => [
    dict.agent.aiExamples,
    dict.models.aiAddExamples,
    dict.vault.aiAddExamples,
  ];
  const keys = (dict: typeof zh) => surfaces(dict).map((examples) => examples.map((e) => e.key));
  // A card added to one language only would pass every per-dictionary check below.
  expect(keys(en)).toEqual(keys(zh));
  for (const surface of keys(zh)) expect(new Set(surface).size).toBe(surface.length);
});

describe.each([
  ["zh", zh],
  ["en", en],
] as const)("%s dictionary", (_locale, dict) => {
  it("leads the vault examples with the key-names-only ask, and never asks for a pasted secret", () => {
    // The dialog's intro recommends letting AI create the key names and filling the values in by
    // hand; the first card is the one a scanning eye reads as the default, so it must be that ask.
    const examples = dict.vault.aiAddExamples;
    expect(examples[0]?.key).toBe("audit");
    for (const example of examples) {
      // `<paste key>` / `<新 token>`: the placeholder shape that tells the user to put a secret
      // into the prompt, which is exactly what the intro above the cards warns against.
      expect(example.prompt).not.toMatch(/<[^>]+>/);
    }
  });

  it("ends the agent prompt with a tail that runs agent-initialization, and seeds the onboarding agent by id", () => {
    const tail = dict.agent.aiCreateTail;
    expect(tail).toContain("agent-initialization");
    expect(tail).toContain("AGENTS.md");
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
  });
});
