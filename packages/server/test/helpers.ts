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
import type { ServerBoot } from "../src/app.js";
import type { ModuleTree } from "@prismshadow/penguin-core/kernel";
import type { DatabaseSync } from "node:sqlite";
import type { HmrHost } from "../src/hmr/host.js";
import type { ChannelHub } from "../src/runtime/channel.js";
import type { DesktopService } from "../src/services/desktop-service.js";
import type { AuthService } from "../src/auth/service.js";
import type { AdminService } from "../src/services/admin-service.js";
import type { ProjectService } from "../src/services/project-service.js";
import type { ProjectAccess } from "../src/services/project-access.js";
import type { ProjectConfigService } from "../src/services/project-config-service.js";
import type { ModelOAuthService } from "../src/services/model-oauth-service.js";
import type { AgentService } from "../src/services/agent-service.js";
import type { AgentConfigService } from "../src/services/agent-config-service.js";
import type { MemoryService } from "../src/services/memory-service.js";
import type { SessionService } from "../src/services/session-service.js";
import type { UsageService } from "../src/services/usage-service.js";
import type { WorkspaceFilesService } from "../src/services/workspace-files-service.js";
import type { PreviewTokenSigner } from "../src/services/preview-token.js";
import type { BenchmarkService } from "../src/services/benchmark-service.js";
import type { SnapshotService } from "../src/services/snapshot-service.js";
import type { SessionsRepo } from "../src/db/repos/sessions.js";
import type { UiPrefsRepo } from "../src/db/repos/ui-prefs.js";
import type { ServerSettingsRepo } from "../src/db/repos/server-settings.js";
import type { SchedulesRepo } from "../src/db/repos/schedules.js";
import type { ErrorsRepo } from "../src/db/repos/errors.js";
import type { MessagingBindingsRepo } from "../src/db/repos/messaging-bindings.js";
import type { MessagingBridge } from "../src/runtime/messaging/bridge.js";
import type { QQScanService } from "../src/runtime/messaging/qq-scan.js";
import type { Scheduler } from "../src/runtime/scheduler.js";
import type { SessionManager } from "../src/runtime/session-manager.js";
import type { ErrorRecorder } from "../src/runtime/error-recorder.js";
import type { MachinesService } from "../src/machines/service.js";
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
import { wire } from "@prismshadow/penguin-core/kernel";
import type { ModuleClass } from "@prismshadow/penguin-core/kernel";
import type { Replacements } from "../src/hmr/capabilities.js";
import { ConsoleLog, SystemClock } from "../src/hmr/capabilities.js";
import { hashPassword, ScryptHasher } from "../src/auth/password.js";
import { CoreSessionLoaders, DefaultTitleGenerators } from "../src/runtime/session-manager.js";
import type { SessionLoader } from "../src/runtime/session-manager.js";
import type { TitleNotifier } from "../src/runtime/title-generator.js";
import { UpdateCheckService } from "../src/services/update-check-service.js";
import { DefaultMessagingTuning } from "../src/runtime/messaging/bridge.js";
import { FeishuSdkProvider } from "../src/runtime/messaging/feishu-connector.js";
import type { FeishuSdk } from "../src/runtime/messaging/feishu-sdk.js";
import { TelegramTransportProvider } from "../src/runtime/messaging/telegram-connector.js";
import type { TelegramTransport } from "../src/runtime/messaging/telegram-api.js";
import { QQTransportProvider } from "../src/runtime/messaging/qq-connector.js";
import type { QQTransport } from "../src/runtime/messaging/qq-api.js";
import { QQScanTransportProvider } from "../src/runtime/messaging/qq-scan.js";
import { WeChatTransportProvider } from "../src/runtime/messaging/wechat-connector.js";
import type { WeChatTransport } from "../src/runtime/messaging/wechat-api.js";
import { WeChatScanTransportProvider } from "../src/runtime/messaging/wechat-scan.js";
import type { WeChatScanTransport } from "../src/runtime/messaging/wechat-scan.js";
import type { QQScanTransport } from "../src/runtime/messaging/qq-scan.js";
import { MachinesModule } from "../src/machines/service.js";
import { machinesRoutes } from "../src/http/routes/machines.js";

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
    supervised: false,
  };
}

/**
 * The module tree, flattened under the names tests have always used. Production has no
 * such object — a module names what it needs in its manifest — but a test reaches into
 * any service directly, and this view is the one place that maps the old names.
 */
