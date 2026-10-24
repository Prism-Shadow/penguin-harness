/**
 * Post-build step for GitHub Pages, which serves static files only:
 *
 * - A shell per page and blog route (dist/download/index.html, dist/blog/<slug>/index.html,
 *   …), the same trick the docs package uses. Without them Pages answers every such URL from
 *   404.html: the SPA still boots and the page looks right, but the response carries
 *   HTTP 404, so crawlers drop it and the posts never get indexed. Each shell also
 *   carries its own canonical/og:url, and a page with metadata of its own (site-routes.mjs)
 *   its title, description and share card, which is what a crawler or an unfurler that does
 *   not run JS sees — the SPA cannot rewrite them in time to matter (route-shell.mjs).
 * - dist/404.html for paths that really do not exist (and for /docs/* misses, which the
 *   landing router hands to the docs index). Its canonical is stripped: claiming the
 *   home page as the canonical of an unknown URL would ask search engines to fold
 *   every typo into it.
 * - .nojekyll so Pages serves the dist verbatim without Jekyll processing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { notFoundShell, shellFor } from "./route-shell.mjs";
import { absoluteUrl, blogRoutes, pageRoutes } from "./site-routes.mjs";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const shell = readFileSync(join(dist, "index.html"), "utf8");

const routes = [...pageRoutes(), ...blogRoutes()];
for (const { route, meta } of routes) {
  // A page's own share card must ship with it: unfurlers fetch it by absolute URL, so a missing
  // file would only show up as a broken preview after the deploy.
  if (meta !== undefined && !existsSync(join(dist, meta.image))) {
    throw new Error(
      `[postbuild] ${route} names ${meta.image}, which is not in public/ — render it with scripts/capture-og-cover.mjs`,
    );
  }
  const dir = join(dist, route);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "index.html"),
    shellFor(
      shell,
      absoluteUrl(route),
      meta === undefined ? undefined : { ...meta, image: absoluteUrl(meta.image) },
    ),
  );
}

writeFileSync(join(dist, "404.html"), notFoundShell(shell));
writeFileSync(join(dist, ".nojekyll"), "");
console.log(`[postbuild] wrote ${routes.length} route shells, dist/404.html and dist/.nojekyll`);
