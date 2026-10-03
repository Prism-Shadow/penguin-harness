/**
 * The a2ui plugin as shipped: in the library with its support files; every example in SKILL.md
 * and references/components.md passes the checker it teaches (the documentation is the first
 * test case of the grammar); the numbers the skill quotes are the exported weights; and the
 * committed checker bundle was built from the current a2ui sources.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { A2UI_SCORING, checkMermaid, checkReply, parseA2ui } from "../src/a2ui/index.js";
import { scanFences } from "../src/a2ui/fences.js";
import { libraryPlugin } from "../src/plugins/index.js";
import {
  BUNDLE_PATH,
  HASH_MARKER,
  hashA2uiSources,
  readBundleHash,
} from "../../../scripts/build-a2ui-check.mjs";

const skillDir = path.resolve(import.meta.dirname, "../../../plugins/a2ui/skills/a2ui");
const read = (file: string) => fs.readFile(path.join(skillDir, file), "utf8");

describe("the a2ui plugin", () => {
  it("is in the library, preinstalled, under office productivity, with the skill, its reference and its checker", () => {
    const plugin = libraryPlugin("a2ui");
    expect(plugin).toMatchObject({
      name: "a2ui",
      category: "office-productivity",
      preinstall: true,
    });
    expect(plugin!.skills.map((s) => s.name)).toEqual(["a2ui"]);
    expect(Object.keys(plugin!.skills[0]!.files ?? {}).sort()).toEqual([
      "references/components.md",
      "scripts/check.mjs",
    ]);
  });

  for (const doc of ["SKILL.md", "references/components.md"]) {
    it(`${doc}: every top-level a2ui and mermaid fence passes without a single issue`, async () => {
      const spans = scanFences(await read(doc)).filter(
        (span) => span.lang === "a2ui" || span.lang === "mermaid",
      );
      if (doc.endsWith("components.md")) expect(spans.length).toBeGreaterThanOrEqual(6);
      for (const span of spans) {
        const source = span.body.join("\n");
        const issues = span.lang === "a2ui" ? parseA2ui(source).issues : checkMermaid(source);
        expect(issues, `${doc} line ${span.startLine}`).toEqual([]);
      }
    });

    it(`${doc}: every \`\`\`\`markdown example reply passes checkReply with a full score`, async () => {
      const examples = scanFences(await read(doc)).filter(
        (span) => span.lang === "markdown" && span.closed,
      );
      if (doc === "SKILL.md") expect(examples.length).toBeGreaterThanOrEqual(3);
      for (const span of examples) {
        const report = checkReply(span.body.join("\n"));
        expect(report.issues, `${doc} line ${span.startLine}`).toEqual([]);
        expect(report.score.total, `${doc} line ${span.startLine}`).toBe(100);
      }
    });
  }

  it("quotes the exported weights and the gate", async () => {
    const skill = await read("SKILL.md");
    expect(skill).toContain(`L2 loses ${A2UI_SCORING.l2PerWarning} per block warning`);
    expect(skill).toContain(`prose loses ${A2UI_SCORING.prosePerWarning} per prose warning`);
    expect(skill).toContain(`a total of ${A2UI_SCORING.passTotal} or more`);
    const reference = await read("references/components.md");
    expect(reference).toContain(`L2 = 100 − ${A2UI_SCORING.l2PerWarning} ×`);
    expect(reference).toContain(`prose = 100 − ${A2UI_SCORING.prosePerWarning} ×`);
    expect(reference).toContain(`total ≥ ${A2UI_SCORING.passTotal}`);
  });
});

describe("the bundled checker (scripts/check.mjs)", () => {
  it("was built from the current a2ui sources — run `pnpm build:a2ui-check` and commit when this fails", () => {
    expect(readBundleHash(BUNDLE_PATH), `no "${HASH_MARKER}" header in ${BUNDLE_PATH}`).toBe(
      hashA2uiSources(),
    );
  });

  it("starts with a shebang and the hash header", async () => {
    const head = (await fs.readFile(BUNDLE_PATH, "utf8")).split("\n", 2);
    expect(head[0]).toBe("#!/usr/bin/env node");
    expect(head[1]!.startsWith(HASH_MARKER)).toBe(true);
  });
});
