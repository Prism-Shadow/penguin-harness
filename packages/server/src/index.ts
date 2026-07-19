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

loadDotenv({ quiet: true });

const config = resolveServerConfig();
const deps = buildAppDeps(config);
const app = createApp(deps);

// Built-in admin seed (idempotent): creates admin (initial password admin123) and adopts default_project when the users table is empty.
await deps.authService.seedAdmin();

// Schedule scheduler: startup reconciliation (missed, don't backfill) + periodic scan; only active while the server is running.
await deps.scheduler.start();

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`penguin-server 已启动: http://${config.host}:${info.port}`);
  console.log(`数据根目录: ${config.root}`);
  console.log(`SQLite: ${config.dbPath}`);
});

let shuttingDown = false;
async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`收到 ${signal}，正在关停…`);
  deps.scheduler.stop();
  await deps.manager.shutdown(5000);
  deps.channels.dispose();
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
  console.error(`[server] 未捕获异常: ${err.stack ?? err.message}`);
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
  console.error(`[server] 未处理的 Promise 拒绝: ${err.stack ?? err.message}`);
  deps.errors.record({ source: "process", err, code: "unhandled_rejection" });
  // Unlike uncaughtException, this **doesn't** exit: a rejected promise is a localized
  // failure of some background task, and the process state isn't compromised; dragging
  // down the entire service for it (Node's default behavior) isn't worth it — persist +
  // log, then keep serving.
});
