/**
 * Md (chat markdown) rendering contract, via react-dom/server static markup (node env, no DOM):
 * - every link — explicit [text](url), bare autolinked URL (remark-gfm), relative or #anchor —
 *   opens in a new tab: target="_blank" + rel="noreferrer" (a chat link must never navigate the
 *   SPA away from the live conversation);
 * - fenced code still routes through the module-scope pre override into CodeBlock (its chrome
 *   renders; Shiki only loads in an effect, which static markup never runs).
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Md } from "../src/features/chat/md";

const render = (text: string, streaming = false) =>
  renderToStaticMarkup(createElement(Md, { text, streaming }));

/** All rendered <a ...> opening tags. */
const anchors = (html: string) => html.match(/<a\b[^>]*>/g) ?? [];

const expectNewTab = (tag: string | undefined) => {
  expect(tag).toContain('target="_blank"');
  expect(tag).toContain('rel="noreferrer"');
};

describe("Md links", () => {
  it("explicit markdown links open in a new tab", () => {
    const html = render("See [the docs](https://example.com/docs) for details.");
    const tags = anchors(html);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('href="https://example.com/docs"');
    expectNewTab(tags[0]);
    expect(html).toContain(">the docs</a>");
  });

  it("bare autolinked URLs in CJK prose open in a new tab", () => {
    const html = render("前往 https://example.com/a/very/long/path 查看结果。");
    const tags = anchors(html);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('href="https://example.com/a/very/long/path"');
    expectNewTab(tags[0]);
  });

  it("relative and #anchor hrefs also open in a new tab (never SPA-navigate)", () => {
    const html = render("[rel](./file.md) and [frag](#section)");
    const tags = anchors(html);
    expect(tags).toHaveLength(2);
    for (const tag of tags) expectNewTab(tag);
  });

  it("applies in both streaming and settled component maps", () => {
    for (const streaming of [true, false]) {
      const tags = anchors(render("[x](https://example.com/)", streaming));
      expect(tags).toHaveLength(1);
      expectNewTab(tags[0]);
    }
  });
});

describe("Md code blocks", () => {
  it("fenced code still renders through the CodeBlock pre override", () => {
    const html = render("```js\nconst a = 1;\n```");
    expect(html).toContain("code-block"); // CodeBlock chrome wrapper class
    expect(html).toContain("const a = 1;");
  });
});
