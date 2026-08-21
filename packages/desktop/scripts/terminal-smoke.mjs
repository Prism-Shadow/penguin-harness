/**
 * Terminal smoke test on the runtime that actually runs it: the desktop shell executes
 * the server as an Electron utilityProcess, so node-pty's native binding — and, on macOS,
 * its `spawn-helper` side binary — must work under Electron's Node, not the Node that
 * compiled the tree. ELECTRON_RUN_AS_NODE is that same runtime, so this loads node-pty
 * exactly as the server bundle does — a bare `require("node-pty")` anchored at
 * dist/server.js, which reaches the copy scripts/build-assets.mjs stages into
 * dist/node_modules — then spawns a real shell and waits for one byte of output.
 *
 * A platform where the pty cannot be resolved, loaded or spawned fails here with the real
 * error, instead of shipping a desktop app whose terminal panel silently stays empty (the
 * macOS bug this guards against). Run after `pnpm build` (CI's ci-macos job); the staged
 * copy is a build output, so an unbuilt tree fails with that, not with a pty error.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverBundle = path.join(pkgDir, "dist", "server.js");

if (!fs.existsSync(serverBundle)) {
  console.error(`[terminal-smoke] ${serverBundle} is missing — run \`pnpm -r build\` first.`);
  process.exit(1);
}

const smoke = `
  const { createRequire } = require("node:module");
  const { pathToFileURL } = require("node:url");
  // The server bundle's own line: packages/server/src/platform/terminal/pty-module.ts.
  const pty = createRequire(pathToFileURL(${JSON.stringify(serverBundle)}).href)("node-pty");
  const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
  const term = pty.spawn(shell, [], { name: "xterm-256color", cols: 40, rows: 10, cwd: process.cwd(), env: process.env });
  const timer = setTimeout(() => { console.error("no pty output within 15s"); process.exit(1); }, 15000);
  term.onData(() => { clearTimeout(timer); term.kill(); console.log("[terminal-smoke] node-pty spawn OK (Electron Node " + process.versions.node + ", ABI " + process.versions.modules + ")"); process.exit(0); });
  term.write("echo ready\\r");
`;

const isWindows = process.platform === "win32";
const electronBin = path.join(
  pkgDir,
  "node_modules",
  ".bin",
  isWindows ? "electron.cmd" : "electron",
);
execFileSync(electronBin, ["-e", smoke], {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  shell: isWindows,
});
