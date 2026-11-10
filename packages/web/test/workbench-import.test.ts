/**
 * workbench-import unit tests (src/features/agents/workbench-import.ts): each kind of pasted
 * source — a web page, a repository or directory, a local path, an install command, a reference
 * or description — leads the prompt with that kind's sentence, in either language, with the
 * source trimmed; the whole prompt is that lead, then the tail naming the install target after one
 * blank line.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { ImportSourceKind } from "../src/features/agents/skill-import-source";
import {
  buildWorkbenchImportPrompt,
  workbenchImportLead,
  workbenchImportTail,
} from "../src/features/agents/workbench-import";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

describe("workbenchImportLead", () => {
  afterEach(() => setActiveStrings(zh));

  it("leads each kind of source with that kind's sentence, in either language", () => {
    const cases: Array<[string, ImportSourceKind]> = [
      ["https://example.com/apps/kanban", "webUrl"],
      ["https://github.com/acme/workbenches/tree/main/kanban", "repoUrl"],
      ["git@github.com:acme/kanban.git", "repoUrl"],
      ["~/workbenches/kanban", "localPath"],
      ["npx workbench-kit add kanban", "command"],
      ["acme/kanban", "reference"],
      ["一个三栏的看板", "reference"],
    ];
    for (const dict of [zh, en]) {
      setActiveStrings(dict);
      for (const [source, kind] of cases) {
        expect(workbenchImportLead(`  ${source}\n`), source).toBe(
          dict.workbenches.importPromptLead[kind](source),
        );
      }
    }
  });
});

describe("buildWorkbenchImportPrompt", () => {
  it("joins the lead and the tail for this Project and agent with one blank line", () => {
    const source = "https://example.com/apps/kanban";
    expect(buildWorkbenchImportPrompt(` ${source} `, "proj_1", "writer")).toBe(
      `${workbenchImportLead(source)}\n\n${workbenchImportTail("proj_1", "writer")}`,
    );
    // The tail is where the workbench goes: it names both ids.
    expect(workbenchImportTail("proj_1", "writer")).toContain("proj_1");
    expect(workbenchImportTail("proj_1", "writer")).toContain("writer");
  });
});
