#!/usr/bin/env node
/**
 * WorkbenchService watches and reloads the data root's plugins itself. Letting tsx
 * watch their dynamic imports also restarts the whole server during compilation.
 * tsx/chokidar needs absolute exclusions for dependencies outside its working directory.
 */
import { spawn } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRoot } from "@prismshadow/penguin-core";

const root = path.resolve(resolveRoot());
await mkdir(root, { recursive: true });
const roots = new Set([root, await realpath(root)]);
const child = spawn(
  process.execPath,
  [
    fileURLToPath(import.meta.resolve("tsx/cli")),
    "watch",
    ...[...roots].flatMap((dir) => ["--exclude", `${dir.replaceAll("\\", "/")}/**`]),
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);
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
