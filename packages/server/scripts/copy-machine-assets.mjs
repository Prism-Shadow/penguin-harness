/**
 * Copies the files the built package needs as REAL files rather than bundled code.
 *
 * `remote-installer.cjs` is sent to another machine and executed there, and it requires
 * `launcher.cjs` beside it; this package copies them, never imports them, so tsup has no
 * reason to pull them into a bundle and they would not survive as one anyway. `files: ["dist"]`
 * is what npm ships, so they land under dist/ at the same relative path a pushed bundle's
 * assets use (see machines/install-server.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
fs.mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
for (const name of ["remote-installer.cjs", "launcher.cjs"]) {
  fs.copyFileSync(path.join(pkgDir, "src", "machines", name), path.join(pkgDir, "dist", name));
}
