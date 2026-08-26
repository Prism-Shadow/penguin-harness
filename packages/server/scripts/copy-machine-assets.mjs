/**
 * Copies the files the built package needs as REAL files rather than bundled code.
 *
 * `remote-installer.cjs` is sent to another machine and executed there; this package copies
 * it, never imports it, so tsup has no reason to pull it into a bundle and it would not
 * survive as one anyway. `files: ["dist"]` is what npm ships, so it lands under dist/ at the
 * same relative path a pushed bundle's assets use (see machines/installer-script.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.join(pkgDir, "src", "machines", "remote-installer.cjs");
const to = path.join(pkgDir, "dist", "machines", "remote-installer.cjs");

fs.mkdirSync(path.dirname(to), { recursive: true });
fs.copyFileSync(from, to);
