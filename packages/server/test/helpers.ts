/**
 * Test helpers: a temp directory root + an in-memory DB (":memory:") + injecting
 * requests via app.request() + building Trace files.
 * None of these tests listen on a port or make real LLM requests.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import type { OmniMessage } from "@prismshadow/penguin-core";
import { bootAppDeps, createRuntimeApp } from "../src/app.js";
import type { AppDeps, BuildDepsOverrides } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { TraceIndexRepo } from "../src/db/repos/trace-index.js";
import { SessionSources } from "../src/runtime/session-sources.js";
import { TraceIndexService } from "../src/services/trace-index.js";
import { TraceService } from "../src/services/trace-service.js";
import type { TraceSessionIndex } from "../src/services/trace-service.js";
import type { AppEnv } from "../src/auth/middleware.js";
import { ADMIN_USER_ID } from "../src/auth/service.js";
import type { ServerConfig } from "../src/config.js";
import type { UserInfo } from "../src/api/types.js";

export async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "penguin-server-test-"));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fixed seeded-admin password injected into every test app (in production the seed generates a random one). */
export const TEST_ADMIN_PASSWORD = "penguin-0000";

/**
 * scrypt work factor for test apps: the lowest legal one. Nearly every case here seeds an
 * admin, provisions users and logs them in, and at production strength those derivations
 * cost more than everything else the suite does combined. The stored format, the recorded
 * parameters and the verification path are unchanged — only the derivation is cheap — and
 * the production strength itself is asserted in password.test.ts, which uses the default.
 */
const TEST_PASSWORD_HASH_COST = 2;

export function testConfig(root: string): ServerConfig {
  return {
    root,
    host: "127.0.0.1",
    // Nothing listens in tests, but the value is not inert: preview URLs are built from
    // the server's own port, so keep it realistic rather than 0.
    port: 7364,
    dbPath: ":memory:",
    previewOrigin: null,
    // Points to a nonexistent directory: static hosting is disabled in tests.
    webDist: path.join(root, "__no_web_dist__"),
    // Fixed seed password so loginAdmin needs no seed-time capture.
    seedAdminPassword: TEST_ADMIN_PASSWORD,
    authSessionTtlMs: 30 * DAY_MS,
    authSessionRenewMs: 29 * DAY_MS,
    desktopToken: null,
    portFile: null,
    trustProxy: false,
  };
}

export interface TestApp {
  app: Hono<AppEnv>;
  deps: AppDeps;
  root: string;
  /** Initial password of the seeded admin (TEST_ADMIN_PASSWORD unless overridden via `config.seedAdminPassword`). */
  adminPassword: string;
  cleanup(): Promise<void>;
}

