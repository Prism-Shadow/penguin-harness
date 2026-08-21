/**
 * Server startup entry point: dotenv → config → assembly → listen
 * → graceful shutdown.
 *
 * SIGINT / SIGTERM: interrupt all active runs (pending approvals converge to deny), wait
 * ≤5s for wrap-up, then close HTTP and SQLite. Tests never go through this file
 * (injected via app.request() instead).
 * There's also a process-level error fallback (uncaughtException / unhandledRejection):
 * persist + log, with the fatal one still shutting down per existing semantics (see the
 * comment below).
 */
import fs from "node:fs";
import path from "node:path";
import type { Server as HttpServer } from "node:http";
import { config as loadDotenv } from "dotenv";
import { serve } from "@hono/node-server";
import { buildAppDeps, createApp } from "./app.js";
import { ADMIN_USER_ID } from "./auth/service.js";
import { resolveServerConfig } from "./config.js";
import {
  clearInitialAdminPassword,
  readInitialAdminPassword,
  renderInitialPasswordNotice,
  storeInitialAdminPassword,
} from "./initial-password.js";
import { applyProxySettings, installGlobalProxyDispatcher } from "./net/proxy.js";
import { attachTerminalWebSocket } from "./terminal/ws.js";
import { loopbackHostRoles } from "./services/preview-token.js";
import { acquireServerLock, liveServerLock, releaseServerLock } from "./lock.js";
import { shellPortOf, wireShellUpdatePort } from "./services/desktop-update-port.js";

loadDotenv({ quiet: true });

// Outbound proxy support, installed at the earliest point (right after dotenv, which may
// itself define HTTP_PROXY): replaces globalThis.fetch with undici's and sets the global
// dispatcher, starting from the defaults (app switch on, no explicit address). The
// persisted values can only be read once the database is open, so they are applied via
// applyProxySettings right after buildAppDeps below — nothing in between makes an
// outbound request. See net/proxy.ts.
installGlobalProxyDispatcher();

/** Exit code for "another server already owns this data root" (see lock.ts). */
const EXIT_ALREADY_RUNNING = 3;

const config = resolveServerConfig();

// Single instance per data root: web.db is single-writer and the scheduler must not run
// twice, so refuse to start when a live server already owns this root — BEFORE opening
// the database. The CLI and the desktop shell pre-check the same lock for a friendlier
// path (open / attach to the existing instance); this is the in-process backstop.
const existingLock = await liveServerLock(config.root);
if (existingLock) {
  console.error(
    `Another PenguinHarness server is already running on this data root (pid ${existingLock.pid}).`,
  );
  console.error(`Existing instance: http://localhost:${existingLock.port}/`);
  process.exit(EXIT_ALREADY_RUNNING);
}

const deps = buildAppDeps(config);
// The database is open now: bring the dispatcher in line with the persisted proxy
// settings (absent rows read as the defaults: app switch on, no explicit address)
// before the first possible outbound request (update check, LLM calls — all behind
// HTTP handlers).
applyProxySettings({
  proxyForApp: deps.serverSettingsRepo.getProxyForApp(),
  proxyUrl: deps.serverSettingsRepo.getProxyUrl(),
});
const app = createApp(deps);

// Built-in admin seed (idempotent): creates admin and adopts default_project when the
// users table is empty. The returned initial password (random unless pinned via
// PENGUIN_SEED_ADMIN_PASSWORD) is persisted in the data root while it remains the
// initial one, and EVERY startup re-prints the framed reminder until the password is
// changed (any password update for admin removes the file — see initial-password.ts).
// Never printed (or persisted) in desktop mode: the seed there is fully random by design
// (config.ts) and sign-in goes through the shell's one-shot token, so showing it would
// only leak a credential into a log nobody needs.
const seededAdminPassword = await deps.authService.seedAdmin();
if (config.desktopToken === null) {
  if (seededAdminPassword !== null) {
    storeInitialAdminPassword(config.root, seededAdminPassword);
  }
  if (deps.authService.adminPasswordIsInitial()) {
    const initialPassword = seededAdminPassword ?? readInitialAdminPassword(config.root);
    // Roots seeded before the password was persisted have no file: stay silent — the
    // plaintext is unrecoverable, and a reminder with nothing to type is pure nagging.
    if (initialPassword !== null) {
      console.log(renderInitialPasswordNotice(ADMIN_USER_ID, initialPassword));
    }
  } else {
    // Heal: the flag was cleared while the file survived (e.g. the password was changed
    // under a build that predates the file) — a stale plaintext must not outlive it.
    clearInitialAdminPassword(config.root);
  }
}

// Schedule scheduler: startup reconciliation (missed, don't backfill) + periodic scan; only active while the server is running.
await deps.scheduler.start();

// Goal mode runs only in SessionManager memory: a hard crash (SIGKILL, power loss) can leave
// goal_state rows stuck `active` with no runner behind them. Reconcile them to `aborted` now —
// nothing is running yet, so any `active` row is a crash orphan — so the chat banner never
// restores a phantom "running" goal. GOAL.yaml on disk stays `active` as the resume point.
deps.goalsRepo.abortOrphanedActive();

// On a loopback bind the App is canonicalized onto one name (`localhost`) and its
// counterpart is reserved for previews, so advertise the canonical name — the other one
// only 302s back here for App routes (see the canonical-host guard in app.ts).
const appHost = loopbackHostRoles(config.host)?.app ?? config.host;

