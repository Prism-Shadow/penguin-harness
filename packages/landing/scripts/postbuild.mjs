/**
 * Post-build step for GitHub Pages, which serves static files only:
 *
 * - A shell per blog route (dist/blog/index.html, dist/blog/<slug>/index.html), the
 *   same trick the docs package uses. Without them Pages answers every blog URL from
 *   404.html: the SPA still boots and the page looks right, but the response carries
 *   HTTP 404, so crawlers drop it and the posts never get indexed. Each shell also
 *   carries its own canonical/og:url, which is what a crawler that does not run JS
 *   sees — the SPA cannot rewrite them in time to matter.
 * - dist/404.html for paths that really do not exist (and for /docs/* misses, which the
 *   landing router hands to the docs index). Its canonical is stripped: claiming the
 *   home page as the canonical of an unknown URL would ask search engines to fold
 *   every typo into it.
 * - .nojekyll so Pages serves the dist verbatim without Jekyll processing.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { absoluteUrl, blogRoutes } from "./site-routes.mjs";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const shell = readFileSync(join(dist, "index.html"), "utf8");

// Loose enough to survive Vite's HTML rewriting, strict enough to hit only these two
// tags. Both must exist in index.html — if a future edit drops them, fail the build
// rather than silently shipping every route with the home page's canonical.
const CANONICAL = /<link\s+rel="canonical"[^>]*>/;
const OG_URL = /<meta\s+property="og:url"[^>]*>/;
for (const [name, pattern] of [
  ["canonical", CANONICAL],
  ["og:url", OG_URL],
]) {
  if (!pattern.test(shell)) {
    throw new Error(`[postbuild] no ${name} tag in dist/index.html — index.html must declare one`);
  }
}

/** The shell with its self-referencing URLs pointed at `route`. */
function shellFor(route) {
  const url = absoluteUrl(route);
  return shell
    .replace(CANONICAL, `<link rel="canonical" href="${url}" />`)
    .replace(OG_URL, `<meta property="og:url" content="${url}" />`);
}

const routes = blogRoutes();
for (const { route } of routes) {
  const dir = join(dist, route);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), shellFor(route));
}

writeFileSync(join(dist, "404.html"), shell.replace(CANONICAL, ""));
writeFileSync(join(dist, ".nojekyll"), "");
console.log(
  `[postbuild] wrote ${routes.length} blog route shells, dist/404.html and dist/.nojekyll`,
);