export interface TestDeps {
  config: ServerConfig;
  db: DatabaseSync;
  hmr: HmrHost;
  channels: ChannelHub;
  desktop: DesktopService | null;
  tree: ModuleTree;
  sessionsRepo: SessionsRepo;
  prefsRepo: UiPrefsRepo;
  serverSettingsRepo: ServerSettingsRepo;
  authService: AuthService;
  adminService: AdminService;
  projectService: ProjectService;
  access: ProjectAccess;
  projectConfigService: ProjectConfigService;
  modelOAuth: ModelOAuthService;
  agentService: AgentService;
  agentConfigService: AgentConfigService;
  memoryService: MemoryService;
  sessionService: SessionService;
  traceService: TraceService;
  traceIndex: TraceIndexService;
  usageService: UsageService;
  updateCheck: UpdateCheckService;
  workspaceFiles: WorkspaceFilesService;
  previewTokens: PreviewTokenSigner;
  benchmarks: BenchmarkService;
  snapshots: SnapshotService;
  schedulesRepo: SchedulesRepo;
  errorsRepo: ErrorsRepo;
  messagingRepo: MessagingBindingsRepo;
  messaging: MessagingBridge;
  qqScan: QQScanService;
  scheduler: Scheduler;
  manager: SessionManager;
  sessionSources: SessionSources;
  errors: ErrorRecorder;
  machines: MachinesService;
}

export function flattenForTests(boot: ServerBoot): TestDeps {
  const { tree } = boot;
  const api = <T>(module: string, alias: string): T => tree.api<T>(module, alias);
  return {
    config: boot.config,
    db: boot.db,
    hmr: boot.hmr,
    channels: boot.channels,
    desktop: boot.desktop,
    tree,
    sessionsRepo: api("SessionsRepo", "SessionsRepo"),
    prefsRepo: api("UiPrefsRepo", "UiPrefsRepo"),
    serverSettingsRepo: api("ServerSettingsRepo", "ServerSettingsRepo"),
    authService: api("AuthService", "AuthService"),
    adminService: api("AdminService", "AdminService"),
    projectService: api("ProjectService", "ProjectService"),
    access: api("ProjectAccess", "ProjectAccess"),
    projectConfigService: api("ProjectConfigService", "ProjectConfigService"),
    modelOAuth: api("ModelOAuthService", "ModelOAuthService"),
    agentService: api("AgentService", "AgentService"),
    agentConfigService: api("AgentConfigService", "AgentConfigService"),
    memoryService: api("MemoryService", "MemoryService"),
    sessionService: api("SessionsModule", "sessionService"),
    traceService: api("TraceService", "TraceService"),
    traceIndex: api("TraceIndexService", "TraceIndexService"),
    usageService: api("UsageService", "UsageService"),
    updateCheck: api("UpdateCheckService", "UpdateCheckService"),
    workspaceFiles: api("WorkspaceFilesService", "WorkspaceFilesService"),
    previewTokens: api("WorkspaceModule", "previewTokens"),
    benchmarks: api("BenchmarkService", "BenchmarkService"),
    snapshots: api("SnapshotService", "SnapshotService"),
    schedulesRepo: api("SchedulesRepo", "SchedulesRepo"),
    errorsRepo: api("ErrorsRepo", "ErrorsRepo"),
    messagingRepo: api("MessagingBindingsRepo", "MessagingBindingsRepo"),
    messaging: api("MessagingModule", "messaging"),
    qqScan: api("MessagingModule", "qqScan"),
    scheduler: api("Scheduler", "Scheduler"),
    manager: api("SessionsModule", "manager"),
    sessionSources: api("SessionSources", "SessionSources"),
    errors: api("ErrorRecorder", "ErrorRecorder"),
    machines: api("MachinesModule", "machines"),
  };
}

export interface TestApp {
  app: Hono<AppEnv>;
  deps: TestDeps;
  root: string;
  /** Initial password of the seeded admin (TEST_ADMIN_PASSWORD unless overridden via `config.seedAdminPassword`). */
  adminPassword: string;
  cleanup(): Promise<void>;
}

/**
 * What a test stands in for, by the name it has always used; each becomes a node
 * Replacement (the platform boots the given instance instead of the class it names).
 */
export interface TestAppOptions {
  /** Test double: session-manager's underlying loader (avoids the real LLM/SDK path). */
  loader?: SessionLoader;
  /** Test double: Session title generator (avoids real LLM requests). */
  titles?: TitleNotifier;
  /** Test double: update-check service with a stubbed fetch/clock (avoids real network calls). */
  updateCheck?: UpdateCheckService;
  /** Test double: the Feishu connector's SDK (avoids real Lark network / long connections). */
  feishuSdk?: FeishuSdk;
  /** Test double: the Telegram connector's Bot API transport. */
  telegramTransport?: TelegramTransport;
  /** Test hook: the Telegram connector's poll backoff (tests collapse it to zero). */
  telegramRetryDelayMs?: (failures: number) => number;
  /** Test double: the QQ connector's OpenAPI + gateway transport. */
  qqTransport?: QQTransport;
  /** Test hook: how long the QQ connector withholds its coalesced tail. */
  qqTailFlushMs?: number;
  /** Test hook: the bridge's pace between a per-line reply's messages. */
  messagingLineDelayMs?: number;
  /** Test hook: one binding's inbound image budget. */
  messagingInboundImageBudgetBytes?: number;
  /** Test double: the QQ scan-to-connect transport. */
  qqScanTransport?: QQScanTransport;
  /** Test double: the WeChat connector's long-poll + CDN transport. */
  wechatTransport?: WeChatTransport;
  /** Test double: the WeChat scan-to-connect transport. */
  wechatScanTransport?: WeChatScanTransport;
  /** Test hook: the WeChat poll loop's backoff (tests collapse it to zero). */
  wechatRetryDelayMs?: (failures: number) => number;
  /** Test double: machines service whose ssh effects are faked. */
  machines?: MachinesService;
  /** Test double: the password work factor (scrypt at full strength is seconds per hash). */
  passwordHashCost?: number;
  log?: (line: string) => void;
  now?: () => Date;
  /** Runs before seeding the admin (for scenarios pre-populating a default_project config as the CLI would). */
  beforeSeed?: (root: string) => Promise<void>;
  /** Overrides merged onto the default test ServerConfig (e.g. `previewOrigin`). */
  config?: Partial<ServerConfig>;
}

