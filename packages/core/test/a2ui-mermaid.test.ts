/**
 * The mermaid rules (a2ui/mermaid.ts): a supported header, no configuration or link syntax from
 * the model (frontmatter and directives are errors even under strict mode, because themeCSS is
 * not on Mermaid's secure list), a best-effort balance check that respects quotes, free-text
 * diagram types and multi-line class bodies, and the size warning.
 */
import { describe, expect, it } from "vitest";
import { checkMermaid } from "../src/a2ui/index.js";

const codes = (source: string) => checkMermaid(source).map((issue) => issue.code);

describe("checkMermaid", () => {
  it("accepts a plain flowchart, a frontmatter title, and quoted labels with brackets", () => {
    expect(
      checkMermaid("flowchart LR\n  A[User] --> B{Tool call?}\n  B -- yes --> C[Run]"),
    ).toEqual([]);
    expect(codes("---\ntitle: Flow\n---\nflowchart LR\n  A --> B")).toEqual([]);
    expect(codes('flowchart LR\n  A["Run (dry)"] --> B')).toEqual([]);
    expect(codes("flowchart LR\n  A>odd shape] --> B")).toEqual([]);
  });

  it("needs a supported header and rejects an empty body", () => {
    expect(codes("diagram X\n  A --> B")).toEqual(["mermaid_unknown_type"]);
    expect(codes("")).toEqual(["mermaid_empty"]);
    expect(codes("%% only a comment")).toEqual(["mermaid_empty"]);
  });

  it("rejects configuration from the model: init directives and frontmatter keys other than title", () => {
    const directive = checkMermaid('%%{init: {"theme": "dark"}}%%\nflowchart LR\n  A --> B');
    expect(directive.map((i) => [i.code, i.line])).toEqual([["mermaid_directive", 1]]);
    expect(codes("---\nconfig:\n  theme: dark\n---\nflowchart LR\n  A --> B")).toContain(
      "mermaid_directive",
    );
  });

  it("rejects links, clicks and scripts", () => {
    expect(codes('flowchart LR\n  A --> B\n  click A "https://x"')).toEqual(["mermaid_forbidden"]);
    expect(codes("sequenceDiagram\n  A->>B: see javascript:alert(1)")).toEqual([
      "mermaid_forbidden",
    ]);
  });

  it("flags an unbalanced line in a flowchart with the line number, but not free text in a sequence diagram", () => {
    const issues = checkMermaid("flowchart LR\n  A[Run (dry] --> B");
    expect(issues.map((i) => [i.code, i.line])).toEqual([["mermaid_unbalanced", 2]]);
    expect(codes('flowchart LR\n  A["unclosed] --> B')).toEqual(["mermaid_unbalanced"]);
    expect(codes("sequenceDiagram\n  A->>B: request (context + tools)")).toEqual([]);
    expect(codes('pie\n  title Pets\n  "Dogs" : 3')).toEqual([]);
  });

  it("counts class-diagram braces across lines", () => {
    expect(codes("classDiagram\n  class Foo {\n    +int id\n  }\n  Foo --> Bar")).toEqual([]);
    expect(codes("classDiagram\n  class Foo {\n    +int id")).toEqual(["mermaid_unbalanced"]);
  });

  it("warns past 30 statements", () => {
    const edges = Array.from({ length: 31 }, (_, i) => `  N${i} --> N${i + 1}`);
    const issues = checkMermaid(["flowchart LR", ...edges].join("\n"));
    expect(issues.map((i) => [i.level, i.code])).toEqual([["warning", "mermaid_too_big"]]);
  });
});
