/**
 * Server process entry point: the whole startup lifecycle, as one ordered sequence.
 *
 * Importing this module STARTS the server — the CLI runs a server in its own process by
 * `await import("@prismshadow/penguin-server")` and nothing else, so main() is invoked at
 * module scope rather than exported.
 *
 * main() comes first in the file and is the sequence itself: each step is one PenguinServer
 * method, named after what it does and appearing in the order main() calls it. The order
 * carries real constraints — the proxy dispatcher before any outbound request, the instance
 * lock before the database opens, plugins loaded before the platform boots against them,
 * the platform (and with it the whole business surface) before the first request is
 * served — so each step documents the constraint it stands on.
 *
 * Tests never go through this file (they inject via app.request() instead).
 */
import fs from "node:fs";
import path from "node:path";
import type { Server as HttpServer } from "node:http";
import { config as loadDotenv } from "dotenv";
import { serve } from "@hono/node-server";
import { bootAppDeps, createRuntimeApp } from "./app.js";
import type { ServerBoot } from "./app.js";
import { ADMIN_USER_ID } from "./auth/service.js";
import { resolveServerConfig, type ServerConfig } from "./config.js";
import { clearInitialAdminPassword, renderFirstLoginNotice } from "./initial-password.js";
import { applyProxySettings, installGlobalProxyDispatcher } from "./net/proxy.js";
import { PluginHost } from "./plugin/host.js";
import { loadPlugins } from "./plugin/loader.js";
import { attachTerminalWebSocket } from "./terminal/ws.js";
import { loopbackHostRoles } from "./services/preview-token.js";
import { acquireServerLock, liveServerLock, releaseServerLock } from "./lock.js";
import { shellPortOf, wireShellUpdatePort } from "./services/desktop-update-port.js";
import type { Settings } from "./mechanisms/settings.js";
import type { Errors } from "./mechanisms/observability.js";
import type { Auth } from "./mechanisms/identity.js";

/**
 * The startup lifecycle: one line per step, in the order they have to happen.
 *
 * This is the file's table of contents — each call below is a PenguinServer method, and
 * reading them top to bottom is the whole of what starting a server does.
 */
async function main(): Promise<void> {
  const server = new PenguinServer();
  server.loadEnv();
  server.installProxy();
  server.readConfig();
  await server.ensureSoleInstance();
  await server.loadPlugins();
  await server.buildDeps();
  server.applyPersistedProxy();
  server.buildApp();
  await server.seedAdmin();
  server.listen();
  server.installProcessHandlers();
}

/**
 * One server process, one method per lifecycle step.
 *
 * The steps are not independent: each reads what the ones before it produced. main() is
 * the only caller and runs them in order, which is what lets the spine fields below be
 * read without a null check from the step after the one that assigns them.
 */
class PenguinServer {
  /** Set at seed when this server still has no admin password; printed once the port is known. */
  private pendingFirstLoginNotice = false;

  /** Assigned by readConfig(); every later step reads it. */
  private config!: ServerConfig;
  /** Assigned by loadPlugins(); published to the platform tree by buildDeps(). */
  private plugins!: PluginHost;
  /** Assigned by buildDeps(); the merged runtime + business view (see app.ts). */
  private deps!: ServerBoot;
  /** Assigned by buildApp(). */
  private app!: ReturnType<typeof createRuntimeApp>;
  /** Assigned by listen(). */
  private httpServer!: ReturnType<typeof serve>;

  /** The `::1` companion listener, when one was opened — see openIpv6Loopback(). */
  private ipv6Loopback: ReturnType<typeof serve> | null = null;

  private shuttingDown = false;

  /** The current App's auth service — resolved per call, since a hot swap replaces the tree. */
  private auth(): Auth {
    return this.deps.tree.api<Auth>("IdentityModule", "Auth");
  }

  /** `.env` may itself define HTTP_PROXY, so it is loaded before the dispatcher reads one. */
  loadEnv(): void {
    loadDotenv({ quiet: true });
  }