/** The node each option stands in for. */
export function replacementsFor(o: TestAppOptions): Replacements {
  const out: Array<readonly [ModuleClass, object]> = [];
  if (o.log) out.push([ConsoleLog, { line: o.log }]);
  if (o.now) out.push([SystemClock, { now: o.now }]);
  if (o.passwordHashCost !== undefined) {
    const cost = o.passwordHashCost;
    out.push([ScryptHasher, { hash: (password: string) => hashPassword(password, cost) }]);
  }
  if (o.loader) {
    const loader = o.loader;
    out.push([CoreSessionLoaders, { create: () => loader }]);
  }
  if (o.titles) {
    const titles = o.titles;
    out.push([DefaultTitleGenerators, { create: () => titles }]);
  }
  if (o.updateCheck) out.push([UpdateCheckService, o.updateCheck]);
  if (o.feishuSdk) out.push([FeishuSdkProvider, { feishuSdk: { sdk: o.feishuSdk } }]);
  if (o.telegramTransport)
    out.push([
      TelegramTransportProvider,
      { telegramTransport: { transport: o.telegramTransport } },
    ]);
  if (o.qqTransport) out.push([QQTransportProvider, { qqTransport: { transport: o.qqTransport } }]);
  if (o.qqScanTransport)
    out.push([QQScanTransportProvider, { qqScanTransport: { transport: o.qqScanTransport } }]);
  if (o.wechatTransport)
    out.push([WeChatTransportProvider, { wechatTransport: { transport: o.wechatTransport } }]);
  if (o.wechatScanTransport)
    out.push([
      WeChatScanTransportProvider,
      { wechatScanTransport: { transport: o.wechatScanTransport } },
    ]);
  const tuning: Record<string, unknown> = {};
  if (o.messagingLineDelayMs !== undefined) tuning.lineDelayMs = o.messagingLineDelayMs;
  if (o.messagingInboundImageBudgetBytes !== undefined)
    tuning.inboundImageBudgetBytes = o.messagingInboundImageBudgetBytes;
  if (o.qqTailFlushMs !== undefined) tuning.qqTailFlushMs = o.qqTailFlushMs;
  if (o.telegramRetryDelayMs) tuning.retryDelayMs = o.telegramRetryDelayMs;
  if (o.wechatRetryDelayMs) tuning.retryDelayMs = o.wechatRetryDelayMs;
  if (Object.keys(tuning).length > 0) out.push([DefaultMessagingTuning, tuning]);
  if (o.machines) {
    const machines = o.machines;
    out.push([MachinesModule, { machines, routes: machinesRoutes({ machines }) }]);
  }
  return out;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const { beforeSeed, config, ...overrides } = options;
  const root = await makeTempRoot();
  if (beforeSeed) await beforeSeed(root);
  const finalConfig = { ...testConfig(root), ...config };
  const boot = await bootAppDeps(
    finalConfig,
    replacementsFor({
      log: () => {},
      passwordHashCost: TEST_PASSWORD_HASH_COST,
      // The bridge's per-line pace is a real wait in production; every test but the one
      // about the pacing itself collapses it to nothing.
      messagingLineDelayMs: 0,
      ...overrides,
    }),
  );
  // Consistent with the startup entrypoint: seed the built-in admin (owning default_project).
  const deps = flattenForTests(boot);
  await deps.authService.seedAdmin();
  // The seed hashes and discards; tests know the password only because the config injects it.
  // With a null override there is nothing to know, and such tests never password-login.
  const adminPassword = finalConfig.seedAdminPassword ?? TEST_ADMIN_PASSWORD;
  const app = createRuntimeApp(boot);
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

/** The `name=value` cookie pair from a response's Set-Cookie (the shape apiClient wants). */
export function cookieFrom(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
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
  const repo = wire(TraceIndexRepo, { db });
  const traceIndex = wire(TraceIndexService, { paths: { root }, repo, sources });
  const shardReads: string[] = [];
  const service = wire(TraceService, {
    paths: { root },
    index: traceIndex,
    store: repo,
    ...(opts.sessions !== undefined ? { sessions: opts.sessions } : {}),
    sources,
    observeShardRead: (p: string) => shardReads.push(p),
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
