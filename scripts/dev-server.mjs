#!/usr/bin/env node
/**
 * Runs the dev server entry under `tsx watch` on every platform.
 *
 * WorkbenchService watches and reloads the data root's plugins itself, so the watcher must
 * leave the data root alone: following those dynamic imports would restart the whole server
 * whenever a Workbench recompiles. tsx/chokidar needs absolute exclusions for dependencies
 * outside its working directory. Node's built-in `--watch` follows every imported module and
 * has no way to exclude one, so it cannot stand in for `tsx watch` here.
 *
 * tsx watch also reads stdin for its Return-key rerun. When that stdin is a pipe the server
 * inherits as well, the server's boot stalls on Windows while it loads `node:process` and it
 * never binds its port (https://github.com/privatenumber/tsx/issues/623). `pnpm dev` runs this
 * under concurrently, which hands every command a pipe, so stdin is passed through only from a
 * terminal, the one place the rerun key can be typed.
 */
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { isatty } from "node:tty";
import { fileURLToPath } from "node:url";
import { resolveRoot } from "@prismshadow/penguin-core";

/**
 * The Node CLI arguments that launch the dev server entry in watch mode, excluding each data
 * root (given in both its resolved and its real form).
 */
export function devServerArgs(
  entryArgs,
  roots,
  resolve = (specifier) => import.meta.resolve(specifier),
) {
  return [
    fileURLToPath(resolve("tsx/cli")),
    "watch",
    ...[...roots].flatMap((dir) => ["--exclude", `${dir.replaceAll("\\", "/")}/**`]),
    ...entryArgs,
  ];
}

/**
 * Whether this file is the process entry rather than a module a test imported. Node resolves
 * the entry's symlinks for `import.meta.url` but not for `argv[1]`, so `argv[1]` is compared as
 * a real path; otherwise a checkout reached through a symlink or junction would start nothing.
 */
function isEntryPoint() {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  const root = path.resolve(resolveRoot());
  await mkdir(root, { recursive: true });
  const roots = new Set([root, await realpath(root)]);
  const child = spawn(process.execPath, devServerArgs(process.argv.slice(2), roots), {
    stdio: [isatty(0) ? "inherit" : "ignore", "inherit", "inherit"],
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("error", (error) => {
    console.error(`dev-server: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
