/**
 * Dev preflight for `pnpm --dir packages/desktop start` (and the root `pnpm desktop`):
 * verify everything a source run needs, and fail with the actual fix instead of a bare
 * ERR_MODULE_NOT_FOUND. The classic trap: this package's node_modules holds pnpm
 * *injected copies* of the workspace packages, which only sync while building THROUGH
 * pnpm — a stale copy surfaces as `Cannot find module …/penguin-server/dist/lock.js`.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(pkgDir, "package.json"));

const problems = [];

for (const [what, rel] of [
  ["the desktop shell build", "dist/main.js"],
  ["the injected server copy", "node_modules/@prismshadow/penguin-server/dist/lock.js"],
  ["the web frontend build", "../web/dist/index.html"],
]) {
  if (!fs.existsSync(path.join(pkgDir, rel))) {
    problems.push(
      `Missing ${what} (${rel}). Run \`pnpm -r build\` at the repo root — builds through pnpm also sync the injected workspace copies under node_modules.`,
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
