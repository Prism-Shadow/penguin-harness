/**
 * @prismshadow/penguin-plugin-test — integration testing for PenguinHarness plugins.
 *
 * The idea is `@vscode/test-electron`'s: start the REAL host with the plugin under
 * development installed, and run the tests against that. Here the host is the server —
 * `@prismshadow/penguin-server`'s built entry, started as a child process on a scratch data
 * root whose Project asks for the plugin — so what a test exercises is the same path a
 * deployment takes: the loader resolves the package, reads its manifests, pairs them with
 * its code, and boots its modules into the platform tree. Nothing is assembled in-process
 * and nothing is mocked in the host.
 *
 *   const harness = await startHarness({ plugins: [pluginDir] });
 *   const api = await harness.login();
 *   const { plugins } = await api.get(`/api/projects/${harness.projectId}/plugins/installed`);
 *   …
 *   await harness.stop();
 *
 * A plugin is named by its package directory (build it first) or by a package name the server
 * can install on its own. A directory reaches the server the way a hot push brings plugins:
 * the harness packs it, has npm install the tarball into a bundled plugin directory inside the
 * scratch root's push assets (`hmr/harness.json` names them), and writes that directory's index
 * with the tarball's npm integrity — so the server stores it in its plugin store and activates
 * it like any plugin a push carries. The Project lists it by package name.
 *
 * The list is CONFIGURATION OF A PROJECT (`plugins` in its `.project_config.toml`), which is
 * what a process loads the closure of; the harness seeds that file for the one Project the
 * server will adopt, before the server starts, so the plugin is in the tree from boot.
 *
 * A development dependency: it ships with no build of the harness.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
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
  /**
   * The Project whose config asks for them — the one the server adopts on a fresh root,
   * unless a test seeds another.
   */
  projectId?: string;
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

/** The Project the server adopts on a fresh root — spelled here rather than imported, so this stays a server-free package. */
export const DEFAULT_PROJECT_ID = "default_project";
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
}

/** What the installed-plugins route lists for one plugin, as far as a test reads it. */
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
  /** The plugins as the Project's config lists them: package names. */
  readonly plugins: readonly string[];
  /** The Project that asks for them; the prefix of every Project-scoped route a test calls. */
  readonly projectId: string;
  /** A client signed in as the seeded admin. */
  login(): Promise<HarnessApi>;
  /** A client signed in as this user (the caller created them, or it is the admin). */
  loginAs(userId: string, password: string): Promise<HarnessApi>;
  /** `GET /api/projects/:projectId/plugins/installed`, as the admin. */
  installedPlugins(): Promise<InstalledPluginRow[]>;
  /** The server's output so far, line by line. */
  output(): readonly string[];
  /** Stops the server and, unless `keepRoot`, removes a temporary data root. */
  stop(): Promise<void>;
}

/**
 * Checks a plugin option: a package name is returned as it is; a package directory must name
 * an entry that exists (the package is built), which is returned.
 */
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

/** The push assets directory the harness stages plugins into, under `<root>/hmr/`. */
const ASSETS_DIR = "plugin-test-assets";

/** npm's integrity of a file: `sha512-<base64>` of its bytes, what `dist.integrity` is. */
async function npmIntegrity(file: string): Promise<string> {
  return `sha512-${createHash("sha512")
    .update(await fs.readFile(file))
    .digest("base64")}`;
}

function run(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, { cwd, stdio: "pipe", shell: process.platform === "win32" });
}

/**
 * Stages package directories into `root` as a hot push would bring them: each is packed
 * (`pnpm pack`, its `files` honoured), the tarballs are installed by npm into
 * `<root>/hmr/plugin-test-assets/plugins/`, that directory's `index.json` lists each with its
 * tarball's npm integrity, and `<root>/hmr/harness.json` names the assets. Answers the
 * packages' names, in order.
 */
