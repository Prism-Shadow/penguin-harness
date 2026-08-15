#!/usr/bin/env node
/**
 * The unified watch-and-push: ONE process, ONE atomic push cycle.
 *
 * platform = cli + platform code + web is ONE indivisible version (see
 * packages/server/src/hmr/host.ts's module doc): this script watches platform +
 * CLI source (packages/server/src and packages/cli/src) and the web build output
 * (packages/web/dist, produced by `vite build --watch` under dev:web), and on any
 * change compiles ONE unified bundle (packages/cli/src/platform-bundle.ts,
 * exporting both `hotPlatform` and `cli`) and pushes it to EVERY target together
 * with the web dist, in a single request to POST /api/hmr/upgrade — debounced and
 * serialized, so two cycles never interleave and a change arriving mid-cycle
 * queues exactly one more.
 *
 * The push is over HTTP ALONE: the compiled bundle and the web dist travel
 * INLINE in the request body (no shared filesystem, no scp). Every target is
 * a URL, reached as the admin: this script logs in (POST /api/auth/login)
 * with PENGUIN_ADMIN_PASSWORD and carries the resulting session cookie on
 * every request, exactly like an operator would from a browser. There used to
 * be a per-boot Bearer token instead, published in plaintext to
 * $PENGUIN_HOME/hmr/api.json — removed as a security fix: that file was
 * readable (and admin-equivalent) for anything running as the same OS user,
 * including an agent's own shell/exec tools, which inherit both the user and
 * PENGUIN_HOME. Passwords and sessions are hashed at rest, so logging in is
 * the only channel left that ever puts an admin credential within reach of
 * whatever is running locally — and it requires the operator to have typed
 * PENGUIN_ADMIN_PASSWORD into this process's environment on purpose.
 *
 * Targets come from a servers file — the SAME schema the desktop shell's
 * server picker uses:
 *
 *   { "servers": [
 *     { "id": "local", "type": "local" },
 *     { "id": "box",   "type": "remote", "url": "http://127.0.0.1:61082" }
 *   ] }
 *
 * Every target logs in as `admin` with PENGUIN_ADMIN_PASSWORD, unless the
 * entry sets its own `password` (for a remote box whose admin password
 * differs from the local one). A `local` entry with no explicit `url` targets
 * this machine's dev server at HOST/PORT (defaulting like config.ts: 127.0.0.1
 * / DEFAULT_SERVER_PORT, canonicalized to `localhost` on a loopback bind).
 *
 * Resolution: $PENGUIN_SERVERS_FILE, else $PENGUIN_HOME/hmr/servers.json, else
 * an implicit single local target.
 *
 * Usage: `node scripts/watch-push.mjs` (long-running; wired into `pnpm dev`).
 * Requires PENGUIN_ADMIN_PASSWORD in the environment — there is no fallback;
 * the script refuses to start without it rather than guess or run unauthenticated.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// penguin-core ships ESM-only (no `require` export condition) — a dynamic import, not
// require(), the same way compilePlatform() below loads esbuild lazily.
const { DEFAULT_SERVER_PORT } = await import("@prismshadow/penguin-core");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PENGUIN_HOME = expandHome(process.env.PENGUIN_HOME ?? "~/.penguin/dev-data");
const SERVERS_FILE =
  process.env.PENGUIN_SERVERS_FILE ?? path.join(PENGUIN_HOME, "hmr", "servers.json");
// The unified compile entry: exports BOTH `hotPlatform` (re-exported from
// @prismshadow/penguin-server/platform) and `cli` (packages/cli's own run/chat/config
// commands) — see packages/cli/src/platform-bundle.ts's module doc.
const ENTRY = path.join(ROOT, "packages", "cli", "src", "platform-bundle.ts");
const SERVER_SRC = path.join(ROOT, "packages", "server", "src");
const CLI_SRC = path.join(ROOT, "packages", "cli", "src");
const WEB_DIST = path.join(ROOT, "packages", "web", "dist");
const BUNDLE = path.join(os.tmpdir(), `penguin-dev-platform-${process.pid}.mjs`);
// Past vite's write burst; server/cli-source edits share the same cycle debounce.
const DEBOUNCE_MS = 800;

const ADMIN_PASSWORD = process.env.PENGUIN_ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error(
    "[watch-push] PENGUIN_ADMIN_PASSWORD is not set.\n" +
      "watch-push authenticates to every target as the admin user (POST /api/auth/login) " +
      "and pushes with the resulting session cookie — the old per-boot Bearer-token file " +
      "($PENGUIN_HOME/hmr/api.json) was removed because it was a plaintext admin-equivalent " +
      "secret readable by anything running as this OS user.\n" +
      "Set PENGUIN_ADMIN_PASSWORD to the admin password for the target runtime(s) and retry.",
  );
  process.exit(1);
}

function log(msg) {
  console.log(`[watch-push] ${msg}`);
}

function expandHome(p) {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The servers list; falls back to one implicit local target. */
function readTargets() {
  try {
    const doc = JSON.parse(fs.readFileSync(SERVERS_FILE, "utf8"));
    if (Array.isArray(doc.servers) && doc.servers.length > 0) return doc.servers;
  } catch {
    // no servers file — implicit local target
  }
  return [{ id: "local", type: "local" }];
}

