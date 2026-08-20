/**
 * Build outputs that are not JavaScript, written next to the tsup bundles by `pnpm build`.
 *
 * What goes into an installer is decided declaratively in electron-builder.yml; this script
 * only produces this package's own artifacts, in the one layout that serves both a source run
 * and a packaged app:
 *
 * - `skills/` — the shipped skill library. @prismshadow/penguin-skills reads its SKILL.md
 *   files from `<its package root>/skills`, and bundling puts the reader in `dist/`, so the
 *   copy lands where that same package-relative lookup finds it. (The server's web-dist
 *   lookup works the same way and is satisfied by electron-builder's file mapping when
 *   packaging; a source run falls back to packages/web/dist on its own.)
 * - `dist/icon.png` — the runtime window icon, read app-path-relative (see src/app-icon.ts).
 *   build/ is electron-builder's buildResources directory and does not ship inside the app.
 * - `bin/penguin`, `bin/penguin.cmd` — the CLI launchers, whose script text lives in
 *   src/launcher.ts so it is unit-tested with the rest of the shell.
 *
 * Run from anywhere (after tsup); all paths derive from this file's location.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(pkgDir, "dist");

const launcherModule = path.join(distDir, "launcher.js");
if (!fs.existsSync(launcherModule)) {
  console.error("[build-assets] dist/launcher.js is missing — run `tsup` first.");
  process.exit(1);
}

const skillsSrc = path.resolve(pkgDir, "..", "skills", "skills");
const skillsDest = path.join(pkgDir, "skills");
fs.rmSync(skillsDest, { recursive: true, force: true });
fs.cpSync(skillsSrc, skillsDest, { recursive: true });

const iconSrc = path.join(pkgDir, "build", "icon.png");
if (!fs.existsSync(iconSrc)) {
  console.error("[build-assets] build/icon.png is missing — run `node scripts/render-icon.mjs`.");
  process.exit(1);
}
fs.copyFileSync(iconSrc, path.join(distDir, "icon.png"));

const { posixLauncherScript, windowsLauncherScript } = await import(
  pathToFileURL(launcherModule).href
);
const binDir = path.join(pkgDir, "bin");
fs.mkdirSync(binDir, { recursive: true });
fs.writeFileSync(path.join(binDir, "penguin"), posixLauncherScript(), { mode: 0o755 });
// Explicit chmod: the mode option only applies when writeFileSync creates the file.
fs.chmodSync(path.join(binDir, "penguin"), 0o755);
fs.writeFileSync(path.join(binDir, "penguin.cmd"), windowsLauncherScript());

console.log("[build-assets] done: skills/, dist/icon.png, bin/");
