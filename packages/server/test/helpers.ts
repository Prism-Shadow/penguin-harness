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
import { buildAppDeps, createApp } from "../src/app.js";
import type { AppDeps, BuildDepsOverrides } from "../src/app.js";
import type { AppEnv } from "../src/auth/middleware.js";
import { ADMIN_INITIAL_PASSWORD, ADMIN_USER_ID } from "../src/auth/service.js";
import type { ServerConfig } from "../src/config.js";
import type { UserInfo } from "../src/api/types.js";

export async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "penguin-server-test-"));
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function testConfig(root: string): ServerConfig {
  return {
    root,
    host: "127.0.0.1",
    port: 0,
    dbPath: ":memory:",
    // Points to a nonexistent directory: static hosting is disabled in tests.
    webDist: path.join(root, "__no_web_dist__"),
    authSessionTtlMs: 7 * DAY_MS,
    authSessionRenewMs: 6 * DAY_MS,
  };
}

export interface TestApp {
  app: Hono<AppEnv>;
  deps: AppDeps;
  root: string;
  cleanup(): Promise<void>;
}

export interface TestAppOptions extends BuildDepsOverrides {
  /** Runs before seeding the admin (for scenarios pre-populating a default_project config as the CLI would). */
  beforeSeed?: (root: string) => Promise<void>;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const { beforeSeed, ...overrides } = options;
  const root = await makeTempRoot();
  if (beforeSeed) await beforeSeed(root);
  const deps = buildAppDeps(testConfig(root), { log: () => {}, ...overrides });
  // Consistent with the startup entrypoint: seed the built-in admin (owning default_project).
  await deps.authService.seedAdmin();
  const app = createApp(deps);
  return {
    app,
    deps,
    root,
    cleanup: async () => {
      deps.channels.dispose();
      deps.db.close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
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
    throw new Error(`登录失败: ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("登录响应缺少 set-cookie");
  const body = (await res.json()) as { user: UserInfo };
  return { cookie: setCookie.split(";")[0]!, user: body.user };
}

/** Logs in as the seeded admin. */
export function loginAdmin(app: Hono<AppEnv>): Promise<{ cookie: string; user: UserInfo }> {
  return loginUser(app, ADMIN_USER_ID, ADMIN_INITIAL_PASSWORD);
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
    throw new Error(`建号失败: ${res.status} ${await res.text()}`);
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
  const dir = path.join(root, projectId, agentId, "traces", dateDir);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}_${String(index).padStart(3, "0")}.jsonl`);
  await fs.writeFile(file, messages.map((m) => JSON.stringify(m)).join("\n") + "\n", "utf8");
  return file;
}

/** Simple wait: until the condition is true or it times out. */
export async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor 超时");
    await new Promise((r) => setTimeout(r, 5));
  }
}
