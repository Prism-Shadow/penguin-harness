/**
 * Content integrity: the sidebar (DOCS_NAV) and the content/ directory must agree —
 * every navigated slug has both zh and en files with a frontmatter title, and every
 * content file belongs to the navigation (an orphan file would be unreachable).
 * Also guards the links pages navigate each other and themselves with. Heading ids come
 * from the heading text, so two identical headings collide into one id (the TOC then
 * renders two entries pointing at the same place) and a "#..." link naming no heading
 * scrolls nowhere. An absolute "/..." link is handed to the router as a doc route, so a
 * target that is not a slug renders nothing at all — the way "/docs/goal-mode" did,
 * carrying the deployed base path that the router already supplies. Reads the files via
 * fs so the check runs under plain node (no Vite glob).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOCS_NAV, DOC_SLUGS, pagerFor } from "../src/lib/nav";
import { parseFrontmatter } from "../src/lib/frontmatter";
import { extractToc } from "../src/lib/toc";

const contentDir = join(__dirname, "..", "content");
const files = readdirSync(contentDir).filter((f) => f.endsWith(".md"));

/** In-page targets of Markdown links, i.e. "[label](#anchor)" (percent-decoded). */
function inPageAnchors(body: string): string[] {
  return [...body.matchAll(/\]\(#([^)\s]+)\)/g)].map((match) => decodeURIComponent(match[1]!));
}

/** Slugs of absolute doc links, i.e. "[label](/slug)" or "[label](/slug#anchor)". */
function docLinkSlugs(body: string): string[] {
  return [...body.matchAll(/\]\((\/[^)\s]*)\)/g)].map((match) =>
    match[1]!.split("#")[0]!.replace(/^\//, "").replace(/\/$/, ""),
  );
}

describe("docs navigation / content integrity", () => {
  it("has unique slugs in DOCS_NAV", () => {
    expect(new Set(DOC_SLUGS).size).toBe(DOC_SLUGS.length);
    expect(DOCS_NAV.length).toBeGreaterThan(0);
  });

  it("paginates every page to real neighbours, and never to itself", () => {
    for (const slug of DOC_SLUGS) {
      const { prev, next } = pagerFor(slug);
      for (const [dir, target] of [
        ["prev", prev],
        ["next", next],
      ] as const) {
        if (target === null) continue;
        expect(DOC_SLUGS, `${slug} paginates ${dir} to a non-existent page`).toContain(target);
        expect(target, `${slug} paginates ${dir} to itself`).not.toBe(slug);
      }
    }
    // The one page whose successor is not its sidebar neighbour (see NEXT_OVERRIDE).
    expect(pagerFor("quickstart-sdk").next).toBe("interfaces");
  });

  it("provides zh and en files with a title for every navigated slug", () => {
    for (const slug of DOC_SLUGS) {
      for (const lang of ["zh", "en"] as const) {
        const name = `${slug}.${lang}.md`;
        expect(files, `missing content file ${name}`).toContain(name);
        const { meta, body } = parseFrontmatter(readFileSync(join(contentDir, name), "utf8"));
        expect(meta.title, `missing title in ${name}`).toBeTruthy();
        expect(body.length, `empty body in ${name}`).toBeGreaterThan(0);
      }
    }
  });

  it("has no content file outside the navigation", () => {
    for (const file of files) {
      const slug = /^(.+)\.(zh|en)\.md$/.exec(file)?.[1];
      expect(slug, `unparsable content file name ${file}`).toBeTruthy();
      expect(DOC_SLUGS, `orphan content file ${file}`).toContain(slug!);
    }
  });

  it("gives every heading on a page its own anchor", () => {
    for (const file of files) {
      const { body } = parseFrontmatter(readFileSync(join(contentDir, file), "utf8"));
      const ids = extractToc(body).map((entry) => entry.id);
      const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
      expect(duplicates, `colliding heading anchors in ${file}`).toEqual([]);
    }
  });

  it("resolves every in-page anchor link to a heading on the same page", () => {
    for (const file of files) {
      const { body } = parseFrontmatter(readFileSync(join(contentDir, file), "utf8"));
      const ids = new Set(extractToc(body).map((entry) => entry.id));
      const dangling = inPageAnchors(body).filter((anchor) => !ids.has(anchor));
      expect(dangling, `dangling in-page anchors in ${file}`).toEqual([]);
    }
  });

  it("points every absolute doc link at a navigated slug", () => {
    for (const file of files) {
      const { body } = parseFrontmatter(readFileSync(join(contentDir, file), "utf8"));
      const dangling = docLinkSlugs(body).filter((slug) => !DOC_SLUGS.includes(slug));
      expect(dangling, `links to non-existent doc pages in ${file}`).toEqual([]);
    }
  });
});
