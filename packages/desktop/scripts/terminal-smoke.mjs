/**
 * Terminal smoke test on the runtime that actually runs it: the desktop shell executes
 * the server as an Electron utilityProcess, so node-pty's native binding — and, on macOS,
 * its `spawn-helper` side binary — must work under Electron's Node, not the Node that
 * compiled the tree. ELECTRON_RUN_AS_NODE is that same runtime, so this loads node-pty
 * the way the server resolves it, spawns a real shell and waits for one byte of output.
 *
 * A platform where the pty cannot load or spawn fails here with the real error, instead
 * of shipping a desktop app whose terminal panel silently stays empty (the macOS bug
 * this guards against). Run standalone (CI's ci-macos job) after `pnpm install`; it needs
 * no build outputs and does not touch the staging tree.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgDir, "..", "..");

// Resolve node-pty exactly the way the server package does.
const serverRequire = createRequire(path.join(repoRoot, "packages", "server", "package.json"));
const ptyPath = path.dirname(serverRequire.resolve("node-pty/package.json"));

const smoke = `
  const pty = require(${JSON.stringify(ptyPath)});
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
