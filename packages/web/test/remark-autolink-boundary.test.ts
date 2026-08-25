/**
 * Where a bare URL ends. GFM's autolink literal stops at whitespace and trims a little ASCII
 * punctuation, which leaves CJK — the comma, the clause after it, or plain text run up against the
 * host — inside the href. These pin the boundary at the last ASCII character, and pin the two
 * things that must not change: explicit links, and URLs that are already fine.
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { REMARK_PLUGINS } from "../src/lib/remark-autolink-boundary";

/** The rendered `[href, text]` of the first link, or null. */
function firstLink(markdown: string): [string, string] | null {
  const html = renderToStaticMarkup(
    React.createElement(ReactMarkdown, { remarkPlugins: REMARK_PLUGINS }, markdown),
  );
  const m = /<a href="([^"]*)"[^>]*>([^<]*)<\/a>/.exec(html);
  return m ? [m[1]!, m[2]!] : null;
}

/** The rendered text of the whole thing, tags stripped — what the reader actually sees. */
function plainText(markdown: string): string {
  return renderToStaticMarkup(
    React.createElement(ReactMarkdown, { remarkPlugins: REMARK_PLUGINS }, markdown),
  ).replace(/<[^>]*>/g, "");
}

describe("a bare URL ends at the last ASCII character", () => {
  it("stops before CJK punctuation, and the punctuation stays in the sentence", () => {
    expect(firstLink("见 https://penguin.ooo，然后继续")).toEqual([
      "https://penguin.ooo",
      "https://penguin.ooo",
    ]);
    expect(plainText("见 https://penguin.ooo，然后继续")).toContain("，然后继续");
  });

  it("stops before CJK text with no punctuation between", () => {
    expect(firstLink("中文https://penguin.ooo英文")).toEqual([
      "https://penguin.ooo",
      "https://penguin.ooo",
    ]);
    expect(plainText("中文https://penguin.ooo英文")).toContain("英文");
  });

  it("stops before a full-width bracket after a path with a query", () => {
    expect(firstLink("参考 https://penguin.ooo/a/b?c=1（备注）")).toEqual([
      "https://penguin.ooo/a/b?c=1",
      "https://penguin.ooo/a/b?c=1",
    ]);
  });

  it("stops before a full stop at the end of a sentence", () => {
    expect(firstLink("见 https://penguin.ooo。")).toEqual([
      "https://penguin.ooo",
      "https://penguin.ooo",
    ]);
  });
});

describe("what must not change", () => {
  it("leaves English alone — GFM already ends those correctly", () => {
    expect(firstLink("see https://penguin.ooo, then")).toEqual([
      "https://penguin.ooo",
      "https://penguin.ooo",
    ]);
    expect(firstLink("docs at https://penguin.ooo/docs work")).toEqual([
      "https://penguin.ooo/docs",
      "https://penguin.ooo/docs",
    ]);
  });

  it("leaves an explicit link's CJK text alone", () => {
    // The trim applies to autolinks only; here the CJK *is* the link text the author wrote.
    expect(firstLink("[中文文档](https://penguin.ooo/docs)")).toEqual([
      "https://penguin.ooo/docs",
      "中文文档",
    ]);
  });

  it("leaves a percent-encoded path alone, CJK or not", () => {
    expect(firstLink("见 https://penguin.ooo/wiki/%E4%B8%AD%E6%96%87 完")).toEqual([
      "https://penguin.ooo/wiki/%E4%B8%AD%E6%96%87",
      "https://penguin.ooo/wiki/%E4%B8%AD%E6%96%87",
    ]);
  });

  it("keeps a bare www. autolink working, prefix and all", () => {
    expect(firstLink("见 www.penguin.ooo，好")).toEqual([
      "http://www.penguin.ooo",
      "www.penguin.ooo",
    ]);
  });
});
