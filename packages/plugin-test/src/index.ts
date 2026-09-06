/**
 * @prismshadow/penguin-plugin-test — integration testing for PenguinHarness plugins.
 *
 * The idea is `@vscode/test-electron`'s: start the REAL host with the plugin under
 * development installed, and run the tests against that. Here the host is the server —
 * `@prismshadow/penguin-server`'s built entry, started as a child process on a scratch data
 * root whose `plugins.json` lists the plugin — so what a test exercises is the same path a
 * deployment takes: the loader resolves the package, reads its manifests, pairs them with
 * its code, and boots its modules into the platform tree. Nothing is assembled in-process
 * and nothing is mocked in the host.
 *
 *   const harness = await startHarness({ plugins: [pluginDir] });
 *   const api = await harness.login();
 *   const { plugins } = await api.get("/api/plugins/installed");
 *   …
 *   await harness.stop();
 *
 * A plugin is named by its package directory (its `main` must be built) or by a specifier
 * the server can resolve on its own. The listing writes the entry file's absolute path,
 * which the loader imports directly and walks up from to find `package.json#penguin`.
 *
 * A development dependency: it ships with no build of the harness.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

export interface StartHarnessOptions {
  /**
   * The plugins to install: absolute package directories (their `main` is what gets
   * listed; build the package first) or package specifiers the server resolves itself.
   */
  plugins: readonly string[];
  /** The data root; default a fresh temporary directory, removed by `stop()`. */
  root?: string;
  /** Environment for the server process, over this process's own (`PENGUIN_CLAUDE_BIN`, proxies, …). */
  env?: Record<string, string>;
  /** The server entry to run; default `@prismshadow/penguin-server`'s built `dist/index.js`. */
  serverEntry?: string;
  /** A built Web App to serve, for browser-level tests; absent serves the API alone. */
  webDist?: string;
  /** A fixed port; default a free one. */
  port?: number;
  /** The seeded admin's password; default a constant, the same for every harness. */
  adminPassword?: string;
  /** How long to wait for the server to answer; default 30 s. */
  readyTimeoutMs?: number;
  /** Server output, line by line (stdout and stderr); default kept for `stop()`'s error. */
  log?: (line: string) => void;
  /** Keep the temporary data root after `stop()`, for a look at what the server wrote. */
  keepRoot?: boolean;
}

export const DEFAULT_ADMIN_PASSWORD = "penguin-plugin-test";
const READY_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 10_000;

/** Thrown by `HarnessApi` on a non-2xx answer, with what the server said. */
export class HarnessApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: unknown,
  ) {
    super(
      `${method} ${path} → ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`,
    );
    this.name = "HarnessApiError";
  }
}

/** A signed-in client: JSON in, JSON out, the session cookie carried along. */
export class HarnessApi {
  private cookie: string | null = null;

  constructor(readonly baseUrl: string) {}