export async function stagePushedPlugins(root: string, dirs: readonly string[]): Promise<string[]> {
  const prefix = path.join(root, "hmr", ASSETS_DIR, "plugins");
  await fs.mkdir(prefix, { recursive: true });
  const packed = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-plugin-test-pack-"));
  try {
    const names: string[] = [];
    const rows: Record<string, unknown>[] = [];
    const tarballs: string[] = [];
    for (const dir of dirs) {
      const before = new Set(await fs.readdir(packed));
      run("pnpm", ["pack", "--pack-destination", packed], dir);
      const tarball = (await fs.readdir(packed)).find((f) => f.endsWith(".tgz") && !before.has(f));
      if (tarball === undefined) throw new Error(`pnpm pack left no tarball for ${dir}`);
      const file = path.join(packed, tarball);
      const pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8")) as {
        name: string;
        version: string;
        description?: string;
        license?: string;
        author?: unknown;
      };
      names.push(pkg.name);
      tarballs.push(file);
      const author =
        typeof pkg.author === "string"
          ? pkg.author
          : typeof (pkg.author as { name?: unknown } | undefined)?.name === "string"
            ? (pkg.author as { name: string }).name
            : null;
      rows.push({
        name: pkg.name,
        version: pkg.version,
        description: pkg.description ?? "",
        authors: author === null ? [] : [author],
        license: pkg.license ?? "",
        integrity: await npmIntegrity(file),
      });
    }
    await fs.writeFile(
      path.join(prefix, "package.json"),
      `${JSON.stringify({ name: "penguin-plugin-test-plugins", private: true, version: "0.0.0" }, null, 2)}\n`,
    );
    run(
      "npm",
      [
        "install",
        "--no-save",
        "--no-package-lock",
        "--omit=dev",
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
        "--",
        ...tarballs,
      ],
      prefix,
    );
    await fs.writeFile(path.join(prefix, "index.json"), `${JSON.stringify(rows, null, 2)}\n`);
    await fs.writeFile(
      path.join(root, "hmr", "harness.json"),
      `${JSON.stringify({ assets: { dir: ASSETS_DIR } }, null, 2)}\n`,
    );
    return names;
  } finally {
    await fs.rm(packed, { recursive: true, force: true });
  }
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
 * Starts the server with the plugins installed and waits until it has finished starting. A
 * package directory is staged as a hot push's plugin (`stagePushedPlugins`); the Project lists
 * every plugin by package name.
 */
export async function startHarness(options: StartHarnessOptions): Promise<Harness> {
  // Every directory must be built before anything is staged.
  await Promise.all(options.plugins.map(resolvePluginEntry));
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
  const projectId = options.projectId ?? DEFAULT_PROJECT_ID;
  await fs.mkdir(path.join(root, projectId), { recursive: true });
  const dirs = options.plugins.filter((p) => path.isAbsolute(p));
  const staged = dirs.length === 0 ? [] : await stagePushedPlugins(root, dirs);
  const plugins = options.plugins.map((p) => (path.isAbsolute(p) ? staged[dirs.indexOf(p)]! : p));
  // Only `plugins`: the rest of a Project's config is the server's to write when it adopts
  // the directory, and its adoption preserves what is already in the file.
  await fs.writeFile(
    path.join(root, projectId, ".project_config.toml"),
    `[plugins]\n${plugins.map((s) => `${JSON.stringify(s)} = "*"\n`).join("")}`,
    "utf8",
  );
  const port = options.port ?? (await freePort());
  const adminPassword = options.adminPassword ?? DEFAULT_ADMIN_PASSWORD;
  // localhost, not 127.0.0.1: the server canonicalizes the App onto localhost and keeps
  // 127.0.0.1 as the Workspace-preview host, where /api answers 401.
  const baseUrl = `http://localhost:${port}`;
  const output: string[] = [];
  const log = options.log ?? ((line: string) => void output.push(line));

  // Written by the server as the last step of startup — after the admin is seeded and the
  // Project adopted. A stale one from an earlier run in the same root would read as ready.
  const portFile = path.join(root, ".plugin-test-port");
  await fs.rm(portFile, { force: true });

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
      PENGUIN_PORT_FILE: portFile,
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
    // The port file, not an answering port: the server routes requests while it is still
    // starting, so a login sent on the first 200 can beat the admin seed.
    if (existsSync(portFile)) break;
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(
        `server did not finish starting within ${options.readyTimeoutMs ?? READY_TIMEOUT_MS} ms:\n${output.slice(-40).join("\n")}`,
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
    projectId,
    login: () => loginAs(admin.userId, admin.password),
    loginAs,
    installedPlugins: async () =>
      (
        await (
          await loginAs(admin.userId, admin.password)
        ).get<{ plugins: InstalledPluginRow[] }>(
          `/api/projects/${encodeURIComponent(projectId)}/plugins/installed`,
        )
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
