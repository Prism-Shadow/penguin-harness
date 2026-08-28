/**
 * `penguin server start` / `penguin server stop` — bring the service on this data root up or
 * down, and answer in one line of JSON whether it worked.
 *
 * Machine-facing, like `penguin server status`: a CONTROLLER runs these over ssh. That is
 * what makes them worth having as commands at all — starting a detached process and then
 * WAITING for it to answer used to happen on the controller's side, as `nohup … &` followed
 * by an ssh probe every second for thirty seconds. Up to thirty round trips to learn one
 * fact the machine knew immediately. Here the waiting happens where the process is, and the
 * controller pays for one command.
 *
 * It also stops being POSIX-only in the process: `nohup`, `kill` and stream redirection have
 * no cmd.exe equivalents, but a detached child and a signal are the same call in Node.
 * Docs: /docs/cli § "penguin server / penguin web".
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveRoot } from "@prismshadow/penguin-core";
import { liveServerLock, readServerLock } from "@prismshadow/penguin-server/lock";
import type { Command } from "commander";
import type { Messages } from "../i18n.js";
import { waitForReady } from "./serve.js";

/** What both commands print. `detail` is only present when `ok` is false. */
interface LifecycleResult {
  ok: boolean;
  port?: number;
  pid?: number;
  detail?: string;
}

/** How long a freshly started server gets to answer on its port before this gives up. */
const START_TIMEOUT_MS = 30_000;

/** How long a TERM'd server gets to let go of its lock. */
const STOP_TIMEOUT_MS = 8_000;

/** Last lines of the server log — the far side's own words when a start fails. */
const LOG_TAIL_LINES = 20;

function say(result: LifecycleResult): void {
  process.stdout.write(JSON.stringify(result) + "\n");
  if (!result.ok) process.exitCode = 1;
}

export function registerLifecycleCommands(server: Command, t: Messages): void {
  server
    .command("start")
    .description(t.serverLifecycle.startDesc)
    .requiredOption("--port <port>", t.serve.port)
    .action(async (opts: { port: string }) => {
      const port = Number(opts.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return say({ ok: false, detail: `bad port ${opts.port}` });
      }
      say(await startDetached(resolveRoot(), port));
    });

  server
    .command("stop")
    .description(t.serverLifecycle.stopDesc)
    .action(async () => {
      say(await stopHere(resolveRoot()));
    });
}

/**
 * Spawns this same CLI as a detached `penguin server`, then waits for the port to answer.
 *
 * A live server already owning the root is reported as such rather than started over — two
 * on one data root is refused anyway (web.db is single-writer), and the caller asked for a
 * server on a port, which is a question the existing one may already answer.
 */
async function startDetached(root: string, port: number): Promise<LifecycleResult> {
  const existing = await liveServerLock(root);
  if (existing !== null) {
    return existing.port === port
      ? { ok: true, port: existing.port, pid: existing.pid }
      : { ok: false, detail: `a server is already running on port ${existing.port}` };
  }

  fs.mkdirSync(root, { recursive: true });
  const log = fs.openSync(path.join(root, "server.log"), "a");
  try {
    // argv[1] is this CLI's entry script and execPath the runtime that is running it — the
    // packaged launcher is `<install>/node/bin/node <install>/lib/dist/penguin.js`, so the
    // pair reproduces exactly the program that got here. Detached with the parent's stdio
    // dropped: this process exits as soon as it has an answer, and the child must not die
    // with the ssh session that asked.
    const child = spawn(
      process.execPath,
      [process.argv[1] ?? "", "server", "--port", String(port)],
      {
        detached: true,
        stdio: ["ignore", log, log],
        env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
      },
    );
    child.unref();
  } finally {
    fs.closeSync(log);
  }

  const ready = await waitForReady(`http://127.0.0.1:${port}/`, START_TIMEOUT_MS);
  if (!ready.ready) {
    // The log rather than the readiness error: a port collision or a broken install says far
    // more in the server's own words than "connection refused" does.
    return { ok: false, detail: tail(path.join(root, "server.log")) || ready.failure.detail };
  }
  const lock = readServerLock(root);
  return { ok: true, port, ...(lock === null ? {} : { pid: lock.pid }) };
}

/** TERM, then wait for the lock to stop reading live. Already-stopped is a success. */
async function stopHere(root: string): Promise<LifecycleResult> {
  const lock = await liveServerLock(root);
  if (lock === null) return { ok: true };
  try {
    process.kill(lock.pid, "SIGTERM");
  } catch {
    // Gone between the lock read and the signal: that is the outcome asked for.
    return { ok: true };
  }
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  for (;;) {
    if ((await liveServerLock(root)) === null) return { ok: true };
    if (Date.now() >= deadline) {
      return { ok: false, pid: lock.pid, detail: "it did not exit within 8s" };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** The log's last lines, or "" when there is no readable log. */
function tail(file: string): string {
  try {
    return fs.readFileSync(file, "utf8").split("\n").slice(-LOG_TAIL_LINES).join("\n").trim();
  } catch {
    return "";
  }
}
