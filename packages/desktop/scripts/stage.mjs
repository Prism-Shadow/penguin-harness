/**
 * Assemble the self-contained app directory electron-builder packs (stage/app).
 *
 * `pnpm deploy --prod` materializes this package plus its production dependency tree —
 * including the workspace packages — into a portable directory whose symlinks all stay
 * inside it (verified: the server boots from the deploy dir as-is). On top of that:
 * - prune dev files (sources, configs) so only dist/, node_modules/ and package.json ship;
 * - copy the web build to `node_modules/@prismshadow/penguin-server/web-dist`, the npm
 *   package layout the server's static-hosting lookup checks first;
 * - ensure `stage/minigit` exists (may be empty): the Windows CI job downloads MinGit
 *   into it, and electron-builder's win extraResources entry must always have a source.
 *
 * Run from anywhere; all paths are derived from this file's location.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgDir, "..", "..");
const stageDir = path.join(pkgDir, "stage");
const appDir = path.join(stageDir, "app");

fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });

console.log("[stage] pnpm deploy --prod → stage/app");
// Scrub inherited npm_config_* vars: when this script runs under `pnpm run`, they leak
// into the child pnpm and derail its argument parsing.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.toLowerCase().startsWith("npm_config_")),
);
execFileSync("pnpm", ["--filter", "@prismshadow/penguin-desktop", "deploy", "--prod", appDir], {
  cwd: repoRoot,
  stdio: "inherit",
  env,
});

// Keep only what the packaged app runs.
const keep = new Set(["dist", "node_modules", "package.json"]);
for (const entry of fs.readdirSync(appDir)) {
  if (!keep.has(entry)) fs.rmSync(path.join(appDir, entry), { recursive: true, force: true });
}

// Strip scripts and devDependencies from the staged package.json but KEEP the
// dependencies pnpm deploy wrote: electron-builder's node-module collector walks them
// to decide what ships — with no dependencies it falls back to scanning the PROJECT
// directory's node_modules (the injected copies, which lack web-dist) and rebuilds the
// wrong tree.
const stagedPkgPath = path.join(appDir, "package.json");
const stagedPkg = JSON.parse(fs.readFileSync(stagedPkgPath, "utf8"));
delete stagedPkg.scripts;
delete stagedPkg.devDependencies;
stagedPkg.private = true;
// Unscoped name: deb/AppImage internals derive package and executable names from it,
// and "@prismshadow/…" is invalid there. The app-root name plays no role in module
// resolution, so the packaged name can differ from the workspace package name.
stagedPkg.name = "penguin-harness-desktop";
// fpm (deb) refuses to build without a homepage.
stagedPkg.homepage = "https://github.com/Prism-Shadow/penguin-harness";
fs.writeFileSync(stagedPkgPath, JSON.stringify(stagedPkg, null, 2) + "\n");

const webDist = path.join(repoRoot, "packages", "web", "dist");
if (!fs.existsSync(path.join(webDist, "index.html"))) {
  console.error("[stage] packages/web/dist is missing — run `pnpm -r build` first.");
  process.exit(1);
}
// The @prismshadow/penguin-server entry is a symlink into .pnpm; copying THROUGH it
// lands the files in the real package dir, which is exactly where the server looks.
const serverPkg = path.join(appDir, "node_modules", "@prismshadow", "penguin-server");
fs.cpSync(webDist, path.join(serverPkg, "web-dist"), { recursive: true, dereference: true });

fs.mkdirSync(path.join(stageDir, "minigit"), { recursive: true });

console.log("[stage] done:", appDir);