  /**
   * Outbound proxy support, installed at the earliest point: replaces globalThis.fetch
   * with undici's and sets the global dispatcher, starting from the defaults (app switch
   * on, no explicit address). The persisted values can only be read once the database is
   * open, so they arrive later through applyPersistedProxy() — nothing in between makes an
   * outbound request. See net/proxy.ts.
   */
  installProxy(): void {
    installGlobalProxyDispatcher();
  }

  /** Resolves the process configuration, which comes from the environment only (config.ts). */
  readConfig(): void {
    this.config = resolveServerConfig();
  }

  /**
   * Single instance per data root: web.db is single-writer and the scheduler must not run
   * twice, so refuse to start when a live server already owns this root — BEFORE opening
   * the database. The CLI and the desktop shell pre-check the same lock for a friendlier
   * path (open / attach to the existing instance); this is the in-process backstop.
   */
  async ensureSoleInstance(): Promise<void> {
    const existing = await liveServerLock(this.config.root);
    if (existing === null) return;
    console.error(
      `Another PenguinHarness server is already running on this data root (pid ${existing.pid}).`,
    );
    console.error(`Existing instance: http://localhost:${existing.port}/`);
    process.exit(EXIT_ALREADY_RUNNING);
  }

  /**
   * Plugins are configuration, and reading configuration is the runtime's job: take the
   * specifiers plugins.json names, import them, and register each into this process's one
   * PluginHost. Once per process — a hot swap re-delivers the hooks to these same plugin
   * objects, which is the host's job, but must never import them again.
   *
   * A plugin that fails to load is skipped with a warning instead of taking the server
   * down: the capability it would have provided stays unavailable, which a deployment can
   * recover from, whereas a server that refuses to boot serves nobody.
   */
  async loadPlugins(): Promise<void> {
    this.plugins = new PluginHost();
    const result = await loadPlugins(this.config.root);
    for (const entry of result.loaded) {
      // Only held here — the platform boots the modules inside its own tree, per App. A
      // module name clash is a LOAD failure, isolated per entry like an import failure.
      try {
        this.plugins.use(entry);
      } catch (err) {
        result.failed.set(entry.specifier, err instanceof Error ? err.message : String(err));
      }
    }
    for (const [specifier, reason] of result.failed) {
      console.warn(`[plugins] skipped ${specifier}: ${reason}`);
    }
  }

  /**
   * Builds the service graph: opens the database, publishes the runtime capabilities —
   * the loaded plugin host among them — and boots the platform, whose create() assembles
   * the whole business surface (services, routes, the scheduler) and delivers the plugin
   * hooks. The host is handed in rather than registered here because the platform boots
   * INSIDE bootAppDeps: everything it claims has to be in the registry first, and the
   * registry is the only way a pushed bundle — compiled standalone — can reach these
   * plugin objects at all (see plugin/index.ts's pluginHostFrom).
   */
  async buildDeps(): Promise<void> {
    this.deps = await bootAppDeps(this.config, [], this.plugins);
  }

  /**
   * The database is open now: bring the dispatcher in line with the persisted proxy
   * settings (absent rows read as the defaults: app switch on, no explicit address) before
   * the first possible outbound request (update check, LLM calls — all behind HTTP
   * handlers).
   */
  applyPersistedProxy(): void {
    const settings = this.deps.tree.api<Settings>("SettingsModule", "Settings");
    applyProxySettings({
      proxyForApp: settings.getProxyForApp(),
      proxyUrl: settings.getProxyUrl(),
    });
  }

  /** Assembles the runtime shell's middleware and routes. Nothing is listening yet. */
  buildApp(): void {
    this.app = createRuntimeApp(this.deps);
  }

