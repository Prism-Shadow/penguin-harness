/**
 * skill-import-source unit tests: the classifier's buckets for each supported source
 * form (webpage URL, forge repo/directory, git remote, local path, foreign-ecosystem
 * install command, bare reference), and the prompt builder always embedding the source
 * plus the shared security / skill-porting tail (S defaults to zh in tests).
 */
import { describe, expect, it } from "vitest";
import {
  buildImportPrompt,
  classifyImportSource,
  type ImportSourceKind,
} from "../src/features/agents/skill-import-source";
import { S } from "../src/lib/strings";

describe("classifyImportSource", () => {
  it("classifies each supported source form", () => {
    const cases: Array<[string, ImportSourceKind]> = [
      ["https://example.com/docs/pdf-skill", "webUrl"],
      ["http://example.com/skill.html", "webUrl"],
      ["https://github.com/org/repo", "repoUrl"],
      ["https://github.com/org/repo/tree/main/skills/pdf", "repoUrl"],
      ["https://gitlab.com/org/repo", "repoUrl"],
      ["git@github.com:org/repo.git", "repoUrl"],
      ["https://example.com/mirror/repo.git", "repoUrl"],
      ["/home/me/skills/pdf", "localPath"],
      ["~/skills/pdf", "localPath"],
      ["./skills/pdf", "localPath"],
      ["C:\\skills\\pdf", "localPath"],
      ["npx skills add pdf", "command"],
      ["claude plugin install foo@marketplace", "command"],
      ["pdf-tools", "reference"],
      ["my-marketplace/pdf-tools", "reference"],
    ];
    for (const [input, kind] of cases) {
      expect(classifyImportSource(input), input).toBe(kind);
    }
    // Surrounding whitespace is trimmed before classification.
    expect(classifyImportSource("  npx skills add pdf  ")).toBe("command");
  });
});

describe("buildImportPrompt", () => {
  it("embeds the source and always appends the shared security / skill-porting tail", () => {
    const inputs = [
      "https://example.com/pdf-skill",
      "https://github.com/org/repo",
      "/tmp/skills/pdf",
      "npx skills add pdf",
      "pdf-tools",
    ];
    for (const input of inputs) {
      const prompt = buildImportPrompt(input);
      expect(prompt, input).toContain(input);
      // Tail on its own line: read fully / review for malicious instructions / soft skill-porting pointer.
      expect(prompt, input).toContain(`\n${S.skills.importPromptTail}`);
      expect(prompt, input).toContain("skill-porting");
    }
  });

  it("the command variant warns against blind execution", () => {
    expect(buildImportPrompt("npx skills add pdf")).toContain("不要直接执行");
  });
});
