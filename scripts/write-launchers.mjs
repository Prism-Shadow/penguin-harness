/**
 * Writes a payload tree's `bin/` launchers, for the release workflow.
 *
 *   node scripts/write-launchers.mjs <payload-dir> posix|windows
 *
 * The scripts themselves come from packages/server/src/machines/launcher.cjs — the one place
 * the payload layout is spelled — so a release package, an install image and a pushed install
 * cannot drift apart about where `web/` and `node/` sit.
 *
 * The two forms are exclusive, not additive: a POSIX package has no use for penguin.cmd, and
 * the Windows package ships the .cmd alone (a bare `penguin` shell script on PATH would be
 * picked up by Git Bash and run the wrong thing).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const [payloadDir, form] = process.argv.slice(2);
if (!payloadDir || (form !== "posix" && form !== "windows")) {
  console.error("usage: node scripts/write-launchers.mjs <payload-dir> posix|windows");
  process.exit(2);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { posixLauncher, windowsLauncher } = require(
  path.join(repoRoot, "packages", "server", "src", "machines", "launcher.cjs"),
);

const binDir = path.join(payloadDir, "bin");
fs.mkdirSync(binDir, { recursive: true });
if (form === "posix") {
  fs.rmSync(path.join(binDir, "penguin.cmd"), { force: true });
  fs.writeFileSync(path.join(binDir, "penguin"), posixLauncher(), { mode: 0o755 });
  // The mode option only applies when writeFileSync creates the file.
  fs.chmodSync(path.join(binDir, "penguin"), 0o755);
} else {
  fs.rmSync(path.join(binDir, "penguin"), { force: true });
  fs.writeFileSync(path.join(binDir, "penguin.cmd"), windowsLauncher());
}
console.log(`[launchers] ${form} → ${binDir}`);
