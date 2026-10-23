/**
 * Numbered citations in a post, through the page's whole pipeline (`PostBody`, react-dom/server
 * static markup, node env). Posts cite with GFM footnotes: `…a sentence[^1].` in the text and
 * `[^1]: [Title](https://…)` at the end.
 *
 * - Given a post citing source 1 twice and source 2 once, each citation is a raised number linking
 *   to its source's entry, numbered by the source, each place with an id of its own.
 * - Given citations before or after a sentence's punctuation, each run of them reads as one
 *   bracketed group, `[2, 1]`, with real bracket and comma text, and no line can break before it.
 * - Given a citation wherever a post may put one (alone, opening a paragraph, inside bold or
 *   emphasis, before Chinese punctuation, in a list, a quote or a table, under a label that is not
 *   a number), it still reads `[n]`, numbered by first use.
 * - Given either language, the list after the body is headed in that language, by the element
 *   every citation names as its description.
 * - Given the list, each source appears once: its title links to the source through the external
 *   confirmation, and back-links return to every place that cites it, labelled for screen
 *   readers with the source and the place.
 * - Given a post in Chinese, the ids are still plain ASCII and carry no prefix.
 * - Given a body with a drawn figure and a citation, both render.
 * - Given a post without citations, no references list appears.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PostBody } from "../src/pages/blog-post";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const render = (body: string) => renderToStaticMarkup(createElement(PostBody, { body }));

interface Anchor {
  attrs: Record<string, string>;
  text: string;
}

/** Every rendered link: its attributes and its inner markup. */
const anchors = (html: string): Anchor[] =>
  [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/gs)].map(([, attrs = "", text = ""]) => ({
    attrs: Object.fromEntries(
      [...attrs.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)].map(([, name = "", value = ""]) => [
        name,
        value,
      ]),
    ),
    text,
  }));

/** The inner markup of the list entry with this id. */
const entry = (html: string, id: string) =>
  new RegExp(`<li id="${id}">(.*?)</li>`, "s").exec(html)?.[1] ?? "";

const SOURCES = [
  "[^1]: [First source](https://example.com/one)",
  "[^2]: [Second source](https://example.org/two)",
].join("\n");

const CITING = `A sentence[^1]. Another one[^2][^1].\n\n${SOURCES}`;

afterEach(() => setActiveStrings(zh));