  /**
   * Built-in admin seed (idempotent): creates admin and adopts default_project when the
   * users table is empty. The seed password is random, hashed, and discarded — nobody ever
   * sees it — so a server that still has no admin password of its own prints a one-time
   * sign-in LINK instead, carrying this boot's first-login token. The notice re-prints on
   * every start until a password is set, because the link is regenerated every start.
   *
   * Nothing is printed in desktop mode: the shell's own window signs in through its one-shot
   * token, so a link in a log would be a credential nobody needs. Nothing is printed either
   * when the pinned PENGUIN_SEED_ADMIN_PASSWORD is still the admin's actual password — the
   * operator knows it. The pin alone is not enough: an offline reset-admin-password replaces
   * the password with an unknowable one while the pin stays configured, and the rescue flow
   * IS this link, so the gate verifies the pin against the hash rather than trusting it.
   *
   * The sweep runs unconditionally: a root carried over from a build that stored the
   * plaintext must not keep holding it (see initial-password.ts).
   */
  async seedAdmin(): Promise<void> {
    await this.auth().seedAdmin();
    clearInitialAdminPassword(this.config.root);
    if (this.config.desktopToken !== null) return;
    if (!this.auth().adminPasswordIsInitial()) return;
    const pinned = this.config.seedAdminPassword;
    if (pinned !== null && (await this.auth().adminPasswordIs(pinned))) return;
    this.pendingFirstLoginNotice = true;
  }

  /**
   * Opens the HTTP listener. Everything that needs the port the OS actually handed out
   * (PORT=0 asks for an ephemeral one) waits for onListening().
   */
  listen(): void {
    this.httpServer = serve(
      { fetch: this.app.fetch, hostname: this.config.host, port: this.config.port },
      (info) => this.onListening(info.port),
    );
    attachTerminalWebSocket(this.httpServer as unknown as HttpServer, this.terminalWebSocketDeps());
  }

  /**
   * Signals, the desktop quit path and the process-level error fallback. Registered after
   * listen(), so shutdown() can never fire before there is a listener for it to close.
   */
  installProcessHandlers(): void {
    process.on("SIGINT", () => void this.shutdown("SIGINT"));
    process.on("SIGTERM", () => void this.shutdown("SIGTERM"));

    // Desktop shell quit path: POST /api/desktop/shutdown lands here — the same graceful
    // shutdown as the signals, reachable over HTTP because a Windows child kill is a hard
    // TerminateProcess with no signal delivery.
    this.deps.desktop?.onShutdownRequest(() => void this.shutdown("desktop-shutdown"));

    // Client-update relay: under the shell this process is an Electron utilityProcess and
    // carries process.parentPort; wire it to the desktop service so the update routes can
    // read the shell's updater snapshot and forward check/install. Absent port (a plain
    // `penguin server|web` run, or tests) wires nothing.
    if (this.deps.desktop !== null) {
      const shellPort = shellPortOf(process);
      if (shellPort !== null) wireShellUpdatePort(this.deps.desktop, shellPort);
    }

    // Process-level error fallback: once a background fire-and-forget promise (title
    // generation, Session drive, etc.) throws, the error reaches the process without
    // passing through any catch — persist it first for a record, then handle each case
    // according to its nature.
    process.on("uncaughtException", (err) => {
      console.error(`[server] Uncaught exception: ${err.stack ?? err.message}`);
      this.deps.tree
        .api<Errors>("ObservabilityModule", "Errors")
        .record({ source: "process", err, code: "uncaught_exception" });
      // From this point the process state can't be trusted (the error was never converged
      // by any catch): don't swallow it — wrap up per existing shutdown semantics and exit
      // with a nonzero code (equivalent to Node's default crash exit, just with an extra
      // persist and graceful wrap-up).
      // Must exit even if shutdown itself errors — never let "caught a fatal error" turn
      // into "the process limps along in a broken state".
      void this.shutdown("uncaughtException", 1).catch(() => process.exit(1));
    });
    process.on("unhandledRejection", (reason) => {
      const err = reason instanceof Error ? reason : new Error(String(reason));
      console.error(`[server] Unhandled promise rejection: ${err.stack ?? err.message}`);
      this.deps.tree
        .api<Errors>("ObservabilityModule", "Errors")
        .record({ source: "process", err, code: "unhandled_rejection" });
      // Unlike uncaughtException, this **doesn't** exit: a rejected promise is a localized
      // failure of some background task, and the process state isn't compromised; dragging
      // down the entire service for it (Node's default behavior) isn't worth it — persist +
      // log, then keep serving.
    });
  }

