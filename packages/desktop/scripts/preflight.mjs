/**
 * Preflight for `pnpm --dir packages/desktop start` (and the root `pnpm desktop`) and for
 * every `pack*` script: verify everything a source run needs, and fail with the actual fix
 * instead of a bare ENOENT from the utilityProcess fork or an empty plugin library. A source
 * run loads the same bundles a packaged app does, so all of them have to exist first — and
 * a pack needs the same set, because electron-builder copies what exists and says nothing
 * about a `from:` source that does not (the web build above all).
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(pkgDir, "package.json"));
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));

const problems = [];

for (const [what, rel] of [
  ["the desktop shell build", "dist/main.js"],
  ["the embedded server bundle", "dist/server.js"],
  // Where the server bundle's `require("node-pty")` lands; without it every terminal
  // session fails to spawn, and only once the user opens a terminal panel.
  ["the staged node-pty package", "dist/node_modules/node-pty/package.json"],
  // The plugin packages are this package's dependencies, linked by `pnpm install`; the
  // bundled server's loader resolves them from here and refuses to start with a declared
  // one missing. Every declared package is checked, so one added to `dependencies` without
  // a `pnpm install` fails here rather than at the first library read.
  ...Object.keys(pkg.dependencies)
    .filter((dep) => dep.startsWith("@penguinharness/"))
    .map((dep) => [`the plugin package ${dep}`, `node_modules/${dep}/plugin.json`]),
  ["the web frontend build", "../web/dist/index.html"],
]) {
  if (!fs.existsSync(path.join(pkgDir, rel))) {
    problems.push(
      `Missing ${what} (${rel}). Run \`pnpm install\` and \`pnpm -r build\` at the repo root.`,
    );
  }
}

// `require("electron")` resolves to the platform binary path; the package exists even
// when its postinstall (the binary download) was skipped by the package manager.
try {
  const electronBinary = require("electron");
  if (typeof electronBinary !== "string" || !fs.existsSync(electronBinary)) {
    throw new Error("binary missing");
  }
} catch {
  problems.push(
    "The Electron binary is missing. Run `node node_modules/electron/install.js` in packages/desktop (its postinstall was skipped; pnpm allows it via the workspace allowBuilds entry).",
  );
}

if (problems.length > 0) {
  console.error("penguin-desktop preflight failed:\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error("");
  process.exit(1);
}
