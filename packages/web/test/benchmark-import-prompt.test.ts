/**
 * The prompt behind the Evaluation Center's import dialog
 * (src/features/benchmark/benchmark-import-prompt.ts). Assertions on the tail are
 * language-agnostic: the link, paths, fields and commands it must name, never the sentences
 * around them, which differ per dictionary.
 *
 * - A folder link in a repository opens a draft, to the Project's default Agent, whose prompt
 *   names the link and asks for the package at a pinned 40-hex commit, written under the
 *   Project's benchmarks/ with a git origin and an empty scoreboard, stopping before an overwrite
 *   — in either language.
 * - The draft goes to the first Agent when the Project has no default_agent; with no Agent, or no
 *   source, there is nothing to open.
 * - A local path and a description get leads of their own, and the same tail.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import { buildAiDraft } from "../src/features/ai-create/ai-bridge";
import {
  benchmarkImportChat,
  buildBenchmarkImportPrompt,
  classifyBenchmarkSource,
} from "../src/features/benchmark/benchmark-import-prompt";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const FOLDER =
  "https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/packages/penguinharness-benchmark-sec-a";

const agent = (agentId: string) => ({ agentId, name: agentId }) as AgentSummary;
const AGENTS = [agent("report_writer"), agent("default_agent")];

/** What the Agent has to be told, whichever language the tail is in. */
const CONTRACT = [
  "proj_1",
  "benchmark.json",
  "YYYY.MM.DD.N",
  "statement/README.md",
  "rubric/README.md",
  "git ls-remote",
  "40",
  "`published`",
  "`<app_data_dir>/benchmarks/<id>/`",
  "scoreboard.yaml",
  ".jobs/",
  '"kind": "git"',
  '"ref"',
  '"imported_at"',
  "evaluations: []",
  "`benchmark-design`",
  "reference/package.md",
];

describe("importing a Benchmark through an Agent", () => {
  afterEach(() => setActiveStrings(zh));

  it("drafts to the default Agent a prompt that names the folder and pins it to a commit, in either language", () => {
    for (const dict of [zh, en]) {
      setActiveStrings(dict);
      const request = benchmarkImportChat(`  ${FOLDER}\n`, "proj_1", AGENTS);

      expect(request?.agentId).toBe("default_agent");
      const draft = buildAiDraft({}, request!);
      expect(draft).toMatchObject({ agentId: "default_agent", aiPrefill: true });
      expect(draft.text!.startsWith(dict.benchmark.importPromptLead.repoFolderUrl(FOLDER))).toBe(
        true,
      );
      for (const token of CONTRACT) expect(draft.text, token).toContain(token);
    }
  });

  it("drafts to the first Agent when the Project has no default_agent, and opens nothing without an Agent or a source", () => {
    expect(benchmarkImportChat(FOLDER, "proj_1", [agent("report_writer")])?.agentId).toBe(
      "report_writer",
    );
    expect(benchmarkImportChat(FOLDER, "proj_1", [])).toBeNull();
    expect(benchmarkImportChat("   ", "proj_1", AGENTS)).toBeNull();
  });

  it.each([
    [FOLDER, "repoFolderUrl"],
    ["git@github.com:Prism-Shadow/penguin-harness-benchmark.git", "repoFolderUrl"],
    ["/home/me/benchmarks/report-writing-v1", "localPath"],
    ["C:\\benchmarks\\report-writing-v1", "localPath"],
    ["https://example.com/a-benchmark-page", "reference"],
    ["the Terminal-Bench subset from the benchmark repository", "reference"],
  ] as const)("leads %s as a %s, before the same tail", (source, kind) => {
    expect(classifyBenchmarkSource(source)).toBe(kind);
    const prompt = buildBenchmarkImportPrompt(source, "proj_1");
    expect(prompt.startsWith(zh.benchmark.importPromptLead[kind](source))).toBe(true);
    expect(prompt.endsWith(zh.benchmark.importPromptTail("proj_1"))).toBe(true);
  });
});