/**
 * Default local runtime URL: mirrors config.ts's own HOST/PORT defaulting
 * (127.0.0.1:DEFAULT_SERVER_PORT, canonicalized to `localhost` on a loopback
 * bind — see loopbackHostRoles). There is no longer a file to read this from:
 * the per-boot api.json this used to resolve against is gone (see the file
 * header), so a `local` target with no explicit `url` is just this machine's
 * dev server addressed the same way the server itself would.
 */
function defaultLocalUrl() {
  const host = process.env.HOST ?? "127.0.0.1";
  const appHost = host === "127.0.0.1" || host === "localhost" ? "localhost" : host;
  const port = Number(process.env.PORT || DEFAULT_SERVER_PORT);
  return `http://${appHost}:${port}`;
}

/** Resolves a target's base URL (no trailing slash). */
function resolveTargetUrl(target) {
  if (typeof target.url === "string" && target.url !== "") return target.url.replace(/\/+$/, "");
  if (target.type === "remote") {
    throw new Error(`remote target '${target.id}' needs a \`url\``);
  }
  return defaultLocalUrl();
}

/** The admin password for a target: its own `password` override, else PENGUIN_ADMIN_PASSWORD. */
function resolveTargetPassword(target) {
  return typeof target.password === "string" && target.password !== ""
    ? target.password
    : ADMIN_PASSWORD;
}

/**
 * On a loopback bind, 127.0.0.1 is the preview host (where /api answers 401);
 * /api is served under the canonical App host (`localhost`). An ssh tunnel to
 * a remote runtime typically lands on 127.0.0.1:<port> on this end, so the
 * request must still be addressed to the App host by name via a Host header
 * override.
 */
function hostOverrideFor(url) {
  return new URL(url).hostname === "127.0.0.1" ? "localhost" : undefined;
}

/**
 * Minimal HTTP client built on node:http/https rather than the global fetch:
 * fetch (undici) silently derives the Host header from the request URL and
 * ignores an explicit `headers.host` override — verified behavior, not a
 * guess — which would break every request this script sends to a target
 * whose /api only answers under its canonical host name (see
 * hostOverrideFor). node:http honors a caller-supplied Host header.
 */
