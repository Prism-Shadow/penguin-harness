/**
 * Content integrity: the sidebar (DOCS_NAV) and the content/ directory must agree —
 * every navigated slug has both zh and en files with a frontmatter title, and every
 * content file belongs to the navigation (an orphan file would be unreachable).
 * Reads the files via fs so the check runs under plain node (no Vite glob).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOCS_NAV, DOC_SLUGS } from "../src/lib/nav";
import { parseFrontmatter } from "../src/lib/frontmatter";

const contentDir = join(__dirname, "..", "content");
const files = readdirSync(contentDir).filter((f) => f.endsWith(".md"));

describe("docs navigation / content integrity", () => {
  it("has unique slugs in DOCS_NAV", () => {
    expect(new Set(DOC_SLUGS).size).toBe(DOC_SLUGS.length);
    expect(DOCS_NAV.length).toBeGreaterThan(0);
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
});
