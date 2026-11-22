/**
 * A package manager's command run to completion, as the build scripts run one: its output kept
 * out of the build log, its stderr in the error when it fails. scripts/build-plugins.mjs runs pnpm
 * and npm this way, and scripts/lib/external-plugins.mjs runs `npm pack`. Asynchronous, so the
 * caller's process keeps answering while the command runs (a registry it serves itself, say).
 */
import { spawn } from "node:child_process";

/** A package manager's command, as the platform names it. */
function command(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

// cmd.exe does not unquote spawn args by itself: under `shell: true` the args are joined
// into one command line, so a path with a space (the pack directory lives under the user's
// temp directory, i.e. their profile) splits into two. Quoted the way run-with-env.mjs quotes.
const quote = (a) => (/[\s"^&|<>;,()%!]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

/** Runs `name args…` in `cwd`; rejects with the command's stderr when it fails. */
export function run(name, args, cwd, env = process.env) {
  const windows = process.platform === "win32";
  const failed = (detail) =>
    new Error(`${name} ${args.slice(0, 3).join(" ")} failed in ${cwd}\n${detail}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command(name), windows ? args.map(quote) : args, {
      cwd,
      env,
      shell: windows,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => reject(failed(err.message)));
    child.on("close", (code) => (code === 0 ? resolve() : reject(failed(stderr.trim()))));
  });
}
