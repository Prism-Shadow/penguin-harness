/**
 * Build outputs that are not JavaScript, written next to the tsup bundles by `pnpm build`.
 *
 * What goes into an installer is decided declaratively in electron-builder.yml; this script
 * only produces this package's own artifacts, in the one layout that serves both a source run
 * and a packaged app:
 *
 * - `official/` — the shipped plugin library. @prismshadow/penguin-plugins reads its plugin
 *   directories from `<its package root>/official`, and bundling puts the reader in `dist/`,
 *   so the copy lands where that same package-relative lookup finds it. (The server's web-dist
 *   lookup works the same way and is satisfied by electron-builder's file mapping when
 *   packaging; a source run falls back to packages/web/dist on its own.)
 * - `dist/node_modules/node-pty` — the one dependency the bundler cannot absorb, because the
 *   server loads it as a native module through a runtime `require` and node-pty's own loader
 *   then resolves its binary package-relative. See src/pty-payload.ts.
 * - `dist/icon.png` — the runtime window icon, read app-path-relative (see src/app-icon.ts).
 *   build/ is electron-builder's buildResources directory and does not ship inside the app.
 * - `bin/penguin`, `bin/penguin.cmd` — the CLI launchers, whose script text lives in
 *   src/launcher.ts so it is unit-tested with the rest of the shell.
 * - `dist/install.sh`, `dist/install.ps1` — the release installers, which the Machines page
 *   scp's to an SSH host and runs there (packages/server/src/machines/install-server.ts
 *   resolves them beside its own module). The server package ships them in its own dist/,
 *   but this app re-bundles the server into a single dist/server.js and a bundle carries no
 *   sibling files, so they are copied in again here. Only the ~4 KB scripts travel: the far
 *   side downloads the release itself.
 *
 * Run from anywhere (after tsup); all paths derive from this file's location.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(pkgDir, "dist");

const launcherModule = path.join(distDir, "launcher.js");
for (const required of [launcherModule, path.join(distDir, "pty-payload.js")]) {
  if (!fs.existsSync(required)) {
    console.error(
      `[build-assets] dist/${path.basename(required)} is missing — run \`tsup\` first.`,
    );
    process.exit(1);
  }
}

const pluginsSrc = path.resolve(pkgDir, "..", "plugins", "official");
const pluginsDest = path.join(pkgDir, "official");
fs.rmSync(pluginsDest, { recursive: true, force: true });
fs.cpSync(pluginsSrc, pluginsDest, { recursive: true });

const repoRoot = path.resolve(pkgDir, "..", "..");
for (const name of ["install.sh", "install.ps1"]) {
  const src = path.join(repoRoot, name);
  if (!fs.existsSync(src)) {
    console.error(`[build-assets] ${name} is missing from the repository root.`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(distDir, name));
}

const iconSrc = path.join(pkgDir, "build", "icon.png");
if (!fs.existsSync(iconSrc)) {
  console.error("[build-assets] build/icon.png is missing — run `node scripts/render-icon.mjs`.");
  process.exit(1);
}
fs.copyFileSync(iconSrc, path.join(distDir, "icon.png"));

// node-pty, resolved from the package that depends on it: under pnpm it is installed into
// packages/server/node_modules, out of reach of any lookup anchored in this package.
const serverRequire = createRequire(path.resolve(pkgDir, "..", "server", "package.json"));
let ptySrc;
try {
  ptySrc = path.dirname(serverRequire.resolve("node-pty/package.json"));
} catch {
  console.error("[build-assets] node-pty is not installed — run `pnpm install` at the repo root.");
  process.exit(1);
}
const { stageNodePty, nativeBindings, hostBinding, NODE_PTY_RELDIR } = await import(
  pathToFileURL(path.join(distDir, "pty-payload.js")).href
);
const ptyFiles = stageNodePty(ptySrc, path.join(pkgDir, ...NODE_PTY_RELDIR));
const bindings = nativeBindings(ptyFiles);
// A pty.node for some other platform is not a payload: node-pty prebuilds darwin and win32,
// so a Linux install whose node-gyp step was skipped still stages three of them.
if (hostBinding(ptyFiles) === undefined) {
  const carried = bindings.length === 0 ? "none at all" : `only ${bindings.join(", ")}`;
  console.error(
    `[build-assets] the node-pty install at ${ptySrc} has no pty.node for ${process.platform}-${process.arch} (${carried}) — reinstall it so its build script runs (pnpm-workspace.yaml allows it).`,
  );
  process.exit(1);
}

const { posixLauncherScript, windowsLauncherScript } = await import(
  pathToFileURL(launcherModule).href
);
const binDir = path.join(pkgDir, "bin");
fs.mkdirSync(binDir, { recursive: true });
fs.writeFileSync(path.join(binDir, "penguin"), posixLauncherScript(), { mode: 0o755 });
// Explicit chmod: the mode option only applies when writeFileSync creates the file.
fs.chmodSync(path.join(binDir, "penguin"), 0o755);
fs.writeFileSync(path.join(binDir, "penguin.cmd"), windowsLauncherScript());

console.log(
  `[build-assets] done: official/, dist/icon.png, dist/install.{sh,ps1}, bin/, ${NODE_PTY_RELDIR.join("/")} (${ptyFiles.length} files, bindings: ${bindings.join(", ")})`,
);
