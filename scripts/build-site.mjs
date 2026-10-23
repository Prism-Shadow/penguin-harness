/**
 * Build the whole public site as one deployable tree: the landing page at the root, the docs
 * site under docs/ and the component gallery under gallery/. Used by the Pages workflow and for
 * local preview:
 *
 *   BASE_PATH=/<repo>/ pnpm build:site     # CI (GitHub Pages project subpath)
 *   pnpm build:site                        # local (base "/")
 *   pnpm --filter @prismshadow/penguin-landing preview   # serve the assembled tree
 *
 * Each package builds with its own BASE_PATH (landing: <base>, docs: <base>docs/, gallery:
 * <base>gallery/), then the docs and gallery dists are copied into the landing dist under docs/
 * and gallery/. The result is a single artifact — one GitHub Pages deployment hosts all three.
 *
 * The gallery compiles the Web App's source, which imports core and amsp from their built dist
 * and the model catalog from the server's (`server/dist/model-catalog.js`; the UI package is
 * source-only), so those build first. The server's build inlines hmr, so hmr builds before it,
 * and JavaScript only: nothing here reads the server's declarations (PENGUIN_BUILD_JS_ONLY, see
 * packages/server/tsup.config.ts).
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  absoluteUrl,
  blogRoutes,
  docsRoutes,
  galleryRoutes,
  pageRoutes,
} from "../packages/landing/scripts/site-routes.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.BASE_PATH ?? "/";
if (!base.startsWith("/") || !base.endsWith("/")) {
  console.error(`BASE_PATH must start and end with "/", got "${base}"`);
  process.exit(1);
}

const run = (cmd, BASE_PATH, extra = {}) => {
  const vars = { ...(BASE_PATH === undefined ? {} : { BASE_PATH }), ...extra };
  const note = Object.entries(vars).map(([k, v]) => `${k}=${v}`);
  console.log(`\n[build-site] ${cmd}${note.length > 0 ? ` (${note.join(" ")})` : ""}`);
  execSync(cmd, { cwd: root, stdio: "inherit", env: { ...process.env, ...vars } });
};

run("pnpm --filter @prismshadow/penguin-landing build", base);
run("pnpm --filter @prismshadow/penguin-docs build", `${base}docs/`);
run("pnpm --filter @prismshadow/penguin-core --filter @prismshadow/amsp build");
run(
  "pnpm --filter @prismshadow/penguin-hmr --filter @prismshadow/penguin-server build",
  undefined,
  {
    PENGUIN_BUILD_JS_ONLY: "1",
  },
);
run("pnpm --filter @prismshadow/penguin-ui-gallery build", `${base}gallery/`);

const pkgDir = (pkg) => join(root, "packages", pkg);
/** Every file under `dir`, as absolute paths; none when there is no such directory. */
const filesIn = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name))
    : [];

/** A URL that names no file of the site: another origin, a data: URL, a fragment, nothing. */
const ELSEWHERE = /^(?:$|[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/**
 * The asset URLs in a site's build that do not resolve inside its own base. A document must name
 * its assets by root-absolute URLs under the base: a relative one breaks in the copies of the
 * document written for deeper routes (blog posts, doc pages, gallery pages), and one outside the
 * base reaches into another site's tree. Read: src/href in HTML; url() in CSS, where a relative
 * URL is fine, as it resolves against the stylesheet; and, in scripts, a string naming one of the
 * site's public files by its root-absolute path (`"/penguin-logo.svg"`), which no bundler rebases.
 */
function straysIn(pkg, siteBase) {
  const dist = join(pkgDir(pkg), "dist");
  const publicDir = join(pkgDir(pkg), "public");
  const publicPaths = filesIn(publicDir).map(
    (file) => `/${relative(publicDir, file).split(sep).join("/")}`,
  );
  const strays = [];
  for (const file of filesIn(dist)) {
    const kind = /\.(html|css|js)$/.exec(file)?.[1];
    if (kind === undefined || (kind === "js" && siteBase === "/")) continue;
    const text = readFileSync(file, "utf8");
    const stray = (url) => strays.push(`packages/${pkg}/dist/${relative(dist, file)}: ${url}`);
    if (kind === "html") {
      for (const [, url] of text.matchAll(/\s(?:src|href)="([^"]*)"/g)) {
        if (!ELSEWHERE.test(url) && !url.startsWith(siteBase)) stray(url);
      }
    } else if (kind === "css") {
      for (const [, url] of text.matchAll(/url\(\s*["']?([^"')\s]+)/g)) {
        if (url.startsWith("/") && !url.startsWith("//") && !url.startsWith(siteBase)) stray(url);
      }
    } else {
      for (const path of publicPaths) {
        if (['"', "'", "`"].some((quote) => text.includes(`${quote}${path}${quote}`))) stray(path);
      }
    }
  }
  return strays;
}

const strays = [
  ...straysIn("landing", base),
  ...straysIn("docs", `${base}docs/`),
  ...straysIn("ui-gallery", `${base}gallery/`),
];
if (strays.length > 0) {
  console.error("\n[build-site] asset URLs outside their site's base:");
  for (const line of strays) console.error(`  ${line}`);
  process.exit(1);
}

const landingDist = join(pkgDir("landing"), "dist");
for (const [pkg, dir] of [
  ["docs", "docs"],
  ["ui-gallery", "gallery"],
]) {
  const target = join(landingDist, dir);
  rmSync(target, { recursive: true, force: true });
  cpSync(join(pkgDir(pkg), "dist"), target, { recursive: true });
}

// sitemap.xml goes in last, because only here do all three dists exist: it is the one file
// that has to name routes from every site. It is also the only way a crawler learns those
// routes — the pages ship an empty <div id="root"> and build their navigation in JS, so
// following links is not an option.
const routes = [
  { route: "/" },
  ...pageRoutes(),
  ...blogRoutes(),
  ...docsRoutes(),
  ...galleryRoutes(),
];
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

console.log(
  `\n[build-site] assembled site at ${landingDist} (docs under /docs/, gallery under /gallery/)`,
);
console.log(`[build-site] wrote sitemap.xml (${routes.length} URLs)`);
