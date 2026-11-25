#!/usr/bin/env node
/**
 * WorkbenchService watches and reloads the data root's plugins itself. Letting tsx
 * watch their dynamic imports also restarts the whole server during compilation.
 * tsx/chokidar needs absolute exclusions for dependencies outside its working directory.
 *
 * On Windows, `tsx watch`'s Chokidar launcher and IPC dependency pipe stall while walking
 * the symlinked workspace graph before the server ever binds its port (#1834), so Windows
 * runs the entry under Node's built-in `--watch` with `tsx`'s ESM loader instead.
 */
import { spawn } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRoot } from "@prismshadow/penguin-core";

/**
 * The Node CLI arguments that launch the dev server entry in watch mode.
 */
export function devServerArgs(
  entryArgs,
  roots,
  platform = process.platform,
  resolve = (specifier) => import.meta.resolve(specifier),
) {
  if (platform === "win32") {
    return ["--watch", "--import", resolve("tsx"), ...entryArgs];
  }
  return [
    fileURLToPath(resolve("tsx/cli")),
    "watch",
    ...[...roots].flatMap((dir) => ["--exclude", `${dir.replaceAll("\\", "/")}/**`]),
    ...entryArgs,
  ];
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = path.resolve(resolveRoot());
  await mkdir(root, { recursive: true });
  const roots = new Set([root, await realpath(root)]);
  const child = spawn(process.execPath, devServerArgs(process.argv.slice(2), roots), {
    stdio: "inherit",
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
