/**
 * ChangesCard and PathLabel (src/components/chat/changes-card/changes-card.tsx): the card at a
 * Task's foot listing the files it touched — a transcript frame with a counted header, rows that
 * say in words what a click does, plain rows when nothing opens, and a fold past a few rows.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ChangesCard, PathLabel } from "../src/components/chat/changes-card/changes-card";
import type { ChangesCardProps } from "../src/components/chat/changes-card/changes-card";
import { classTokens, renderStatic } from "../src/testing";

const open = () => {};
const card = (props: Partial<ChangesCardProps> = {}) =>
  renderStatic(
    createElement(ChangesCard, {
      glyph: "M0 0h24",
      title: "2 files",
      rows: [
        { id: "a", path: "src/a.ts", glyph: "M1 1h1", tooltip: "src/a.ts", onOpen: open },
        { id: "b", path: "b.md", glyph: "M2 2h1" },
      ],
      openHint: "Preview",
      showMore: (n: number) => `Show ${n} more`,
      showLess: "Show less",
      ...props,
    }),
  );

describe("ChangesCard", () => {
  it("is a transcript frame: a counted header strip over the rows", () => {
    const html = card();
    expect(html).toMatch(/^<div class="ui-frame [^"]*"><div data-slot="head"/);
    expect(html).toContain('<div data-slot="body"');
    expect(html).toContain(">2 files</span>");
  });

  it("makes a row that opens a button naming its action, and one that does not plain text", () => {
    const html = card();
    const opener = /<button type="button" data-tooltip="src\/a\.ts"[^>]*>[\s\S]*?Preview<\/span>/;
    expect(html).toMatch(opener);
    expect(html).toMatch(/<div class="[^"]*">(?:(?!<button)[\s\S])*b\.md/);
    expect(html.match(/Preview/g)).toHaveLength(1);
  });

  it("puts a header action in words, and names a row's glyph and mark", () => {
    const html = card({
      action: { label: "Open list", onClick: open },
      rows: [
        {
          id: "m",
          path: "prefs.md",
          glyph: "M3 3h1",
          glyphLabel: "User memory",
          mark: { glyph: "M4 4h1", label: "Written" },
          onOpen: open,
        },
      ],
    });
    expect(html).toMatch(/<button type="button" class="[^"]*">Open list<\/button>/);
    expect(html).toContain('<span class="sr-only">User memory</span>');
    expect(html).toContain('role="img" aria-label="Written" data-tooltip="Written"');
  });

  it("folds past the first rows behind a row that counts the rest", () => {
    const rows = ["a", "b", "c", "d", "e"].map((id) => ({ id, path: `${id}.ts`, glyph: "M0 0" }));
    const html = card({ rows });
    expect(html).toContain("c.ts");
    expect(html).not.toContain("d.ts");
    expect(html).toContain("Show 2 more");
  });

  it("draws nothing without rows", () => {
    expect(card({ rows: [] })).toBe("");
  });
});

describe("PathLabel", () => {
  it("fades the directory and sets the name in bold, both able to truncate", () => {
    const html = renderStatic(createElement(PathLabel, { path: "src/lib/a.ts" }));
    expect(html).toMatch(/>src\/lib\/<\/span><span class="[^"]*font-semibold[^"]*">a\.ts</);
    expect(classTokens(html)).toEqual(expect.arrayContaining(["shrink-[9999]", "truncate"]));
  });
});
