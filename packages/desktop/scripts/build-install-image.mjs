/**
 * The install image: this machine's build, in the shape install.sh unpacks.
 *
 * `install-image/penguin/{bin,lib,web}` plus a package manifest, so a machine that has
 * PenguinHarness can hand its own build to a machine that has none — step 0 of installing a
 * server onto an SSH target. With the image produced at build time, the push path has one
 * layout to deal with instead of branching on how this machine happens to be installed.
 *
 * Independent of electron-builder and of `build-assets.mjs`: those produce the DESKTOP
 * package's own tree, where the shell and the CLI ship together and the launchers run on
 * Electron. This tree is the CLI's own `pnpm deploy --prod` at `lib/`, with launchers that
 * run on plain Node — the far side has no Electron. Deriving one from the other by hand is
 * what re-deploying avoids.
 *
 * The layout and both launchers come from packages/server/src/machines/launcher.cjs, which
 * the release packages and the remote installer also use. Shaped like the universal release
 * package: no `node/`, so the far side needs system Node >= 24. The launchers still prefer a
 * bundled runtime if a tree ever carries one.
 *
 * Run from anywhere, after `pnpm -r build`; all paths derive from this file's location.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgDir, "..", "..");
const imageRoot = path.join(pkgDir, "install-image");
const payloadDir = path.join(imageRoot, "penguin");
const payloadLib = path.join(payloadDir, "lib");

const webDist = path.join(repoRoot, "packages", "web", "dist");
if (!fs.existsSync(path.join(webDist, "index.html"))) {
  console.error("[install-image] packages/web/dist is missing — run `pnpm -r build` first.");
  process.exit(1);
}

fs.rmSync(imageRoot, { recursive: true, force: true });
fs.mkdirSync(payloadDir, { recursive: true });

// Scrub inherited npm_config_* vars: when this script runs under `pnpm run`, they leak into
// the child pnpm and derail its argument parsing.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.toLowerCase().startsWith("npm_config_")),
);
// Windows: pnpm is pnpm.cmd, which Node only spawns through a shell (and .cmd spawning
// without one is blocked since the CVE-2024-27980 hardening). With a shell, arguments need
// their own quoting.
const isWindows = process.platform === "win32";

console.log("[install-image] pnpm deploy --prod → install-image/penguin/lib");
const deployArgs = [
  "--config.node-linker=hoisted",
  "--filter",
  "@prismshadow/penguin-cli",
  "deploy",
  "--prod",
  payloadLib,
];
execFileSync(
  isWindows ? "pnpm.cmd" : "pnpm",
  isWindows ? deployArgs.map((a) => `"${a}"`) : deployArgs,
  { cwd: repoRoot, stdio: "inherit", env, shell: isWindows },
);

fs.cpSync(webDist, path.join(payloadDir, "web"), { recursive: true, dereference: true });

const { posixLauncher, windowsLauncher } = await import(
  pathToFileURL(path.join(repoRoot, "packages", "server", "src", "machines", "launcher.cjs")).href
);
const payloadBin = path.join(payloadDir, "bin");
fs.mkdirSync(payloadBin, { recursive: true });
fs.writeFileSync(path.join(payloadBin, "penguin"), posixLauncher(), { mode: 0o755 });
// Explicit chmod: the mode option only applies when writeFileSync creates the file.
fs.chmodSync(path.join(payloadBin, "penguin"), 0o755);
fs.writeFileSync(path.join(payloadBin, "penguin.cmd"), windowsLauncher());

// The manifest install.sh checks against the target it expects; "universal" is the shape
// with no bundled runtime.
fs.writeFileSync(
  path.join(payloadDir, "package-manifest.json"),
  '{"schemaVersion":1,"target":"universal"}\n',
);

// Fail here rather than shipping an image whose entry or assets are missing.
for (const [what, file] of [
  ["CLI entry", path.join(payloadLib, "dist", "penguin.js")],
  ["web assets", path.join(payloadDir, "web", "index.html")],
]) {
  if (!fs.existsSync(file)) {
    console.error(`[install-image] missing ${what} (${file}).`);
    process.exit(1);
  }
}

console.log("[install-image] done:", payloadDir);
