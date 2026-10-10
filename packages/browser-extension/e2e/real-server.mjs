// The PenguinHarness server the real e2e runs against: this checkout's own build
// (packages/server/dist, serving packages/web/dist), on a free loopback port and a throwaway data
// root, with the seeded admin's password pinned so the run can sign in. The agent's CLI is the
// checkout's packages/cli/dist, pointed at the same data root, so it finds this server through
// its server.lock and the admin API token beside it, exactly as an agent inside a session does.
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

export const ADMIN_ID = "admin";
export const ADMIN_PASSWORD = "penguin-2026";

/** The environment a child starts from: nothing that would point it at another server or root. */
function cleanEnv() {
  const env = { ...process.env };
  for (const name of [
    "PENGUIN_HOME",
    "PENGUIN_API_URL",
    "PENGUIN_API_TOKEN",
    "PENGUIN_SESSION_ID",
    "PENGUIN_PROFILE",
    "http_proxy",
    "https_proxy",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "all_proxy",
    "ALL_PROXY",
  ]) {
    delete env[name];
  }
  return { ...env, FORCE_COLOR: "0", NO_COLOR: "1" };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Starts the server and resolves once it answers. `origin` is on `localhost`, not 127.0.0.1: the
 * server serves the App on localhost and keeps 127.0.0.1 for Workspace previews.
 */
export async function startRealServer({ repoRoot }) {
  const data = mkdtempSync(path.join(tmpdir(), "penguin-ext-e2e-root-"));
  const port = await freePort();
  const output = [];
  const child = spawn(process.execPath, [path.join(repoRoot, "packages/server/dist/index.js")], {
    env: {
      ...cleanEnv(),
      PENGUIN_HOME: data,
      PORT: String(port),
      HOST: "127.0.0.1",
      PENGUIN_WEB_DB: path.join(data, "web.db"),
      PENGUIN_WEB_DIST: path.join(repoRoot, "packages/web/dist"),
      PENGUIN_SEED_ADMIN_PASSWORD: ADMIN_PASSWORD,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const keep = (chunk) => {
    output.push(...String(chunk).split("\n"));
    if (output.length > 400) output.splice(0, output.length - 400);
  };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  let exited = null;
  child.on("exit", (code) => (exited = code));

  const origin = `http://localhost:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (exited !== null) {
      throw new Error(`the server exited (${exited}):\n${output.slice(-40).join("\n")}`);
    }
    try {
      if ((await fetch(`${origin}/`)).ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`the server did not come up:\n${output.slice(-40).join("\n")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return {
    origin,
    data,
    /** The server's last lines of output, for a failure report. */
    tail: (n = 40) => output.slice(-n).join("\n"),
    /** Runs `penguin <args>` from this checkout as an agent would: same data root, `env` added. */
    cli(args, env = {}) {
      return new Promise((resolve) => {
        execFile(
          process.execPath,
          [path.join(repoRoot, "packages/cli/dist/penguin.js"), ...args],
          { env: { ...cleanEnv(), PENGUIN_HOME: data, ...env }, timeout: 90_000 },
          (err, stdout, stderr) =>
            resolve({ code: err === null ? 0 : (err.code ?? 1), stdout, stderr }),
        ).stdin?.end();
      });
    },
    async close() {
      if (exited === null) {
        child.kill("SIGTERM");
        await new Promise((resolve) => {
          const timer = setTimeout(() => {
            child.kill("SIGKILL");
            resolve();
          }, 10_000);
          child.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      rmSync(data, { recursive: true, force: true });
    },
  };
}
