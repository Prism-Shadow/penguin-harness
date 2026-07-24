/**
 * Build the whole public site as one deployable tree: the landing page at the root
 * and the docs site under docs/. Used by the Pages workflow and for local preview:
 *
 *   BASE_PATH=/<repo>/ pnpm build:site     # CI (GitHub Pages project subpath)
 *   pnpm build:site                        # local (base "/")
 *   pnpm --filter @prismshadow/penguin-landing preview   # serve the assembled tree
 *
 * Each package builds with its own BASE_PATH (landing: <base>, docs: <base>docs/),
 * then the docs dist is copied into the landing dist under docs/. The result is a
 * single artifact — one GitHub Pages deployment hosts both sites.
 */
import { execSync } from "node:child_process";
import { cpSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { absoluteUrl, blogRoutes, docsRoutes } from "../packages/landing/scripts/site-routes.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.BASE_PATH ?? "/";
if (!base.startsWith("/") || !base.endsWith("/")) {
  console.error(`BASE_PATH must start and end with "/", got "${base}"`);
  process.exit(1);
}

const run = (cmd, BASE_PATH) => {
  console.log(`\n[build-site] ${cmd} (BASE_PATH=${BASE_PATH})`);
  execSync(cmd, { cwd: root, stdio: "inherit", env: { ...process.env, BASE_PATH } });
};

run("pnpm --filter @prismshadow/penguin-landing build", base);
run("pnpm --filter @prismshadow/penguin-docs build", `${base}docs/`);

const landingDist = join(root, "packages", "landing", "dist");
const docsTarget = join(landingDist, "docs");
rmSync(docsTarget, { recursive: true, force: true });
cpSync(join(root, "packages", "docs", "dist"), docsTarget, { recursive: true });

// sitemap.xml goes in last, because only here do both dists exist: it is the one file
// that has to name routes from both sites. It is also the only way a crawler learns
// those routes — both pages ship an empty <div id="root"> and build their navigation
// in JS, so following links is not an option.
const routes = [{ route: "/" }, ...blogRoutes(), ...docsRoutes()];
const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...routes.map(({ route, lastmod }) =>
    [
      "  <url>",
      `    <loc>${absoluteUrl(route)}</loc>`,
      ...(lastmod === undefined ? [] : [`    <lastmod>${lastmod}</lastmod>`]),
      "  </url>",
    ].join("\n"),
  ),
  "</urlset>",
  "",
].join("\n");
writeFileSync(join(landingDist, "sitemap.xml"), sitemap);

console.log(`\n[build-site] assembled site at ${landingDist} (docs under /docs/)`);
console.log(`[build-site] wrote sitemap.xml (${routes.length} URLs)`);
