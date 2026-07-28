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
import { config as loadDotenv } from "dotenv";
import { serve } from "@hono/node-server";
import { buildAppDeps, createApp } from "./app.js";
import { resolveServerConfig } from "./config.js";
import { loopbackHostRoles } from "./services/preview-token.js";

loadDotenv({ quiet: true });

const config = resolveServerConfig();
const deps = buildAppDeps(config);
const app = createApp(deps);

// Built-in admin seed (idempotent): creates admin (initial password penguin-2026) and adopts default_project when the users table is empty.
await deps.authService.seedAdmin();

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
const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`penguin-server started: http://${appHost}:${info.port}`);
  console.log(`Data root: ${config.root}`);
  console.log(`SQLite: ${config.dbPath}`);
});

/**
 * Second loopback listener so the preview origin is actually reachable.
 *
 * Workspace HTML previews are served from the loopback counterpart of the host the App
 * is used on (`127.0.0.1` <-> `localhost`, see design § "Workspace 文件预览"). On most
 * systems `localhost` resolves to `::1` first, so a server bound only to `127.0.0.1`
 * would leave every preview URL refusing connections. Binding `::1` as well closes that
 * gap. Failure is non-fatal — the App keeps working, previews just fall back.
 */
const ipv6Loopback =
  config.host === "127.0.0.1" || config.host === "localhost"
    ? serve({ fetch: app.fetch, hostname: "::1", port: config.port })
    : null;
ipv6Loopback?.on("error", (err: NodeJS.ErrnoException) => {
  console.warn(
    `[server] IPv6 loopback listener unavailable (${err.code ?? err.message}); previews via localhost may not resolve.`,
  );
});

let shuttingDown = false;
async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down…`);
  deps.scheduler.stop();
  await deps.manager.shutdown(5000);
  deps.channels.dispose();
  ipv6Loopback?.close();
  server.close(() => {
    deps.db.close();
    process.exit(exitCode);
  });
  // Fallback: a long-lived SSE connection may block the close callback, so force exit after 1s.
  setTimeout(() => process.exit(exitCode), 1000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

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