describe("a post's citations", () => {
  it("links each citation, a raised number, to its source's entry", () => {
    const html = render(CITING);
    const refs = anchors(html).filter((a) => "data-footnote-ref" in a.attrs);
    expect(refs.map((a) => [a.attrs.href, a.attrs.id, a.text])).toEqual([
      ["#fn-1", "fnref-1", "1"],
      ["#fn-2", "fnref-2", "2"],
      ["#fn-1", "fnref-1-2", "1"],
    ]);
    for (const ref of refs) expect(ref.attrs["aria-describedby"]).toBe("footnote-label");
  });

  it.each([
    ["before", CITING, "one\u2060<sup"],
    ["after", `A sentence.[^1] Another one.[^2][^1]\n\n${SOURCES}`, "one.\u2060<sup"],
  ])(
    "sets each run as one bracketed group with the citations %s the punctuation",
    (_place, body, glued) => {
      const html = render(body);
      const groups = [...html.matchAll(/(.)<sup class="site-cite">(.*?)<\/sup>/gs)];
      // The group's text, links and all, is what a reader sees and what a copy of the page carries.
      expect(groups.map(([, , inner = ""]) => inner.replace(/<[^>]*>/g, ""))).toEqual([
        "[1]",
        "[2,\u00a01]",
      ]);
      // A word joiner ties each group to the text before it.
      for (const [, before] of groups) expect(before).toBe("\u2060");
      expect(html).toContain(glued);
    },
  );

  it.each([
    ["alone", "One claim[^1].", ["[1]"]],
    ["opening a paragraph", "[^1] opens this paragraph.", ["[1]"]],
    ["inside bold and emphasis", "**A key sentence[^1]**. And *a hedge[^2]*.", ["[1]", "[2]"]],
    [
      "before Chinese punctuation",
      "**关键句[^1]**。又一句[^2][^1]，然后[^2]！",
      ["[1]", "[2,\u00a01]", "[2]"],
    ],
    ["in a list and a quote", "- an item[^1]\n\n> a quote[^2]", ["[1]", "[2]"]],
    ["in a table", "| a | b |\n| - | - |\n| cell[^1] | x |", ["[1]"]],
    ["under a word label", "A claim[^paper]. Another[^2].", ["[1]", "[2]"]],
  ])("brackets a citation %s", (_place, text, groups) => {
    const html = render(`${text}\n\n[^1]: One\n[^2]: Two\n[^paper]: A paper`);
    const read = [...html.matchAll(/<sup class="site-cite">(.*?)<\/sup>/gs)].map(([, inner = ""]) =>
      inner.replace(/<[^>]*>/g, ""),
    );
    expect(read).toEqual(groups);
    // No citation is left outside a group, as a bare raised number.
    expect(html.match(/data-footnote-ref/g)).toHaveLength(
      groups
        .join("")
        .replace(/[^\d]+/g, " ")
        .trim()
        .split(" ").length,
    );
  });

  it.each([
    ["zh", zh],
    ["en", en],
  ] as const)("heads the list in %s, by the element every citation names", (_lang, strings) => {
    setActiveStrings(strings);
    const html = render(CITING);
    const heading = /<section\b[^>]*data-footnotes[^>]*>\s*<h2\b([^>]*)>(.*?)<\/h2>/s.exec(html);
    expect(heading?.[1]).toContain('id="footnote-label"');
    expect(heading?.[2]).toBe(strings.blog.references);
  });

  it("lists each source once, linked out through the confirmation, with a way back to each citation", () => {
    setActiveStrings(en);
    const html = render(CITING);
    expect(html.match(/<li id="fn-/g)).toHaveLength(2);

    const first = anchors(entry(html, "fn-1"));
    const title = first.find((a) => a.attrs.href === "https://example.com/one");
    expect(title?.text).toBe("First source");
    expect(title?.attrs.rel).toBe("noopener noreferrer");
    const back = first.filter((a) => "data-footnote-backref" in a.attrs);
    expect(back.map((a) => [a.attrs.href, a.attrs["aria-label"]])).toEqual([
      ["#fnref-1", en.blog.backToRef(1, 1)],
      ["#fnref-1-2", en.blog.backToRef(1, 2)],
    ]);
    // The second way back is told apart on screen, too.
    expect(back[1]?.text).toContain("<sup>2</sup>");

    const second = anchors(entry(html, "fn-2")).filter((a) => "data-footnote-backref" in a.attrs);
    expect(second.map((a) => a.attrs.href)).toEqual(["#fnref-2"]);
  });

  it("keeps the ids plain ASCII, without a prefix, in a Chinese post", () => {
    const html = render("一句话。[^1]又一句。[^1]\n\n[^1]: [来源标题](https://example.com/zh)");
    const ids = [...html.matchAll(/\bid="([^"]*)"/g)]
      .map(([, id = ""]) => id)
      .filter((id) => id.startsWith("fn"));
    expect(ids).toEqual(["fnref-1", "fnref-1-2", "fn-1"]);
    expect(html).not.toContain("user-content-");
  });

  it("renders a drawn figure and a citation in one body", () => {
    const html = render(
      [
        '<figure class="post-figure" data-figure="flow"><svg class="fig-svg" viewBox="0 0 10 10" role="img" aria-labelledby="flow-title"><title id="flow-title">A flow</title><rect x="0" y="0" width="10" height="10"/></svg><figcaption>One flow.</figcaption></figure>',
        "",
        "The flow is measured.[^1]",
        "",
        "[^1]: [The measurement](https://example.com/m)",
      ].join("\n"),
    );
    expect(html).toContain('<figure class="post-figure" data-figure="flow"><svg');
    expect(html).toContain('<li id="fn-1">');
    expect(html).not.toContain("&lt;");
  });

  it("shows no references list for a post that cites nothing", () => {
    expect(render("No citations here.")).not.toContain("data-footnotes");
  });
});
