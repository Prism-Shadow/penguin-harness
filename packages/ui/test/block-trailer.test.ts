/**
 * The block trailer seam (src/components/content/prose/block-trailer.tsx): what a surface adds
 * below a paragraph or a list item, from the links inside it — after the block, once per block,
 * with the links in reading order; never for text that only looks like a link, never while the
 * text streams, and nothing at all without a provider.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Md } from "../src/components/content/prose/prose";
import { ProseBlockTrailerProvider } from "../src/components/content/prose/block-trailer";
import type { ProseBlockTrailer } from "../src/components/content/prose/block-trailer";
import { renderStatic } from "../src/testing";

/** Marks each block's trailer with the hrefs it was handed. */
const mark: ProseBlockTrailer = (hrefs) => createElement("aside", null, hrefs.join("|"));

const render = (text: string, streaming = false, trailer: ProseBlockTrailer | null = mark) =>
  renderStatic(
    createElement(ProseBlockTrailerProvider, { trailer }, createElement(Md, { text, streaming })),
  );

describe("ProseBlockTrailer", () => {
  it("follows each paragraph with its links in reading order, and leaves the links alone", () => {
    const html = render("Play [a](a.mp3) then [b](b.wav) and [a again](a.mp3).\n\nNo links here.");
    expect(html).toContain(
      '<p>Play <a href="a.mp3" target="_blank" rel="noreferrer">a</a> then ' +
        '<a href="b.wav" target="_blank" rel="noreferrer">b</a> and ' +
        '<a href="a.mp3" target="_blank" rel="noreferrer">a again</a>.</p>' +
        "<aside>a.mp3|b.wav|a.mp3</aside>",
    );
    expect(html.match(/<aside>/g)).toHaveLength(1);
  });

  it("ends a list item, and leaves a nested list's links to the nested item", () => {
    const html = render("- [one](1.mp3)\n  - [two](2.mp3)\n- plain");
    expect(html).toMatch(
      /<li><a [^>]*>one<\/a>\n?<ul>\n?<li><a [^>]*>two<\/a><aside>2\.mp3<\/aside><\/li>/,
    );
    expect(html).toMatch(/<\/ul>\n?<aside>1\.mp3<\/aside><\/li>/);
    expect(html.match(/<aside>/g)).toHaveLength(2);
  });

  it("gives a loose list's paragraph the trailer, not the item as well", () => {
    const html = render("- [one](1.mp3)\n\n- [two](2.mp3)");
    expect(html.match(/<aside>1\.mp3<\/aside>/g)).toHaveLength(1);
    expect(html).toContain("</p><aside>1.mp3</aside>");
  });

  it("finds no link in a code span or a code block", () => {
    const html = render("Try `[a](a.mp3)` here.\n\n```\n[b](b.mp3)\n```");
    expect(html).not.toContain("<aside>");
  });

  it("adds nothing while the text streams, and nothing without a provider", () => {
    expect(render("Play [a](a.mp3).", true)).not.toContain("<aside>");
    expect(render("Play [a](a.mp3).", false, null)).not.toContain("<aside>");
    expect(renderStatic(createElement(Md, { text: "Play [a](a.mp3)." }))).toBe(
      '<p>Play <a href="a.mp3" target="_blank" rel="noreferrer">a</a>.</p>',
    );
  });
});
