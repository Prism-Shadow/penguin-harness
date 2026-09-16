/**
 * Where a bare URL ends. GFM's autolink literal stops at whitespace and only then trims trailing
 * punctuation, so anything that follows the URL without a space — CJK text, a comma, the `**` that
 * was meant to close a bold span — is swallowed into the href. These pin the boundary where GFM
 * stopped looking, and pin the three things that must not change: explicit links, URLs that are
 * already fine, and the markers a URL legitimately carries in its middle.
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { REMARK_PLUGINS } from "../src/lib/markdown-plugins";

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

/** The rendered markup, for the assertions about which span a link ended up inside. */
function html(markdown: string): string {
  return renderToStaticMarkup(
    React.createElement(ReactMarkdown, { remarkPlugins: REMARK_PLUGINS }, markdown),
  );
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

describe("a bare URL ends before a Markdown span marker", () => {
  it("keeps the `**` a bold span opened out of the href", () => {
    // The report: `**打开 <url>**查看`, where the closing `**` is followed by CJK rather than a
    // space, so GFM's trail never fires and the href carries the two asterisks.
    expect(firstLink("请**打开 http://127.0.0.1:4321/**查看")).toEqual([
      "http://127.0.0.1:4321/",
      "http://127.0.0.1:4321/",
    ]);
    // They go back to the sentence rather than disappearing. They stay literal there: a `**`
    // between a `/` and a CJK character closes nothing under CommonMark's flanking rule, which
    // is why `请**打开 abc/**查看` is not bold either.
    expect(plainText("请**打开 http://127.0.0.1:4321/**查看")).toContain("**查看");
  });

  it("leaves the same sentence alone when the bold span did close", () => {
    // A space after the closing `**` is all it takes: the emphasis resolves while parsing, the
    // markers never reach the URL, and this pass has nothing to do.
    const rendered = html("**打开 http://127.0.0.1:4321/** 看看");
    expect(rendered).toContain("<strong>");
    expect(firstLink("**打开 http://127.0.0.1:4321/** 看看")).toEqual([
      "http://127.0.0.1:4321/",
      "http://127.0.0.1:4321/",
    ]);
  });

  it("ends before `*`, `~` and a backtick, which no URL ends with", () => {
    expect(firstLink("见 http://x.test/?q=*看")).toEqual([
      "http://x.test/?q=",
      "http://x.test/?q=",
    ]);
    expect(firstLink("见 http://x.test/a~~好")).toEqual(["http://x.test/a", "http://x.test/a"]);
    // A backtick is the one marker GFM's own trail does not know about, so it reaches the href
    // even at the end of a line, where it arrives percent-encoded as `%60`.
    expect(firstLink("见 http://x.test/`用法")).toEqual(["http://x.test/", "http://x.test/"]);
    expect(firstLink("see http://x.test/`")).toEqual(["http://x.test/", "http://x.test/"]);
  });

  it("ends before a lone trailing `*` even with nothing to close", () => {
    // GFM already does this one when the `*` ends the line, and the rule here is the same at a
    // CJK boundary: a trailing `*` is never part of a URL, opener or no opener.
    expect(firstLink("http://x.test/a*")).toEqual(["http://x.test/a", "http://x.test/a"]);
    expect(plainText("http://x.test/a*")).toContain("*");
  });

  it("ends before a trailing `_` only when something opened one", () => {
    // `_` is ordinary in a path, so a trailing one is only a closing marker if the paragraph
    // spells an opener before the link.
    expect(firstLink("_见 http://x.test/a_看")).toEqual(["http://x.test/a", "http://x.test/a"]);
    expect(firstLink("见 http://x.test/a_看")).toEqual(["http://x.test/a_", "http://x.test/a_"]);
  });

  it("ends before a closer the URL never opened", () => {
    expect(firstLink("见 http://x.test/a]看")).toEqual(["http://x.test/a", "http://x.test/a"]);
    expect(firstLink("见 http://x.test/a>看")).toEqual(["http://x.test/a", "http://x.test/a"]);
  });
});

describe("markers a URL legitimately carries", () => {
  it("keeps `_` and `*` inside the URL, trimming only a trailing run", () => {
    expect(firstLink("**see http://x.test/a_b**")).toEqual([
      "http://x.test/a_b",
      "http://x.test/a_b",
    ]);
    expect(html("**see http://x.test/a_b**")).toContain("<strong>");
    expect(firstLink("_http://x.test/_")).toEqual(["http://x.test/", "http://x.test/"]);
    expect(html("_http://x.test/_")).toContain("<em>");
  });

  it("keeps parentheses the URL balances itself", () => {
    expect(firstLink("(http://x.test/a(b))")).toEqual(["http://x.test/a(b)", "http://x.test/a(b)"]);
    // Same URL with CJK after the closing paren, which is where GFM's own balancing stops.
    expect(firstLink("见 (http://x.test/a(b))看")).toEqual([
      "http://x.test/a(b)",
      "http://x.test/a(b)",
    ]);
  });
});
