/**
 * The tails of two "Create with AI" surfaces — the Models page's add dialog and the Vault tab's
 * add dialog. The prompt goes to the Project's default agent rather than the target, so the
 * tails have to carry the ids they are fed.
 *
 * - The models and vault tails name the Project (and the vault tail the target agent), and every
 *   CLI call in them names `--root`: the harness strips `PENGUIN_HOME` from a command's
 *   environment, so a `penguin config` call without it configures another data root.
 */
import { describe, expect, it } from "vitest";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

describe.each([
  ["zh", zh],
  ["en", en],
] as const)("%s dictionary", (_locale, dict) => {
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