  /** POST /api/auth/login; the cookie it answers with is sent on every later call. */
  async login(userId: string, password: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, password }),
    });
    if (!res.ok) {
      throw new HarnessApiError(res.status, "POST", "/api/auth/login", await res.text());
    }
    const cookie = res.headers.get("set-cookie");
    if (cookie === null) throw new Error("login answered without a session cookie");
    this.cookie = cookie.split(";", 1)[0]!;
  }

  /** The raw request, cookie attached; the caller reads the Response. */
  async request(method: string, apiPath: string, body?: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}${apiPath}`, {
      method,
      headers: {
        ...(this.cookie === null ? {} : { cookie: this.cookie }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  /** A request whose answer must be 2xx; parsed as JSON when there is a body. */
  async call<T>(method: string, apiPath: string, body?: unknown): Promise<T> {
    const res = await this.request(method, apiPath, body);
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text === "" ? undefined : JSON.parse(text);
    } catch {
      // Not JSON: the text stands.
    }
    if (!res.ok) throw new HarnessApiError(res.status, method, apiPath, parsed);
    return parsed as T;
  }

  get<T>(apiPath: string): Promise<T> {
    return this.call<T>("GET", apiPath);
  }
  post<T>(apiPath: string, body?: unknown): Promise<T> {
    return this.call<T>("POST", apiPath, body ?? {});
  }
  put<T>(apiPath: string, body?: unknown): Promise<T> {
    return this.call<T>("PUT", apiPath, body ?? {});
  }
  patch<T>(apiPath: string, body?: unknown): Promise<T> {
    return this.call<T>("PATCH", apiPath, body ?? {});
  }
  delete<T = void>(apiPath: string): Promise<T> {
    return this.call<T>("DELETE", apiPath);
  }

  /**
   * A terminal the server holds, by id: its screen as text and keys into it — the two
   * primitives a pty-backed surface's test needs (GET …/capture, POST …/keys).
   */
  terminal(terminalId: string) {
    const base = `/api/terminals/${encodeURIComponent(terminalId)}`;
    return {
      info: () => this.get<{ id: string; alive: boolean; cwd: string; name: string }>(base),
      /** The screen's lines, top to bottom; a line the program never wrote is empty. */
      capture: async () => (await this.get<{ lines: string[] }>(`${base}/capture`)).lines,
      /** Text as typed; `literal` sends it byte for byte instead of parsing key tokens. */
      keys: (keys: string, literal = false) =>
        this.post<{ ok: true }>(`${base}/keys`, { keys, literal }),
    };
  }
}

/** What `GET /api/plugins/installed` lists for one plugin, as far as a test reads it. */
export interface InstalledPluginRow {
  specifier: string;
  active: boolean;
  builtin: boolean;
  modules: string[];
  replaces: string[];
  error?: string;
}

export interface Harness {
  readonly baseUrl: string;
  readonly port: number;
  /** The data root the server runs on. */
  readonly root: string;
  readonly admin: { userId: string; password: string };
  /** The plugin specifiers as `plugins.json` lists them (entry paths for directory plugins). */
  readonly plugins: readonly string[];
  /** A client signed in as the seeded admin. */
  login(): Promise<HarnessApi>;
  /** A client signed in as this user (the caller created them, or it is the admin). */
  loginAs(userId: string, password: string): Promise<HarnessApi>;
  /** `GET /api/plugins/installed`, as the admin. */
  installedPlugins(): Promise<InstalledPluginRow[]>;
  /** The server's output so far, line by line. */
  output(): readonly string[];
  /** Stops the server and, unless `keepRoot`, removes a temporary data root. */
  stop(): Promise<void>;
}

/** Resolves a plugin option to what `plugins.json` should list. */
export async function resolvePluginEntry(plugin: string): Promise<string> {
  if (!path.isAbsolute(plugin)) return plugin;
  const manifestFile = path.join(plugin, "package.json");
  let manifest: { name?: string; main?: string; exports?: unknown };
  try {
    manifest = JSON.parse(await fs.readFile(manifestFile, "utf8")) as typeof manifest;
  } catch (err) {
    throw new Error(
      `plugin '${plugin}' is not a package directory (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  const main = manifest.main ?? entryFromExports(manifest.exports);
  if (main === undefined) {
    throw new Error(
      `plugin '${manifest.name ?? plugin}' names no entry (package.json main/exports)`,
    );
  }
  const entry = path.resolve(plugin, main);
  try {
    await fs.access(entry);
  } catch {
    throw new Error(
      `plugin '${manifest.name ?? plugin}': entry ${entry} does not exist — build the package first`,
    );
  }
  return entry;
}

function entryFromExports(exportsField: unknown): string | undefined {
  if (typeof exportsField === "string") return exportsField;
  if (typeof exportsField !== "object" || exportsField === null) return undefined;
  const dot = (exportsField as Record<string, unknown>)["."] ?? exportsField;
  if (typeof dot === "string") return dot;
  if (typeof dot === "object" && dot !== null) {
    const d = dot as Record<string, unknown>;
    for (const key of ["import", "default"])
      if (typeof d[key] === "string") return d[key] as string;
  }
  return undefined;
}

/** The server entry: what `@prismshadow/penguin-server` resolves to from here — its built `dist/index.js`, which starts the server when run. */
export function defaultServerEntry(): string {
  // Found the way Node finds a package — the nearest node_modules holding it, walking up
  // from this file — and read from its own manifest, because the package exports its
  // entry under `import` only, which neither `require.resolve` nor a test runner's
  // transformed `import.meta` can resolve for a path.
  const segments = ["@prismshadow", "penguin-server"];
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = path.join(dir, "node_modules", ...segments);
    const manifestFile = path.join(candidate, "package.json");
    if (existsSync(manifestFile)) {
      const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as {
        main?: string;
        exports?: unknown;
      };
      const entry = entryFromExports(manifest.exports) ?? manifest.main ?? "dist/index.js";
      return path.resolve(candidate, entry);
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        "@prismshadow/penguin-server is not installed beside @prismshadow/penguin-plugin-test",
      );
    }
    dir = parent;
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Starts the server with the plugins installed and waits until it answers. The data root
 * carries only what the server writes; the plugins are listed, never copied.
 */
