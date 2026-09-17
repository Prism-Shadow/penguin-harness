/**
 * In-page anchors of a blog post, through the page's own render pipeline (react-dom/server
 * static markup, node env): a hand-written "[label](#anchor)" link and a TOC entry must both
 * resolve — via the hash a browser reports for them, then hashTargetId — to the id of a
 * rendered heading. CJK headings are the case that matters: their anchors reach
 * location.hash percent-encoded. Checked on a fixture and on every post file on disk (read
 * via fs, both languages).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { describe, expect, it } from "vitest";
import { MD_COMPONENTS, REHYPE_PLUGINS, REMARK_PLUGINS } from "../src/pages/blog-post";
import { parseFrontmatter } from "../src/lib/frontmatter";
import { hashTargetId } from "../src/lib/hash";
import { extractToc } from "../src/lib/toc";

const contentDir = join(__dirname, "..", "content", "blog");
const files = readdirSync(contentDir).filter((f) => f.endsWith(".md"));

const render = (body: string) =>
  renderToStaticMarkup(
    createElement(
      Markdown,
      { remarkPlugins: REMARK_PLUGINS, rehypePlugins: REHYPE_PLUGINS, components: MD_COMPONENTS },
      body,
    ),
  );

/** Ids of the rendered h2/h3 headings, in document order. */
const headingIds = (html: string) =>
  [...html.matchAll(/<h[23] id="([^"]*)"/g)].map((match) => match[1]!);

/** Hrefs of the rendered in-page links ("#..."), in document order. */
const inPageHrefs = (html: string) =>
  [...html.matchAll(/<a\b[^>]*\bhref="(#[^"]*)"/g)].map((match) => match[1]!);

/** The element id a click on `href` targets: the hash the browser reports, then hashTargetId. */
const targetOf = (href: string) =>
  hashTargetId(new URL(href, "https://example.test/blog/post").hash);

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
    const ids = headingIds(html);
    expect(ids).toEqual(["升级须知", "为什么是-penguinharness"]);
    const hrefs = inPageHrefs(html);
    // The renderer emits the link percent-encoded, which is also what location.hash reports.
    expect(hrefs[0]).toBe("#%E5%8D%87%E7%BA%A7%E9%A1%BB%E7%9F%A5");
    expect(hrefs.map(targetOf)).toEqual(ids);
    // A TOC entry links to `#${entry.id}`.
    expect(extractToc(body).map((entry) => targetOf(`#${entry.id}`))).toEqual(ids);
  });

  it("resolves every post's in-page links and TOC entries to a rendered heading", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const { body } = parseFrontmatter(readFileSync(join(contentDir, file), "utf8"));
      const html = render(body);
      const ids = new Set(headingIds(html));
      const tocMisses = extractToc(body)
        .map((entry) => `#${entry.id}`)
        .filter((href) => !ids.has(targetOf(href)));
      expect(tocMisses, `TOC entries naming no rendered heading in ${file}`).toEqual([]);
      const dangling = inPageHrefs(html).filter((href) => !ids.has(targetOf(href)));
      expect(dangling, `dangling in-page anchors in ${file}`).toEqual([]);
    }
  });
});