export interface TestAppOptions extends BuildDepsOverrides {
  /** Runs before seeding the admin (for scenarios pre-populating a default_project config as the CLI would). */
  beforeSeed?: (root: string) => Promise<void>;
  /** Overrides merged onto the default test ServerConfig (e.g. `previewOrigin`). */
  config?: Partial<ServerConfig>;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const { beforeSeed, config, ...overrides } = options;
  const root = await makeTempRoot();
  if (beforeSeed) await beforeSeed(root);
  const finalConfig = { ...testConfig(root), ...config };
  const deps = await bootAppDeps(finalConfig, {
    log: () => {},
    passwordHashCost: TEST_PASSWORD_HASH_COST,
    ...overrides,
  });
  // Consistent with the startup entrypoint: seed the built-in admin (owning default_project).
  await deps.authService.seedAdmin();
  // The seed hashes and discards; tests know the password only because the config injects it.
  // With a null override there is nothing to know, and such tests never password-login.
  const adminPassword = finalConfig.seedAdminPassword ?? TEST_ADMIN_PASSWORD;
  const app = createRuntimeApp(deps);
  return {
    app,
    deps,
    root,
    adminPassword,
    cleanup: async () => {
      // Terminals are real child processes owned by the platform: disposing the hot host
      // sweeps its resource registry, which is where every live pty is registered.
      deps.hmr.dispose();
      deps.channels.dispose();
      deps.db.close();
      // maxRetries: Windows can report ENOTEMPTY/EBUSY while handles from the test's own
      // just-closed files (SQLite, trace writers) are still being released — Node's rm
      // retries these codes with a delay. A plain rm was the top cause of ci-windows
      // cascades (cleanup throws → hook timeout → "database is not open" in later files).
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}

/** The desktop-mode fixture token (see createDesktopApp). */
export const TEST_DESKTOP_TOKEN = "test-desktop-token";

/** A test app running in desktop mode (desktop.test.ts, desktop-update.test.ts). */
export function createDesktopApp(): Promise<TestApp> {
  return createTestApp({ config: { desktopToken: TEST_DESKTOP_TOKEN } });
}

/** Redeems the shell's one-shot token for a `sessionVia: "desktop"` cookie. */
export async function desktopLoginCookie(app: Hono<AppEnv>): Promise<string> {
  const res = await app.request(`/api/auth/claim?token=${TEST_DESKTOP_TOKEN}`);
  if (res.status !== 302) {
    throw new Error(`Desktop login failed: ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("Desktop login response is missing set-cookie");
  return setCookie.split(";")[0]!;
}

/** Logs in and returns the session cookie (`penguin_session=...`). */
export async function loginUser(
  app: Hono<AppEnv>,
  userId: string,
  password: string,
): Promise<{ cookie: string; user: UserInfo }> {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, password }),
  });
  if (res.status !== 200) {
    throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("Login response is missing set-cookie");
  const body = (await res.json()) as { user: UserInfo };
  return { cookie: setCookie.split(";")[0]!, user: body.user };
}

/** Logs in as the seeded admin (every test app seeds with TEST_ADMIN_PASSWORD). */
export function loginAdmin(app: Hono<AppEnv>): Promise<{ cookie: string; user: UserInfo }> {
  return loginUser(app, ADMIN_USER_ID, TEST_ADMIN_PASSWORD);
}

/** Admin creates the account and logs in as that user (the only way to create test users while registration is closed). */
export async function provisionUser(
  app: Hono<AppEnv>,
  userId: string,
  password = "password-123",
): Promise<{ cookie: string; user: UserInfo }> {
  if (userId === ADMIN_USER_ID) return loginAdmin(app);
  const admin = await loginAdmin(app);
  const res = await apiClient(app, admin.cookie).post("/api/admin/users", { userId, password });
  if (res.status !== 201) {
    throw new Error(`Account creation failed: ${res.status} ${await res.text()}`);
  }
  return loginUser(app, userId, password);
}

/** JSON request client that carries the cookie. */
export function apiClient(app: Hono<AppEnv>, cookie: string) {
  const call = (method: string) => (apiPath: string, body?: unknown) =>
    app.request(apiPath, {
      method,
      headers: {
        cookie,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  return {
    get: (apiPath: string) => app.request(apiPath, { headers: { cookie } }),
    post: call("POST"),
    put: call("PUT"),
    patch: call("PATCH"),
    delete: call("DELETE"),
  };
}

/**
 * Index-backed TraceService for pure service tests: an in-memory DB with the real
 * schema, a real reconciler over the temp root, and a shared origin registry — the
 * same wiring app.ts assembles, minus the HTTP app.
 */
export function makeTraceHarness(
  root: string,
  opts: { sessions?: TraceSessionIndex; sources?: SessionSources } = {},
): {
  traceIndex: TraceIndexService;
  service: TraceService;
  sources: SessionSources;
  /** Paths of every Trace shard the service read from disk (windowed-read IO assertions); reset freely between calls. */
  shardReads: string[];
  close: () => void;
} {
  const db = openDatabase(":memory:");
  const sources = opts.sources ?? new SessionSources();
  const traceIndex = new TraceIndexService(root, new TraceIndexRepo(db), sources);
  const shardReads: string[] = [];
  const service = new TraceService(root, {
    index: traceIndex,
    ...(opts.sessions !== undefined ? { sessions: opts.sessions } : {}),
    sources,
    observeShardRead: (p) => shardReads.push(p),
  });
  return { traceIndex, service, sources, shardReads, close: () => db.close() };
}

/** Writes a Trace JSONL file directly (for building historical / discovery scenarios). */
export async function writeTraceFile(
  root: string,
  projectId: string,
  agentId: string,
  dateDir: string,
  sessionId: string,
  index: number,
  messages: OmniMessage[],
): Promise<string> {
  const dir = path.join(root, projectId, "agents", agentId, "traces", dateDir);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}_${String(index).padStart(3, "0")}.jsonl`);
  await fs.writeFile(file, messages.map((m) => JSON.stringify(m)).join("\n") + "\n", "utf8");
  return file;
}

/** Simple wait: until the condition is true or it times out. */
export async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}
