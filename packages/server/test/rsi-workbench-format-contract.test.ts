/**
 * The scoreboard contract between the two pinned packages: the evaluation entry the pinned Default
 * RSI Toolkit tells an Agent to append to `scoreboard.yaml` (its `agent-optimization` Skill,
 * "Record and report") is one the pinned `@penguinharness/rsi-workbench/format` reads back, field
 * for field — so a toolkit release and a workbench release cannot drift apart on a field name
 * without this failing at the pin.
 *
 * The Skill writes the entry as a template, each value a `<placeholder>`; the test fills each with
 * a value of the kind its field holds and parses the result as a scoreboard.
 */
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseScoreboard } from "@penguinharness/rsi-workbench/format";

/** A value of the kind each field of the template holds. */
const FILLED: Record<string, string> = {
  time: "2026-11-26T08:00:00Z",
  agent_id: "test_agent",
  version: "3",
  provider: "deepseek",
  model_id: "deepseek-flash",
  thinking_level: "medium",
  summary_title: "Round 1 accepted",
  summary: "The candidate raised the score.",
  score: "0.75",
  cost: "0.012",
  duration_ms: "4200",
  case: "CASE-001",
  session_id: "session-2026-11-26-08-00-00-abcdef01",
};

/** The first fenced YAML block under the Skill's "Record and report" heading. */
async function templateEntry(): Promise<string> {
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve("@penguinharness/default-rsi-toolkit/package.json"));
  const skill = await fs.readFile(
    path.join(root, "skills", "agent-optimization", "SKILL.md"),
    "utf8",
  );
  const section = skill.slice(skill.indexOf("## Record and report"));
  const block = /```yaml\n([\s\S]*?)\n```/.exec(section);
  if (block === null) throw new Error("the Skill's Record and report section has no YAML block");
  return block[1]!;
}

describe("the Default RSI Toolkit's scoreboard entry", () => {
  it("is read back whole by the workbench's format", async () => {
    const template = await templateEntry();
    let folded = "";
    const lines = template.split("\n").map((line) => {
      // `key: <…>` on one line, or a folded `key: >-` whose next line is the placeholder.
      const inline = /^(\s*(?:- )?)([a-z_]+):\s*<[^>]*>\s*$/.exec(line);
      if (inline !== null) return `${inline[1]}${inline[2]}: ${FILLED[inline[2]!] ?? "x"}`;
      const opens = /^\s*(?:- )?([a-z_]+):\s*>-\s*$/.exec(line);
      if (opens !== null) folded = opens[1]!;
      const placeholder = /^(\s*)<[^>]*>\s*$/.exec(line);
      if (placeholder !== null) return `${placeholder[1]}${FILLED[folded] ?? "x"}`;
      return line;
    });
    expect(lines.join("\n")).not.toMatch(/<[^>]*>/);
    const scoreboard = `evaluations:\n${lines.map((line) => `  ${line}`).join("\n")}\n`;

    const [evaluation, ...rest] = parseScoreboard(scoreboard);

    expect(rest).toEqual([]);
    expect(evaluation).toMatchObject({
      agentId: "test_agent",
      summaryTitle: "Round 1 accepted",
      provider: "deepseek",
      modelId: "deepseek-flash",
      score: 0.75,
      durationMs: 4200,
      cases: [expect.objectContaining({ case: "CASE-001" })],
    });
  });
});
