#!/usr/bin/env node
/**
 * `pnpm link:cli` (run by `pnpm build`): links this directory's package globally, so pnpm puts
 * its `penguin` and `penguin-hmr` on PATH with its own shims (see launch.mjs). It never fails
 * the build.
 *
 * First it removes links of packages/cli itself that an earlier `link:cli` left on PATH: they run
 * the CLI without the dev environment, and pnpm 11 does not replace them, because pnpm 10 kept
 * global bins in PNPM_HOME rather than PNPM_HOME/bin. Only a symlink or pnpm shim that leads into
 * this checkout's packages/cli/dist is removed.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const real = (p) => (fs.existsSync(p) ? fs.realpathSync(p) : path.resolve(p));
const dist = real(path.join(here, "..", "..", "packages", "cli", "dist"));
const intoDist = (target) => path.dirname(real(target)) === dist;

function isOldLink(file) {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) return intoDist(file);
    if (!stat.isFile() || stat.size > 65536) return false;
    // A pnpm shim (sh, .cmd or .ps1) names its target relative to its own directory.
    const targets = fs
      .readFileSync(file, "utf8")
      .matchAll(/(?:\$basedir|%~?dp0%?)[\\/]([^"]+?\.js)"/g);
    return [...targets].some((m) => intoDist(path.resolve(path.dirname(file), m[1])));
  } catch {
    return false;
  }
}

for (const dir of new Set((process.env.PATH ?? "").split(path.delimiter).filter(Boolean))) {
  for (const name of ["penguin", "penguin-hmr"].flatMap((n) => [n, `${n}.cmd`, `${n}.ps1`])) {
    const file = path.join(dir, name);
    if (!isOldLink(file)) continue;
    fs.rmSync(file);
    console.error(`[link:cli] removed ${file}, an earlier link that ran without the dev env`);
  }
}

// The pnpm running this script (npm_execpath), started without a shell.
const pnpm = process.env.npm_execpath ?? "pnpm";
const args = ["add", "--global", here];
const added = /\.[cm]?js$/.test(pnpm)
  ? spawnSync(process.execPath, [pnpm, ...args], { stdio: "inherit" })
  : spawnSync(pnpm, args, { stdio: "inherit" });
if (added.status !== 0) {
  console.error("[link:cli] skipped the global penguin link (a first link needs `pnpm setup`).");
}
