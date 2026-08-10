/**
 * Assemble the self-contained app directory electron-builder packs (stage/app).
 *
 * `pnpm deploy --prod` materializes this package plus its production dependency tree —
 * including the workspace packages (@prismshadow/penguin-cli among them, so the staged
 * node_modules carries cli + server + core + skills) — into a portable directory whose
 * symlinks all stay inside it (verified: the server boots from the deploy dir as-is).
 * On top of that:
 * - prune dev files (sources, configs) so only dist/, node_modules/ and package.json ship;
 * - copy the web build to `node_modules/@prismshadow/penguin-server/web-dist`, the npm
 *   package layout the server's static-hosting lookup checks first;
 * - copy build/icon.png into the app dir (the runtime window icon, see src/app-icon.ts);
 * - generate the `penguin` CLI launchers into `bin/` (POSIX + Windows, see
 *   src/launcher.ts): they run the bundled CLI on the app's Electron runtime as Node;
 * - ensure `stage/minigit` exists (may be empty): the Windows CI job downloads MinGit
 *   into it, and electron-builder's win extraResources entry must always have a source.
 *
 * Run from anywhere (after `pnpm -r build`); all paths derive from this file's location.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
// Windows: pnpm is pnpm.cmd, which Node only spawns through a shell (and .cmd spawning
// without one is blocked since the CVE-2024-27980 hardening). With a shell, args are
// joined verbatim, so quote them — appDir may contain spaces.
const isWindows = process.platform === "win32";
const deployArgs = ["--filter", "@prismshadow/penguin-desktop", "deploy", "--prod", appDir];
execFileSync(
  isWindows ? "pnpm.cmd" : "pnpm",
  isWindows ? deployArgs.map((a) => `"${a}"`) : deployArgs,
  { cwd: repoRoot, stdio: "inherit", env, shell: isWindows },
);

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

// The shell forks the server by this exact path, and the CLI launchers point at the
// CLI entry: verify both landed in the deploy tree before packing.
const launcherModule = path.join(pkgDir, "dist", "launcher.js");
for (const [what, file] of [
  ["server entry", path.join(serverPkg, "dist", "index.js")],
  [
    "CLI entry",
    path.join(appDir, "node_modules", "@prismshadow", "penguin-cli", "dist", "index.js"),
  ],
  ["launcher generator (dist/launcher.js)", launcherModule],
]) {
  if (!fs.existsSync(file)) {
    console.error(`[stage] missing ${what} (${file}) — run \`pnpm -r build\` first.`);
    process.exit(1);
  }
}

// Runtime window icon: same app-dir-relative location as the dev run (build/icon.png),
// so src/app-icon.ts resolves it identically in both layouts.
const iconSrc = path.join(pkgDir, "build", "icon.png");
if (!fs.existsSync(iconSrc)) {
  console.error("[stage] build/icon.png is missing — run `node scripts/render-icon.mjs`.");
  process.exit(1);
}
fs.mkdirSync(path.join(appDir, "build"), { recursive: true });
fs.copyFileSync(iconSrc, path.join(appDir, "build", "icon.png"));

// CLI launchers (bin/penguin, bin/penguin.cmd): generated, not committed — the script
// text lives in src/launcher.ts so it is unit-tested with the rest of the shell.
const { posixLauncherScript, windowsLauncherScript } = await import(
  pathToFileURL(launcherModule).href
);
const binDir = path.join(appDir, "bin");
fs.mkdirSync(binDir, { recursive: true });
fs.writeFileSync(path.join(binDir, "penguin"), posixLauncherScript(), { mode: 0o755 });
fs.chmodSync(path.join(binDir, "penguin"), 0o755);
fs.writeFileSync(path.join(binDir, "penguin.cmd"), windowsLauncherScript());

fs.mkdirSync(path.join(stageDir, "minigit"), { recursive: true });

console.log("[stage] done:", appDir);