  /** Everything derived from the actual bound port, run once the listener is up. */
  private onListening(port: number): void {
    console.log(`penguin-server started: http://${this.appHost()}:${port}`);
    console.log(`Data root: ${this.config.root}`);
    console.log(`SQLite: ${this.config.dbPath}`);
    // Named for the same reason the data root is: it is the one path the static tail
    // serves from when no pushed web version is restored, and the only trace of a wrong
    // PENGUIN_WEB_DIST or a missing build is otherwise a 404 on every page.
    console.log(`Web dist: ${this.config.webDist}`);
    if (!fs.existsSync(path.join(this.config.webDist, "index.html"))) {
      console.warn(
        `[server] Web dist has no index.html; the Web App answers 404 unless a pushed web ` +
          `version is restored. Build packages/web or point PENGUIN_WEB_DIST at a build.`,
      );
    }
    if (this.config.desktopToken !== null) console.log("Desktop mode: enabled");
    // PORT=0 asked for an ephemeral port: record the real one so everything derived from
    // the server's own port is correct — Workspace preview URLs above all, which are built
    // from the bind port on purpose (see resolvePreviewTarget) and would otherwise point at
    // port 0 and fail to load. deps.config is this same object, so both route call sites
    // (me.ts, sessions.ts) observe the update.
    this.config.port = port;
    // The root exists by now (openDatabase created it), and the pre-start check found no
    // live owner — record ourselves as this root's server.
    acquireServerLock(this.config.root, {
      pid: process.pid,
      port,
      startedAt: new Date().toISOString(),
    });
    if (this.config.portFile !== null) writePortFile(this.config.portFile, port);
    if (this.config.host === "127.0.0.1" || this.config.host === "localhost") {
      this.openIpv6Loopback(port);
    }
    // Last, so the link is what a console is left showing rather than something scrolled
    // past — and here rather than in seedAdmin() because the URL needs the port the OS
    // actually handed out, which PORT=0 only settles at this point.
    if (this.pendingFirstLoginNotice) {
      // Minting here rather than at seed time is what keeps "exists" and "was printed" the
      // same thing for a setup session: the modes that decline to print never ask for one.
      const link = this.auth().mintFirstLogin();
      if (link !== null) {
        const token = encodeURIComponent(link);
        console.log(
          renderFirstLoginNotice(`http://${this.appHost()}:${port}/api/auth/claim?token=${token}`),
        );
      }
    }
  }

  /**
   * On a loopback bind the App is canonicalized onto one name (`localhost`) and its
   * counterpart is reserved for previews, so advertise the canonical name — the other one
   * only 302s back here for App routes (see the canonical-host guard in app.ts).
   */
  private appHost(): string {
    // A wildcard bind is not an address anyone can open — `http://0.0.0.0:<port>` fails in a
    // browser. Whoever reads this console is on the machine, where `localhost` reaches it;
    // someone connecting from elsewhere substitutes the host they use to reach this box.
    if (this.config.host === "0.0.0.0" || this.config.host === "::") return "localhost";
    return loopbackHostRoles(this.config.host)?.app ?? this.config.host;
  }

