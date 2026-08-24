/**
 * Regenerates packages/server/src/machines/installer-script.ts from the real
 * remote-installer.cjs beside it.
 *
 * The installer has to reach a remote machine from a server that may itself be a hot-pushed
 * bundle living in the hmr store, where no sibling files resolve — so it travels as TEXT
 * inside the bundle rather than as a file read at runtime. Keeping the .cjs as the source of
 * truth (lintable, prettier-formatted, diffable) and generating the string is what stops the
 * two from drifting; machines-installer.test.ts fails the build when they do.
 *
 * Run: node scripts/gen-installer-script.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "..", "packages", "server", "src", "machines");
const source = fs.readFileSync(path.join(dir, "remote-installer.cjs"), "utf8");

const header = `/**
 * The installer that runs ON the remote machine, as text.
 *
 * GENERATED from ./remote-installer.cjs — edit that file, then run
 * \`node scripts/gen-installer-script.mjs\`. (Prettier-ignored; machines-installer.test.ts
 * asserts the two are in step.)
 *
 * It is embedded rather than read from disk because the server that pushes it may be a
 * hot-pushed bundle in the hmr store, where no sibling file resolves, and because a tarball
 * install has no desktop resources directory either. See ./remote-installer.cjs for what it
 * does on the far side.
 */
`;

fs.writeFileSync(
  path.join(dir, "installer-script.ts"),
  `${header}export const REMOTE_INSTALLER_SCRIPT: string = ${JSON.stringify(source)};\n`,
);
process.stdout.write("packages/server/src/machines/installer-script.ts regenerated\n");
