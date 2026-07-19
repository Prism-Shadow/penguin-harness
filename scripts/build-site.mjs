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
import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
console.log(`\n[build-site] assembled site at ${landingDist} (docs under /docs/)`);
