/**
 * Post-build step: GitHub Pages serves static files only, so every doc route gets a
 * copy of the SPA shell at dist/<slug>/index.html — deep links (…/docs/omni-message)
 * then load without relying on a 404 fallback (the site-root 404.html belongs to the
 * landing page, which would swallow /docs/* misses). Slugs are derived from the
 * content/ filenames (<slug>.<lang>.md), the same source the router reads.
 */
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(pkg, "dist");

const slugs = new Set(
  readdirSync(join(pkg, "content"))
    .map((file) => /^(.+)\.(zh|en)\.md$/.exec(file)?.[1])
    .filter((slug) => slug !== undefined),
);

for (const slug of slugs) {
  mkdirSync(join(dist, slug), { recursive: true });
  copyFileSync(join(dist, "index.html"), join(dist, slug, "index.html"));
}
console.log(`[postbuild] wrote ${slugs.size} route shells under dist/`);