  /**
   * Second loopback listener so the preview origin is actually reachable.
   *
   * Workspace HTML previews are served from the loopback counterpart of the host the App
   * is used on (`127.0.0.1` <-> `localhost`). On most systems `localhost` resolves to
   * `::1` first, so a server bound only to `127.0.0.1` would leave every preview URL
   * refusing connections. Binding `::1` as well closes that gap. Failure is non-fatal —
   * the App keeps working, previews just fall back.
   *
   * Takes the ACTUAL bound port rather than resolving the configured one again: with
   * PORT=0 both listeners resolving 0 independently would land on two different ports and
   * every preview URL (same port, counterpart host) would refuse connections.
   */
  private openIpv6Loopback(port: number): void {
    const loopback = serve({ fetch: this.app.fetch, hostname: "::1", port });
    this.ipv6Loopback = loopback;
    loopback.on("error", (err: NodeJS.ErrnoException) => {
      console.warn(
        `[server] IPv6 loopback listener unavailable (${err.code ?? err.message}); previews via localhost may not resolve.`,
      );
    });
    // The terminal stream is a WebSocket upgrade, which never reaches the Hono fetch
    // handler — it has to be bound on each Node listener, this one included, or the
    // terminal only works on whichever address the browser happened to resolve.
    attachTerminalWebSocket(loopback as unknown as HttpServer, this.terminalWebSocketDeps());
  }

  /** Terminal WebSocket wiring, shared by every listener this process opens. */
  private terminalWebSocketDeps() {
    return {
      hmr: this.deps.hmr,
      authService: this.auth(),
      log: (line: string) => console.log(line),
    };
  }

  /**
   * Graceful shutdown, idempotent across every path that can trigger it: interrupt all
   * active runs (pending approvals converge to deny), wait ≤5s for wrap-up, then close
   * HTTP and SQLite.
   */
  /**
   * `exitCode` undefined leaves the code to `process.exitCode`: the platform's restart step
   * presets core's SERVER_RESTART_EXIT_CODE there and raises SIGTERM, so this same shutdown
   * is how the process leaves for its supervisor to relaunch (services/process-restart.ts).
   */
  private async shutdown(signal: string, exitCode?: number): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    console.log(`Received ${signal}, shutting down…`);
    // The CURRENT App's graceful drain (manager: interrupt runs, deny approvals, wait ≤5s
    // for wrap-up) — through the instance the host holds, which a hot swap keeps current;
    // no registry pointer needed.
    await (await this.deps.hmr.ensure()).api.shutdown();
    // Plugin disposables: async-capable and awaited HERE — the one exit path that can
    // await — under the same ≤5s convention as the manager's wrap-up above. The registry
    // sweep below would only fire them without awaiting. Idempotent, so the sweep's
    // fallback firing right after is a no-op.
    await Promise.race([
      this.plugins.dispose(),
      new Promise<void>((resolve) => setTimeout(resolve, 5000).unref()),
    ]);
    // Disposing the host drains the App's effects (scheduler stop, manager hard-stop) and
    // sweeps the resource registry (live ptys).
    this.deps.hmr.dispose();
    this.deps.channels.dispose();
    this.ipv6Loopback?.close();
    this.httpServer.close(() => {
      this.deps.db.close();
      this.cleanupInstanceFiles();
      process.exit(exitCode);
    });
    // Fallback: a long-lived SSE connection may block the close callback, so force exit after 1s.
    setTimeout(() => {
      this.cleanupInstanceFiles();
      process.exit(exitCode);
    }, 1000).unref();
  }

  /** Removes the instance lock and port file (best-effort; runs on both exit paths). */
  private cleanupInstanceFiles(): void {
    releaseServerLock(this.config.root);
    if (this.config.portFile === null) return;
    try {
      fs.rmSync(this.config.portFile, { force: true });
    } catch {
      // Best-effort: a stale port file is rewritten by the next server.
    }
  }
}

/** Exit code for "another server already owns this data root" (see lock.ts). */
const EXIT_ALREADY_RUNNING = 3;

/** Port announcement (PENGUIN_PORT_FILE): tmp + rename, so a polling reader never sees a partial write. */
function writePortFile(file: string, port: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${port}\n`);
  fs.renameSync(tmp, file);
}

// Runs on import, which is what starting this server means. It is the last line of the
// file because main() reaches PenguinServer, whose declaration has to have been evaluated
// by the time the call happens.
await main();
