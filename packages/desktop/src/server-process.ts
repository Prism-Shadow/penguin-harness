/**
 * Embedded server lifecycle: forks @prismshadow/penguin-server as an Electron
 * utilityProcess (same Node runtime, isolated from the main process), learns the actual
 * port from the PENGUIN_PORT_FILE announcement, probes HTTP readiness, and stops the
 * server gracefully — shutdown endpoint first (the only graceful path on Windows, where
 * kill() is a hard TerminateProcess), then SIGTERM-equivalent kill as fallback.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app, utilityProcess } from "electron";
import type { UtilityProcess } from "electron";
import { osProxyEnv } from "./os-proxy.js";
import { choosePort, readPreferredPort, rememberPreferredPort } from "./port-memory.js";
import { appOriginFor, parsePortFile } from "./util.js";

export interface EmbeddedServer {
  child: UtilityProcess;
  /** App origin, e.g. `http://localhost:53187` (always localhost — 127.0.0.1 is the preview host). */
  origin: string;
  /** This launch's PENGUIN_DESKTOP_TOKEN: one-shot for the claim link, reusable for the shutdown endpoint. */
  token: string;
}

/** How long the server gets to announce its port / answer HTTP before startup fails. */
const PORT_FILE_TIMEOUT_MS = 30_000;
const HTTP_READY_TIMEOUT_MS = 10_000;
/** Grace period after the shutdown request (matches the server's own ≤5s wrap-up). */
const SHUTDOWN_GRACE_MS = 6_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The server bundle — forked by path. tsup emits @prismshadow/penguin-server as one
 * self-contained file in this package's dist/, so a source run and a packaged app fork the
 * same artifact from the same app-path-relative location (asar is off, see
 * electron-builder.yml, so it is a plain file either way).
 */
function serverEntryPath(): string {
  return path.join(app.getAppPath(), "dist", "server.js");
}

/**
 * Extra environment for the forked server. Windows packages carry MinGit under
 * resources/git (electron-builder extraResources): advertising its sh.exe as
 * PENGUIN_BUNDLED_SHELL gives the agent shell the same deterministic POSIX behavior as
 * the npm-installed package (core's shell resolver prefers a user-installed Git for
 * Windows from PATH, then this bundle, before falling back to PowerShell). An existing
 * value is respected.
 */
function bundledShellEnv(): Record<string, string> {
  if (process.platform !== "win32" || process.env.PENGUIN_BUNDLED_SHELL) return {};
  const sh = path.join(process.resourcesPath, "git", "usr", "bin", "sh.exe");
  return fs.existsSync(sh) ? { PENGUIN_BUNDLED_SHELL: sh } : {};
}

async function waitForPortFile(file: string, exited: () => boolean): Promise<number> {
  const deadline = Date.now() + PORT_FILE_TIMEOUT_MS;
  for (;;) {
    if (exited()) throw new Error("The embedded server exited before announcing its port.");
    try {
      const port = parsePortFile(fs.readFileSync(file, "utf8"));
      if (port !== null) return port;
    } catch {
      // Not written yet.
    }
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for the embedded server's port announcement.");
    }
    await delay(100);
  }
}

async function waitForHttp(origin: string, exited: () => boolean): Promise<void> {
  const deadline = Date.now() + HTTP_READY_TIMEOUT_MS;
  for (;;) {
    if (exited()) throw new Error("The embedded server exited during startup.");
    try {
      // Any HTTP answer counts (the root may 302 on the preview host); manual redirect
      // keeps the probe from chasing hosts.
      const res = await fetch(`${origin}/`, {
        redirect: "manual",
        signal: AbortSignal.timeout(1000),
      });
      void res.body?.cancel();
      return;
    } catch {
      // Not accepting yet.
    }
    if (Date.now() >= deadline) throw new Error("Timed out waiting for the embedded server.");
    await delay(100);
  }
}

/**
 * Starts the embedded server on the given data root — preferring last launch's port so
 * the app origin (and the renderer's origin-scoped localStorage: theme, language, …)
 * stays stable across launches, with PORT=0 as the fallback allocator — and a fresh
 * one-shot token. Resolves once HTTP answers. The caller attaches its own
 * `child.on("exit", …)` restart policy after this resolves.
 */
export async function startEmbeddedServer(opts: {
  dataRoot: string;
  /** Which instance this is; the server reaches other machines' matching installation by it. */
  profile: "release" | "dev";
  /** Pinned web dist (packaged app), or null to leave it to the server's default lookup. */
  webDist: string | null;
  portFile: string;
  preferredPortFile: string;
  log: (chunk: string) => void;
}): Promise<EmbeddedServer> {
  const token = randomBytes(32).toString("base64url");
  fs.rmSync(opts.portFile, { force: true });
  const requestedPort = await choosePort(readPreferredPort(opts.preferredPortFile));
  const child = utilityProcess.fork(serverEntryPath(), [], {
    serviceName: "penguin-server",
    stdio: "pipe",
    env: {
      ...process.env,
      ...bundledShellEnv(),
      // OS proxy settings resolved at fork time (Electron resolveProxy) — only for the
      // proxy variables the environment leaves unset, never overriding existing values.
      // The server's "use system HTTP proxy" switch then governs whether they are used.
      ...(await osProxyEnv()),
      PENGUIN_HOME: opts.dataRoot,
      PENGUIN_PROFILE: opts.profile,
      ...(opts.webDist !== null ? { PENGUIN_WEB_DIST: opts.webDist } : {}),
      HOST: "127.0.0.1",
      PORT: String(requestedPort),
      PENGUIN_DESKTOP_TOKEN: token,
      PENGUIN_PORT_FILE: opts.portFile,
    },
  });
  child.stdout?.on("data", (chunk: Buffer) => opts.log(String(chunk)));
  child.stderr?.on("data", (chunk: Buffer) => opts.log(String(chunk)));
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });

  const port = await waitForPortFile(opts.portFile, () => exited);
  rememberPreferredPort(opts.preferredPortFile, port);
  const origin = appOriginFor(port);
  await waitForHttp(origin, () => exited);
  return { child, origin, token };
}

/**
 * Graceful stop: POST /api/desktop/shutdown with the shell's Bearer token, wait out the
 * server's wrap-up, then kill as a last resort. Safe to call when the child already died.
 */
export async function stopEmbeddedServer(server: EmbeddedServer): Promise<void> {
  let exited = false;
  const exit = new Promise<void>((resolve) =>
    server.child.once("exit", () => {
      exited = true;
      resolve();
    }),
  );
  try {
    await fetch(`${server.origin}/api/desktop/shutdown`, {
      method: "POST",
      headers: { authorization: `Bearer ${server.token}` },
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Server unreachable (already dead or wedged): fall through to kill.
  }
  await Promise.race([exit, delay(SHUTDOWN_GRACE_MS)]);
  if (!exited) {
    server.child.kill();
    await Promise.race([exit, delay(2000)]);
  }
}
