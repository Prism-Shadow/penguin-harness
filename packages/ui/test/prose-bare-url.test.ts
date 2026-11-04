/**
 * A reply's bare URLs and bold as the transcript renders them (`Md`, through REMARK_PLUGINS). The
 * rule itself — which characters a bare URL holds, when a bold span closes beside CJK — is the
 * chat dialect's, and packages/chat-markdown's own suite walks it case by case; these pin that
 * the rendered reply carries it, alongside the math and tilde passes the shared stage adds.
 *
 * - Given the report — `**http://localhost:7367/**，要看的博文：http://…` — the first URL renders
 *   as a bold link ending at its `/`, the Chinese between stays text, and the second URL is a
 *   link of its own; both open in a new tab.
 * - Given a bold span closing between full-width punctuation and CJK, it renders bold.
 * - Given a bare URL beside a formula and a tilde range, the formula still typesets, the tildes
 *   stay as typed, and the URL ends before the Chinese after it.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Md } from "../src/components/content/prose/prose";
import { renderStatic } from "../src/testing";

const render = (text: string) => renderStatic(createElement(Md, { text }));

/** Every rendered link as `[href, text]`. */
const links = (html: string) =>
  [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[1], m[2]]);

describe("a reply's bare URLs and bold", () => {
  it("renders the report's line as a bold link, the Chinese, then a second link", () => {
    const blog = "http://localhost:7367/blog/keeping-the-prompt-cache-hot";
    const html = render(`**http://localhost:7367/**，要看的博文：${blog}`);
    expect(links(html)).toEqual([
      ["http://localhost:7367/", "http://localhost:7367/"],
      [blog, blog],
    ]);
    expect(html).toMatch(
      /<strong><a [^>]*>http:\/\/localhost:7367\/<\/a><\/strong>，要看的博文：<a /,
    );
    expect(html.match(/target="_blank"/g)).toHaveLength(2);
  });

  it("renders bold that closes between full-width punctuation and Chinese", () => {
    expect(render("**粗体（注）**后面")).toContain("<strong>粗体（注）</strong>后面");
  });

  it("keeps the math and tilde passes beside a bare URL", () => {
    const html = render("约 3~5 天或~30 秒，公式 $x^2$ 见 https://penguin.ooo/docs，完");
    // Two tildes in one paragraph are a strikethrough to GFM; the reply shows them as typed.
    expect(html).toContain("3~5 天或~30 秒");
    expect(html).not.toContain("<del>");
    expect(html).toContain('class="katex"');
    expect(links(html)).toEqual([["https://penguin.ooo/docs", "https://penguin.ooo/docs"]]);
    expect(html).toContain("</a>，完");
  });
});