/**
 * Second loopback listener so the preview origin is actually reachable.
 *
 * Workspace HTML previews are served from the loopback counterpart of the host the App
 * is used on (`127.0.0.1` <-> `localhost`). On most
 * systems `localhost` resolves to `::1` first, so a server bound only to `127.0.0.1`
 * would leave every preview URL refusing connections. Binding `::1` as well closes that
 * gap. Failure is non-fatal — the App keeps working, previews just fall back.
 *
 * Created inside the main listener's callback so it reuses the ACTUAL bound port: with
 * PORT=0 both listeners resolving 0 independently would land on two different ports and
 * every preview URL (same port, counterpart host) would refuse connections.
 */
let ipv6Loopback: ReturnType<typeof serve> | null = null;

/** Port announcement (PENGUIN_PORT_FILE): tmp + rename, so a polling reader never sees a partial write. */
function writePortFile(file: string, port: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${port}\n`);
  fs.renameSync(tmp, file);
}

/** Terminal WebSocket wiring, shared by every listener this process opens. */
const terminalWebSocketDeps = {
  hmr: deps.hmr,
  authService: deps.authService,
  log: (line: string) => console.log(line),
};

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`penguin-server started: http://${appHost}:${info.port}`);
  console.log(`Data root: ${config.root}`);
  console.log(`SQLite: ${config.dbPath}`);
  if (config.desktopToken !== null) console.log("Desktop mode: enabled");
  // PORT=0 asked for an ephemeral port: record the real one so everything derived from
  // the server's own port is correct — Workspace preview URLs above all, which are built
  // from the bind port on purpose (see resolvePreviewTarget) and would otherwise point at
  // port 0 and fail to load. deps.config is this same object, so both route call sites
  // (me.ts, sessions.ts) observe the update.
  config.port = info.port;
  // The root exists by now (openDatabase created it), and the pre-start check found no
  // live owner — record ourselves as this root's server.
  acquireServerLock(config.root, {
    pid: process.pid,
    port: info.port,
    startedAt: new Date().toISOString(),
  });
  if (config.portFile !== null) writePortFile(config.portFile, info.port);
  if (config.host === "127.0.0.1" || config.host === "localhost") {
    ipv6Loopback = serve({ fetch: app.fetch, hostname: "::1", port: info.port });
    ipv6Loopback.on("error", (err: NodeJS.ErrnoException) => {
      console.warn(
        `[server] IPv6 loopback listener unavailable (${err.code ?? err.message}); previews via localhost may not resolve.`,
      );
    });
    // The terminal stream is a WebSocket upgrade, which never reaches the Hono fetch
    // handler — it has to be bound on each Node listener, this one included, or the
    // terminal only works on whichever address the browser happened to resolve.
    attachTerminalWebSocket(ipv6Loopback as unknown as HttpServer, terminalWebSocketDeps);
  }
});
attachTerminalWebSocket(server as unknown as HttpServer, terminalWebSocketDeps);

/** Removes the instance lock and port file (best-effort; runs on both exit paths). */
function cleanupInstanceFiles(): void {
  releaseServerLock(config.root);
  if (config.portFile !== null) {
    try {
      fs.rmSync(config.portFile, { force: true });
    } catch {
      // Best-effort: a stale port file is rewritten by the next server.
    }
  }
}

let shuttingDown = false;
async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down…`);
  deps.scheduler.stop();
  await deps.manager.shutdown(5000);
  deps.hmr.dispose();
  deps.channels.dispose();
  ipv6Loopback?.close();
  server.close(() => {
    deps.db.close();
    cleanupInstanceFiles();
    process.exit(exitCode);
  });
  // Fallback: a long-lived SSE connection may block the close callback, so force exit after 1s.
  setTimeout(() => {
    cleanupInstanceFiles();
    process.exit(exitCode);
  }, 1000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// Desktop shell quit path: POST /api/desktop/shutdown lands here — the same graceful
// shutdown as the signals, reachable over HTTP because a Windows child kill is a hard
// TerminateProcess with no signal delivery.
deps.desktop?.onShutdownRequest(() => void shutdown("desktop-shutdown"));

// Client-update relay: under the shell this process is an Electron utilityProcess and
// carries process.parentPort; wire it to the desktop service so the update routes can
// read the shell's updater snapshot and forward check/install. Absent port (a plain
// `penguin server|web` run, or tests) wires nothing.
if (deps.desktop !== null) {
  const shellPort = shellPortOf(process);
  if (shellPort !== null) wireShellUpdatePort(deps.desktop, shellPort);
}

// Process-level error fallback: once a background
// fire-and-forget promise (title generation, Session drive, etc.) throws, the error
// reaches the process without passing through any catch — persist it first for a
// record, then handle each case according to its nature.
process.on("uncaughtException", (err) => {
  console.error(`[server] Uncaught exception: ${err.stack ?? err.message}`);
  deps.errors.record({ source: "process", err, code: "uncaught_exception" });
  // From this point the process state can't be trusted (the error was never converged
  // by any catch): don't swallow it — wrap up per existing shutdown semantics and exit
  // with a nonzero code (equivalent to Node's default crash exit, just with an extra
  // persist and graceful wrap-up).
  // Must exit even if shutdown itself errors — never let "caught a fatal error" turn
  // into "the process limps along in a broken state".
  void shutdown("uncaughtException", 1).catch(() => process.exit(1));
});
process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  console.error(`[server] Unhandled promise rejection: ${err.stack ?? err.message}`);
  deps.errors.record({ source: "process", err, code: "unhandled_rejection" });
  // Unlike uncaughtException, this **doesn't** exit: a rejected promise is a localized
  // failure of some background task, and the process state isn't compromised; dragging
  // down the entire service for it (Node's default behavior) isn't worth it — persist +
  // log, then keep serving.
});
