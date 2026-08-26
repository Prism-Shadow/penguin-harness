/**
 * Copies the files the built package needs as REAL files rather than bundled code.
 *
 * The remote install scp's the ordinary installers (install.sh, install.ps1) to the far side
 * and runs them there; this package copies them, never imports them. `files: ["dist"]` is
 * what npm ships, so they land under dist/ at the same relative path a pushed bundle's
 * assets use (see machines/install-server.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgDir, "..", "..");
fs.mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
for (const name of ["install.sh", "install.ps1"]) {
  fs.copyFileSync(path.join(repoRoot, name), path.join(pkgDir, "dist", name));
}
