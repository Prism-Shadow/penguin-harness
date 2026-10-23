/**
 * In-page anchors of a blog post, through the page's own render pipeline (react-dom/server
 * static markup, node env). A target is any rendered element with an id: a heading, a citation,
 * an entry in the references.
 *
 * - Given a hand-written "[label](#anchor)" link and a TOC entry to a CJK heading, the hash a
 *   browser reports for each (percent-encoded) resolves, through hashTargetId, to the heading.
 * - Given citations, each `#fn-n` link, each back-link and each citation's `aria-describedby`
 *   names a rendered element.
 * - Given every post file on disk (read via fs, both languages), every in-page link, TOC entry and
 *   `aria-describedby` resolves.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PostBody } from "../src/pages/blog-post";
import { extractToc, hashTargetId, parseFrontmatter } from "@prismshadow/penguin-ui/site";

const contentDir = join(__dirname, "..", "content", "blog");
const files = readdirSync(contentDir).filter((f) => f.endsWith(".md"));

const render = (body: string) => renderToStaticMarkup(createElement(PostBody, { body }));

/** Ids of every rendered element. */
const renderedIds = (html: string) =>
  new Set([...html.matchAll(/\sid="([^"]*)"/g)].map(([, id = ""]) => id));

/** Hrefs of the rendered in-page links ("#..."), in document order. */
const inPageHrefs = (html: string) =>
  [...html.matchAll(/<a\b[^>]*\bhref="(#[^"]*)"/g)].map(([, href = ""]) => href);

/** The ids every `aria-describedby` names. */
const describedBy = (html: string) =>
  [...html.matchAll(/\saria-describedby="([^"]*)"/g)].flatMap(([, ids = ""]) => ids.split(/\s+/));

/** The element id a click on `href` targets: the hash the browser reports, then hashTargetId. */
const targetOf = (href: string) =>
  hashTargetId(new URL(href, "https://example.test/blog/post").hash);

/** In-page links, TOC entries and descriptions of `body` that name no rendered element. */
function unresolved(body: string) {
  const html = render(body);
  const ids = renderedIds(html);
  return {
    links: inPageHrefs(html).filter((href) => !ids.has(targetOf(href))),
    toc: extractToc(body)
      .map((entry) => `#${entry.id}`)
      .filter((href) => !ids.has(targetOf(href))),
    describedBy: describedBy(html).filter((id) => !ids.has(id)),
  };
}

const NOTHING = { links: [], toc: [], describedBy: [] };

describe("blog post in-page anchors", () => {
  it("resolves a hand-written link and a TOC entry to a CJK heading", () => {
    const body = [
      "## 升级须知",
      "",
      "见下方[升级须知](#升级须知)。",
      "",
      "### 为什么是 PenguinHarness",
      "",
      "详见[这一节](#为什么是-penguinharness)。",
    ].join("\n");
    const html = render(body);
    // The renderer emits the link percent-encoded, which is also what location.hash reports.
    expect(inPageHrefs(html)[0]).toBe("#%E5%8D%87%E7%BA%A7%E9%A1%BB%E7%9F%A5");
    expect(inPageHrefs(html).map(targetOf)).toEqual(["升级须知", "为什么是-penguinharness"]);
    expect(unresolved(body)).toEqual(NOTHING);
  });

  it("resolves citations, their back-links and their description", () => {
    const body = [
      "## 结论",
      "",
      "一句话。[^1] Another sentence.[^2][^1]",
      "",
      "[^1]: [来源](https://example.com/1)",
      "[^2]: [Source](https://example.com/2)",
    ].join("\n");
    const html = render(body);
    expect(inPageHrefs(html)).toEqual(
      expect.arrayContaining(["#fn-1", "#fn-2", "#fnref-1", "#fnref-1-2", "#fnref-2"]),
    );
    expect(describedBy(html)).toContain("footnote-label");
    expect(unresolved(body)).toEqual(NOTHING);
  });

  it("resolves every post's in-page links, TOC entries and descriptions", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const { body } = parseFrontmatter(readFileSync(join(contentDir, file), "utf8"));
      expect(unresolved(body), file).toEqual(NOTHING);
    }
    // Renders every post through the full markdown pipeline: on hosted runners that alone sits at
    // the 5 s default, so the budget grows with the blog rather than flaking at its edge.
  }, 30_000);
});