function request(urlStr, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function requestJson(urlStr, opts) {
  const res = await request(urlStr, opts);
  let json;
  try {
    json = JSON.parse(res.body.toString("utf8"));
  } catch {
    json = {};
  }
  return { status: res.status, headers: res.headers, json };
}

/** Logs in as admin against one target's base URL; returns the session cookie (`name=value`). */
async function login(url, password) {
  const hostOverride = hostOverrideFor(url);
  const res = await requestJson(`${url}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(hostOverride ? { host: hostOverride } : {}),
    },
    body: JSON.stringify({ userId: "admin", password }),
  });
  if (res.status !== 200) {
    throw new Error(`admin login to ${url} failed (${res.status}): ${JSON.stringify(res.json)}`);
  }
  const setCookie = res.headers["set-cookie"];
  if (!setCookie || setCookie.length === 0) {
    throw new Error(`admin login to ${url} succeeded but set no session cookie`);
  }
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

/** Per-target cached session cookie, keyed by target id. */
const sessions = new Map();

async function sessionFor(target) {
  const url = resolveTargetUrl(target);
  if (!sessions.has(target.id)) {
    sessions.set(target.id, await login(url, resolveTargetPassword(target)));
  }
  return sessions.get(target.id);
}

/**
 * Sends an authenticated request to a target's hot API, logging in on first
 * use and re-logging in (once) if the cached session was rejected — a long-
 * running watch process can outlive a session that got invalidated some other
 * way (e.g. an admin password change) between push cycles.
 */
async function authedRequest(target, apiPath, { method, contentType, body }) {
  const url = resolveTargetUrl(target);
  const hostOverride = hostOverrideFor(url);
  const baseHeaders = {
    "content-type": contentType,
    ...(hostOverride ? { host: hostOverride } : {}),
  };
  let cookie = await sessionFor(target);
  let res = await request(`${url}${apiPath}`, {
    method,
    headers: { ...baseHeaders, cookie },
    body,
  });
  if (res.status === 401) {
    sessions.delete(target.id);
    cookie = await sessionFor(target);
    res = await request(`${url}${apiPath}`, { method, headers: { ...baseHeaders, cookie }, body });
  }
  return res;
}

/**
 * Compiles the unified entry to ONE self-contained file (kernel + cli deps bundled
 * in — commander, agenthub, the MCP client, arktype, everything the run/chat/config
 * commands pull in transitively via @prismshadow/penguin-core, so the pushed file
 * loads and runs from an arbitrary directory with no shared node_modules).
 *
 * The banner works around a real esbuild footgun: several bundled CJS deps
 * (commander's lib/command.js among them) call plain `require("node:events")` from
 * inside their own commonjs wrapper; esbuild's ESM output normally converts that
 * into a call to its OWN injected `__require` shim, which unconditionally THROWS
 * ("Dynamic require of ... is not supported") rather than resolving a real Node
 * builtin — confirmed by reproducing this exact failure pushing to a real server. A
 * banner that defines a real top-level `require` (via node:module's createRequire)
 * before esbuild's bundled code runs makes those nested `require()` calls resolve
 * for real instead of hitting the shim.
 */
async function compilePlatform() {
  if (!fs.existsSync(ENTRY)) {
    throw new Error(`unified bundle entry missing: ${ENTRY}`);
  }
  const esbuild = await import("esbuild");
  await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: BUNDLE,
    logLevel: "silent",
    banner: {
      js: 'import { createRequire as __penguinCreateRequire } from "node:module"; const require = __penguinCreateRequire(import.meta.url);',
    },
    alias: {
      "@prismshadow/penguin-core/kernel": require.resolve("@prismshadow/penguin-core/kernel"),
    },
  });
}

const hasWebDist = () => fs.existsSync(path.join(WEB_DIST, "index.html"));

/** Reads the whole web dist into a { relPath: base64 } manifest. */
async function readWebManifest() {
  const files = {};
  for (const entry of await fsp.readdir(WEB_DIST, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    const rel = path.relative(WEB_DIST, abs).split(path.sep).join("/");
    files[rel] = (await fsp.readFile(abs)).toString("base64");
  }
  return files;
}

/**
 * Pushes ONE atomic version — the compiled unified bundle (platform + cli) AND the
 * web dist — to one target, in a single request to POST /api/hmr/upgrade. The body
 * is gzip(JSON.stringify({ bundle, web: { files } })): one write on the target
 * instead of the old two-request platform-then-web sequence, and no window where a
 * target could observe one half updated without the other.
 */
async function pushVersion(target, files) {
  const bundle = await fsp.readFile(BUNDLE, "utf8");
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ bundle, web: { files } })));
  const res = await authedRequest(target, "/api/hmr/upgrade", {
    method: "POST",
    contentType: "application/gzip",
    body: gz,
  });
  const outcome = JSON.parse(res.body.toString("utf8") || "{}");
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`/api/hmr/upgrade → ${res.status}: ${JSON.stringify(outcome)}`);
  }
  return outcome;
}

/**
 * One atomic push cycle: compile the unified bundle once, read the web dist once,
 * then push both together to every target in turn. Per-target failures are
 * reported and do not abort the rest of the fleet; the cycle itself never
 * interleaves with another. A merged push needs BOTH halves, so the cycle is
 * skipped entirely (not degraded) until the web dist has been built at least once.
 */
async function pushCycle() {
  if (!hasWebDist()) {
    log("web dist not built yet (packages/web/dist); skipping push cycle");
    return;
  }
  const targets = readTargets();
  await compilePlatform();
  const files = await readWebManifest();
  for (const target of targets) {
    try {
      const out = await pushVersion(target, files);
      if (out.status === "blocked") {
        log(
          `[${target.id}] BLOCKED (data would be discarded): ` +
            `dropped=${JSON.stringify(out.dropped)} missing=${JSON.stringify(out.missing)} ` +
            `invalid=${JSON.stringify(out.invalid)} — target unchanged.`,
        );
      } else {
        log(`[${target.id}] → ${out.mode} (impl ${out.impl}, web rev ${out.web.rev})`);
      }
    } catch (err) {
      log(`[${target.id}] push failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/**
 * Waits until at least the implicit local target is reachable AND
 * authenticates: a connection-level failure (server still booting) is
 * retried, but a reachable server that rejects the admin password is a hard
 * failure — waiting cannot fix a wrong password, so this does not spin on it.
 */
async function waitForFirstTarget() {
  let announced = false;
  for (;;) {
    const targets = readTargets();
    for (const target of targets) {
      try {
        await sessionFor(target);
        return;
      } catch (err) {
        if (err && typeof err === "object" && "code" in err) continue; // not up yet
        throw err;
      }
    }
    if (!announced) {
      log(`waiting for a runtime (targets: ${targets.map((t) => t.id).join(", ")}) ...`);
      announced = true;
    }
    await sleep(1000);
  }
}

await waitForFirstTarget();
log("runtime reachable; initial push cycle...");
await pushCycle().catch((err) => log(`cycle failed: ${err.message}`));

let running = false;
let queued = false;
let timer = null;
function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, DEBOUNCE_MS);
}
async function run() {
  if (running) {
    queued = true;
    return;
  }
  running = true;
  log(
    "change detected; push cycle (compile the unified bundle, push bundle + web to each target)...",
  );
  try {
    await pushCycle();
  } catch (err) {
    log(`cycle failed: ${err instanceof Error ? err.message : err}`);
  }
  running = false;
  if (queued) {
    queued = false;
    schedule();
  }
}

// Both halves of the unified bundle are watched: server/src (the hotPlatform half)
// AND cli/src (the cli half — run/chat/config, plus platform-bundle.ts itself).
const watchers = [
  fs.watch(SERVER_SRC, { recursive: true }, schedule),
  fs.watch(CLI_SRC, { recursive: true }, schedule),
];
if (fs.existsSync(WEB_DIST)) watchers.push(fs.watch(WEB_DIST, { recursive: true }, schedule));
else {
  // vite build --watch creates it after its first build; attach then.
  const poll = setInterval(() => {
    if (fs.existsSync(WEB_DIST)) {
      watchers.push(fs.watch(WEB_DIST, { recursive: true }, schedule));
      clearInterval(poll);
      schedule();
    }
  }, 1000);
  poll.unref();
}
log(
  `watching packages/server/src + packages/cli/src + packages/web/dist; targets file: ${SERVERS_FILE}`,
);

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    for (const w of watchers) w.close();
    fs.rmSync(BUNDLE, { force: true });
    process.exit(0);
  });
}