export async function startHarness(options: StartHarnessOptions): Promise<Harness> {
  const plugins = await Promise.all(options.plugins.map(resolvePluginEntry));
  const serverEntry = options.serverEntry ?? defaultServerEntry();
  try {
    await fs.access(serverEntry);
  } catch {
    throw new Error(
      `server entry ${serverEntry} does not exist — build @prismshadow/penguin-server first`,
    );
  }
  const temporary = options.root === undefined;
  const root = options.root ?? (await fs.mkdtemp(path.join(os.tmpdir(), "penguin-plugin-test-")));
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    path.join(root, "plugins.json"),
    `${JSON.stringify({ plugins }, null, 2)}\n`,
    "utf8",
  );
  const port = options.port ?? (await freePort());
  const adminPassword = options.adminPassword ?? DEFAULT_ADMIN_PASSWORD;
  // localhost, not 127.0.0.1: the server canonicalizes the App onto localhost and keeps
  // 127.0.0.1 as the Workspace-preview host, where /api answers 401.
  const baseUrl = `http://localhost:${port}`;
  const output: string[] = [];
  const log = options.log ?? ((line: string) => void output.push(line));

  const child: ChildProcess = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      PENGUIN_HOME: root,
      PORT: String(port),
      HOST: "127.0.0.1",
      PENGUIN_SEED_ADMIN_PASSWORD: adminPassword,
      // No network from a test: the published plugin index stays unread.
      PENGUIN_PLUGIN_INDEX: "off",
      ...(options.webDist === undefined ? {} : { PENGUIN_WEB_DIST: options.webDist }),
      ...options.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const onLines = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) if (line !== "") log(line);
  };
  child.stdout?.on("data", onLines);
  child.stderr?.on("data", onLines);
  let exited: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  const exit = new Promise<void>((resolve) => {
    child.on("exit", (code, signal) => {
      exited = { code, signal };
      resolve();
    });
  });

  const deadline = Date.now() + (options.readyTimeoutMs ?? READY_TIMEOUT_MS);
  for (;;) {
    if (exited !== null) {
      const e = exited as { code: number | null; signal: NodeJS.Signals | null };
      throw new Error(
        `server exited before it was ready (code ${e.code}, signal ${e.signal}):\n${output.slice(-40).join("\n")}`,
      );
    }
    try {
      const res = await fetch(`${baseUrl}/api/install`);
      if (res.ok) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(
        `server did not answer within ${options.readyTimeoutMs ?? READY_TIMEOUT_MS} ms:\n${output.slice(-40).join("\n")}`,
      );
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  const admin = { userId: "admin", password: adminPassword };
  const loginAs = async (userId: string, password: string) => {
    const api = new HarnessApi(baseUrl);
    await api.login(userId, password);
    return api;
  };
  let stopped = false;
  return {
    baseUrl,
    port,
    root,
    admin,
    plugins,
    login: () => loginAs(admin.userId, admin.password),
    loginAs,
    installedPlugins: async () =>
      (
        await (
          await loginAs(admin.userId, admin.password)
        ).get<{ plugins: InstalledPluginRow[] }>("/api/plugins/installed")
      ).plugins,
    output: () => output,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      if (exited === null) {
        child.kill("SIGTERM");
        await Promise.race([exit, new Promise((r) => setTimeout(r, STOP_TIMEOUT_MS))]);
        if (exited === null) {
          child.kill("SIGKILL");
          await exit;
        }
      }
      if (temporary && options.keepRoot !== true) {
        await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    },
  };
}

/** Polls until `read` answers something `until` accepts, or the time is up. */
export async function waitFor<T>(
  read: () => Promise<T>,
  until: (value: T) => boolean,
  options: { timeoutMs?: number; intervalMs?: number; what?: string } = {},
): Promise<T> {
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);
  let last: T | undefined;
  for (;;) {
    last = await read();
    if (until(last)) return last;
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for ${options.what ?? "the condition"}; last value: ${JSON.stringify(last)}`,
      );
    }
    await new Promise((r) => setTimeout(r, options.intervalMs ?? 100));
  }
}
