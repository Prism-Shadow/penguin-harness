/**
 * The document form: frontmatter to title and scope, `## ` headings to sections, blank
 * lines to paragraphs (a fence or a list staying one paragraph), the three required
 * sections in either language, a body that links to a file refused, paragraph and section
 * ids carried over a revision by text and heading — and the document rendered back.
 */
import { describe, expect, it } from "vitest";
import {
  ProposalDocumentError,
  linksToFile,
  parseProposalDocument,
  renderProposalDocument,
} from "../src/index.js";

const DOC = `---
title: "Ticket notices reach an employee in one batch"
scope:
  - file: packages/server/src/runtime/organization/reconcile.ts
    name: "notifyTicket|reconcileCalendar"
  - file: packages/server/src/runtime/organization/digest.ts
---

## Change

\`notifyTicket\` no longer messages the desk per change; it writes \`org_desk_notices\`.

\`reconcileCalendar\` takes the notices before a sweep and appends \`deskDigest\`.

## Purpose

Every ticket change woke the desk; a dozen runs a day for one employee.

## Test

\`reconcile.test.ts\` "a blocked ticket reaches its owner at the next sweep, once".
`;

describe("parseProposalDocument", () => {
  it("reads the frontmatter, the sections and the paragraphs", () => {
    const doc = parseProposalDocument(DOC);
    expect(doc.title).toBe("Ticket notices reach an employee in one batch");
    expect(doc.scope).toEqual([
      {
        file: "packages/server/src/runtime/organization/reconcile.ts",
        name: "notifyTicket|reconcileCalendar",
      },
      { file: "packages/server/src/runtime/organization/digest.ts" },
    ]);
    expect(doc.sections.map((s) => [s.id, s.heading, s.paragraphs.length])).toEqual([
      ["s1", "Change", 2],
      ["s2", "Purpose", 1],
      ["s3", "Test", 1],
    ]);
    expect(doc.sections[0]!.paragraphs.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(doc.sections[2]!.paragraphs[0]!.id).toBe("p4");
  });

  it("accepts the Chinese headings, and plural English ones", () => {
    const zh = `---\ntitle: 批量送达\n---\n\n## 改动\n\nx\n\n## 目的\n\ny\n\n## 测试\n\nz\n`;
    expect(parseProposalDocument(zh).sections.map((s) => s.heading)).toEqual([
      "改动",
      "目的",
      "测试",
    ]);
    const plural = `---\ntitle: t\n---\n\n## Changes\n\nx\n\n## Purpose\n\ny\n\n## Tests\n\nz\n`;
    expect(parseProposalDocument(plural).sections).toHaveLength(3);
  });

  it("keeps a fenced block and a list as one paragraph each", () => {
    const doc = parseProposalDocument(
      `---\ntitle: t\n---\n\n## Change\n\n\`\`\`ts\nconst a = 1;\n\nconst b = 2;\n\`\`\`\n\n- one\n- two\n\n- three\n\nafter\n\n## Purpose\n\ny\n\n## Test\n\nz\n`,
    );
    const texts = doc.sections[0]!.paragraphs.map((p) => p.text);
    expect(texts).toHaveLength(3);
    expect(texts[0]).toContain("const b = 2;");
    expect(texts[1]).toBe("- one\n- two\n\n- three");
    expect(texts[2]).toBe("after");
  });

  it("refuses a missing title, a missing required section, a bad scope and a file link", () => {
    const code = (text: string): string => {
      try {
        parseProposalDocument(text);
      } catch (err) {
        if (err instanceof ProposalDocumentError) return err.code;
        throw err;
      }
      return "ok";
    };
    expect(code(`## Change\n\nx\n\n## Purpose\n\ny\n\n## Test\n\nz\n`)).toBe("proposal_title");
    expect(code(`---\ntitle: t\n---\n\n## Change\n\nx\n\n## Purpose\n\ny\n`)).toBe(
      "proposal_sections",
    );
    expect(
      code(
        `---\ntitle: t\nscope:\n  - file: /etc/passwd\n---\n\n## Change\n\nx\n\n## Purpose\n\ny\n\n## Test\n\nz\n`,
      ),
    ).toBe("proposal_scope");
    expect(
      code(
        `---\ntitle: t\nscope:\n  - file: a.ts\n    name: "("\n---\n\n## Change\n\nx\n\n## Purpose\n\ny\n\n## Test\n\nz\n`,
      ),
    ).toBe("proposal_scope");
    expect(
      code(
        `---\ntitle: t\n---\n\n## Change\n\nsee [the file](packages/server/src/a.ts)\n\n## Purpose\n\ny\n\n## Test\n\nz\n`,
      ),
    ).toBe("proposal_body_links_files");
    expect(
      code(
        `---\ntitle: t\n---\n\n## Change\n\nsee [it](file:///tmp/a)\n\n## Purpose\n\ny\n\n## Test\n\nz\n`,
      ),
    ).toBe("proposal_body_links_files");
    // A URL, a proposal link and an anchor are not files.
    expect(
      code(
        `---\ntitle: t\n---\n\n## Change\n\n[PR](https://github.com/x/y/pull/1) and [#3](proposal:3) and [up](#change)\n\n## Purpose\n\ny\n\n## Test\n\nz\n`,
      ),
    ).toBe("ok");
  });

  it("carries paragraph ids over a revision by text, and section ids by heading", () => {
    const first = parseProposalDocument(DOC);
    const revised = DOC.replace(
      "Every ticket change woke the desk;",
      "Each ticket change woke the desk;",
    ).replace("## Test", "## Rollout\n\nBehind a flag.\n\n## Test");
    const second = parseProposalDocument(revised, { sections: first.sections });
    expect(second.sections.map((s) => [s.id, s.heading])).toEqual([
      ["s1", "Change"],
      ["s2", "Purpose"],
      ["s4", "Rollout"],
      ["s3", "Test"],
    ]);
    // Unchanged paragraphs keep p1, p2 and p4; the rewritten one and the new one take p5, p6.
    const ids = second.sections.flatMap((s) => s.paragraphs.map((p) => p.id));
    expect(ids).toEqual(["p1", "p2", "p5", "p6", "p4"]);
  });
});

describe("linksToFile", () => {
  it("names the first file target, or null", () => {
    expect(linksToFile("[a](src/x.ts)")).toBe("src/x.ts");
    expect(linksToFile("[a](README.md)")).toBe("README.md");
    expect(linksToFile("[a](https://x/y.ts) [b](#top) [c](proposal:2#x)")).toBeNull();
  });
});

describe("renderProposalDocument", () => {
  it("round-trips: what it renders parses back to the same sections", () => {
    const doc = parseProposalDocument(DOC);
    const text = renderProposalDocument(doc);
    expect(
      text.startsWith('---\ntitle: "Ticket notices reach an employee in one batch"\nscope:\n'),
    ).toBe(true);
    const again = parseProposalDocument(text);
    expect(again).toEqual(doc);
  });
});
