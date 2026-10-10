/**
 * Strikethrough is not rendered: a reply's tildes show as typed. Replies use `~` for ranges and
 * "about" far more often than for strikethrough, and two in one paragraph used to strike out the
 * words between them.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Md } from "../src/components/content/prose/prose";
import { renderStatic } from "../src/testing";

const render = (text: string) => renderStatic(createElement(Md, { text }));

describe("tildes in a reply", () => {
  it("never strike out the words between a range and an 'about'", () => {
    const html = render("需要 3~5 天，每次约 ~30 秒");
    expect(html).not.toContain("<del>");
    expect(html).toContain("需要 3~5 天，每次约 ~30 秒");
  });

  it("show double and single strikethrough markers as the characters typed", () => {
    const html = render("a ~~b~~ c ~d~ e");
    expect(html).not.toContain("<del>");
    expect(html).toContain("a ~~b~~ c ~d~ e");
  });

  it("keep what sat between them formatted as it was written", () => {
    const html = render("~~**bold** and `code`~~");
    expect(html).not.toContain("<del>");
    expect(html).toContain("~~<strong>bold</strong> and <code>code</code>~~");
  });

  it("leave the rest of GFM alone: tables and task lists still render", () => {
    const html = render("| a |\n| - |\n| 1 |\n\n- [x] done");
    expect(html).toContain("<table>");
    expect(html).toContain('type="checkbox"');
  });
});
