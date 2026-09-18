/**
 * Content integrity: the sidebar (DOCS_NAV) and the content/ directory must agree —
 * every navigated slug has both zh and en files with a frontmatter title, and every
 * content file belongs to the navigation (an orphan file would be unreachable).
 * Also guards the links pages navigate each other and themselves with. Heading ids come
 * from the heading text, so two identical headings collide into one id (the TOC then
 * renders two entries pointing at the same place) and a "#..." link naming no heading
 * scrolls nowhere. An absolute "/..." link is handed to the router as a doc route, so a
 * target that is not a slug renders nothing at all — the way "/docs/goal-mode" did,
 * carrying the deployed base path that the router already supplies. A "/slug#anchor"
 * link carries both halves, and the anchor half is the one that rots quietly: a heading
 * renamed on the target page leaves the link working and the reader on the wrong part of
 * it. Each language links its own twin, since the headings are translated. The sidebar's
 * section labels are checked here too: `S.sections` is a Record, so a section id with no
 * label typechecks and renders an empty heading. Reads the files via fs so the check runs
 * under plain node (no Vite glob).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOCS_NAV, DOC_SLUGS, pagerFor } from "../src/lib/nav";
import { parseFrontmatter } from "../src/lib/frontmatter";
import { hashTargetId } from "../src/lib/hash";
import { en } from "../src/lib/strings-en";
import { zh } from "../src/lib/strings";
import { extractToc } from "../src/lib/toc";

const contentDir = join(__dirname, "..", "content");
const files = readdirSync(contentDir).filter((f) => f.endsWith(".md"));

/** In-page targets of Markdown links, i.e. "[label](#anchor)", resolved as the router does. */
function inPageAnchors(body: string): string[] {
  return [...body.matchAll(/\]\(#([^)\s]+)\)/g)].map((match) => hashTargetId(match[1]!));
}

/** Absolute doc links, i.e. "[label](/slug)" or "[label](/slug#anchor)", both halves resolved as the router does. */
function docLinks(body: string): Array<{ slug: string; anchor: string | null }> {
  return [...body.matchAll(/\]\((\/[^)\s]*)\)/g)].map((match) => {
    const [path, hash] = match[1]!.split("#");
    return {
      slug: path!.replace(/^\//, "").replace(/\/$/, ""),
      anchor: hash === undefined ? null : hashTargetId(hash),
    };
  });
}

/** Heading ids of every content file, by file name. */
const headingIds = new Map<string, Set<string>>(
  files.map((file) => {
    const { body } = parseFrontmatter(readFileSync(join(contentDir, file), "utf8"));
    return [file, new Set(extractToc(body).map((entry) => entry.id))];
  }),
);

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
  });

  it("labels every navigation section in both dictionaries", () => {
    for (const { id } of DOCS_NAV) {
      expect(zh.sections[id], `missing zh label for the ${id} section`).toBeTruthy();
      expect(en.sections[id], `missing en label for the ${id} section`).toBeTruthy();
    }
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
      const ids = headingIds.get(file)!;
      const dangling = inPageAnchors(body).filter((anchor) => !ids.has(anchor));
      expect(dangling, `dangling in-page anchors in ${file}`).toEqual([]);
    }
  });

  it("points every absolute doc link at a navigated slug", () => {
    for (const file of files) {
      const { body } = parseFrontmatter(readFileSync(join(contentDir, file), "utf8"));
      const dangling = docLinks(body)
        .map((link) => link.slug)
        .filter((slug) => !DOC_SLUGS.includes(slug));
      expect(dangling, `links to non-existent doc pages in ${file}`).toEqual([]);
    }
  });

  it("resolves every cross-page anchor to a heading of the target page in the same language", () => {
    for (const file of files) {
      const lang = /\.(zh|en)\.md$/.exec(file)![1]!;
      const { body } = parseFrontmatter(readFileSync(join(contentDir, file), "utf8"));
      const dangling = docLinks(body)
        .filter((link) => link.anchor !== null && DOC_SLUGS.includes(link.slug))
        .filter((link) => !headingIds.get(`${link.slug}.${lang}.md`)?.has(link.anchor!))
        .map((link) => `/${link.slug}#${link.anchor}`);
      expect(dangling, `dangling cross-page anchors in ${file}`).toEqual([]);
    }
  });
});
