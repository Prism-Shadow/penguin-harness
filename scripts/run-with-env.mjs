#!/usr/bin/env node
/**
 * Cross-platform replacement for POSIX env-prefix script lines.
 *
 *   node scripts/run-with-env.mjs VAR=value [VAR2=value2 ...] -- <command> [args...]
 *
 * Each assignment sets VAR **only when it is unset or empty** in the current environment —
 * the JS equivalent of `VAR="${VAR:-value}" cmd`, which cmd.exe cannot parse (package.json
 * scripts run under cmd.exe on Windows). A leading `~/` in the value expands to the user's
 * home directory (the `$HOME/...` defaults). Then the command runs with inherited stdio and
 * its exit code is propagated.
 *
 * On Windows the command is a pnpm-installed shim (tsx.cmd, vitest.cmd), which Node refuses
 * to spawn without a shell since CVE-2024-27980; those runs go through the shell with
 * quoting applied. POSIX keeps a plain shell-less spawn (bit-for-bit today's behavior).
 */
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep === -1 || sep === argv.length - 1) {
  console.error("usage: node scripts/run-with-env.mjs VAR=value [...] -- <command> [args...]");
  process.exit(2);
}

const env = { ...process.env };
for (const assignment of argv.slice(0, sep)) {
  const eq = assignment.indexOf("=");
  if (eq <= 0) {
    console.error(`run-with-env: not an assignment: ${assignment}`);
    process.exit(2);
  }
  const name = assignment.slice(0, eq);
  let value = assignment.slice(eq + 1);
  if (value === "~" || value.startsWith("~/")) {
    value = path.join(os.homedir(), value.slice(2));
  }
  if (!env[name]) env[name] = value; // unset or empty -> default (the ${VAR:-value} rule)
}

const [command, ...args] = argv.slice(sep + 1);
const windows = process.platform === "win32";
// cmd.exe does not unquote spawn args by itself; quote anything with spaces or cmd
// metacharacters (best effort — cmd has no lossless general quoting, but dev-script args
// are file paths and short flags).
const quote = (a) => (/[\s"^&|<>;,()%!]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
const child = windows
  ? spawn([command, ...args].map(quote).join(" "), {
      stdio: "inherit",
      env,
      shell: true,
      windowsHide: true,
    })
  : spawn(command, args, { stdio: "inherit", env });

child.on("error", (err) => {
  console.error(`run-with-env: failed to start ${command}: ${err.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) {
    // Mirror the shell convention for signal deaths so callers see a failure.
    process.exit(1);
  }
  process.exit(code ?? 1);
});
