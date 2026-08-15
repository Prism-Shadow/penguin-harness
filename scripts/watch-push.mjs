#!/usr/bin/env node
/**
 * The unified watch-and-push: ONE process, ONE atomic push cycle.
 *
 * Replaces the separate platform/web pushers. It watches both platform source
 * (packages/server/src) and the web build output (packages/web/dist, produced
 * by `vite build --watch` under dev:web), and on any change runs a single
 * indivisible push cycle — debounced and serialized, so two cycles never
 * interleave and a change arriving mid-cycle queues exactly one more:
 *
 *   1. FRONTEND FIRST: push the web dist to EVERY target (each retargets its
 *      static hosting and broadcasts a reload to its connected windows);
 *   2. then EACH BACKEND: compile the platform entry once, push the bundle to
 *      every target in turn (park → migrate → boot on each).
 *
 * The push is over HTTP ALONE: the compiled bundle and the web dist travel
 * INLINE in the request body (no shared filesystem, no scp). Every target is
 * therefore just a URL + token — a local runtime resolves both from its
 * hmr/api.json; a remote runtime is reached through a URL (an ssh tunnel, a
 * relay, …) with its token supplied.
 *
 * Targets come from a servers file — the SAME schema the desktop shell's
 * server picker uses:
 *
 *   { "servers": [
 *     { "id": "local", "type": "local", "home": "~/.penguin/dev-data" },
 *     { "id": "box",   "type": "remote", "url": "http://127.0.0.1:61082", "token": "…" }
 *   ] }
 *
 * Resolution: $PENGUIN_SERVERS_FILE, else $PENGUIN_HOME/hmr/servers.json, else
 * an implicit single local target at $PENGUIN_HOME.
 *
 * Usage: `node scripts/watch-push.mjs` (long-running; wired into `pnpm dev`).
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PENGUIN_HOME = expandHome(process.env.PENGUIN_HOME ?? "~/.penguin/dev-data");
const SERVERS_FILE =
  process.env.PENGUIN_SERVERS_FILE ?? path.join(PENGUIN_HOME, "hmr", "servers.json");
const ENTRY = path.join(ROOT, "packages", "server", "src", "platform", "entry.ts");
const SERVER_SRC = path.join(ROOT, "packages", "server", "src");
const WEB_DIST = path.join(ROOT, "packages", "web", "dist");
const BUNDLE = path.join(os.tmpdir(), `penguin-dev-platform-${process.pid}.mjs`);
// Past vite's write burst; server-source edits share the same cycle debounce.
const DEBOUNCE_MS = 800;

function log(msg) {
  console.log(`[watch-push] ${msg}`);
}

function expandHome(p) {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The servers list; falls back to one implicit local target at PENGUIN_HOME. */
function readTargets() {
  try {
    const doc = JSON.parse(fs.readFileSync(SERVERS_FILE, "utf8"));
    if (Array.isArray(doc.servers) && doc.servers.length > 0) return doc.servers;
  } catch {
    // no servers file — implicit local target
  }
  return [{ id: "local", type: "local", home: PENGUIN_HOME }];
}

/** Resolves a target to { url, token }: local reads api.json, remote is explicit. */
async function resolveApi(target) {
  if (target.type === "remote" || target.url !== undefined) {
    if (typeof target.url !== "string" || typeof target.token !== "string") {
      throw new Error(`remote target '${target.id}' needs { url, token }`);
    }
    return { url: target.url.replace(/\/+$/, ""), token: target.token };
  }
  const file = path.join(expandHome(target.home ?? PENGUIN_HOME), "hmr", "api.json");
  const { url, token } = JSON.parse(await fsp.readFile(file, "utf8"));
  return { url: url.replace(/\/+$/, ""), token };
}

/** POSTs JSON to a target's hot API over HTTP (the only channel a push uses). */
async function post(api, apiPath, body) {
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${api.token}`,
  };
  // On loopback binds 127.0.0.1 is the preview host (where /api answers 401);
  // /api is served under the App host, so address it by name. A tunnel to a
  // remote runtime typically lands on 127.0.0.1:<port> — this is what makes
  // pushing through it work.
  if (new URL(api.url).hostname === "127.0.0.1") headers.host = "localhost";
  const res = await fetch(`${api.url}${apiPath}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const outcome = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${apiPath} → ${res.status}: ${JSON.stringify(outcome)}`);
  return outcome;
}

/**
 * Whether there is a platform entry to compile at all: the mechanism-only
 * MVP branch ships no business platform (packages/server/src/platform/entry.ts
 * is absent there), so the push cycle degrades to frontend-only rather than
 * failing.
 */
const hasPlatformEntry = () => fs.existsSync(ENTRY);

/** Compiles the platform entry to ONE self-contained file (kernel bundled in). */
async function compilePlatform() {
  const esbuild = await import("esbuild");
  await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: BUNDLE,
    logLevel: "silent",
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
 * Pushes the web dist to one target INLINE over HTTP (frontend phase).
 *
 * Primary transport: gzip(JSON.stringify({ files })) as the raw body — one
 * write on the target instead of one per file (the small-file-count
 * bottleneck this replaces: 300+ small files written serially onto a
 * Windows/Defender-scanned disk measured well under 1MB/s). Falls back to
 * the old JSON { files } body on 400/404/415 — a target running an older
 * build won't recognize the gzip Content-Type/route shape, and the push
 * must still land.
 */
async function pushWeb(target) {
  const api = await resolveApi(target);
  const files = await readWebManifest();
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ files })));
  const headers = { "content-type": "application/gzip", authorization: `Bearer ${api.token}` };
  if (new URL(api.url).hostname === "127.0.0.1") headers.host = "localhost";
  const res = await fetch(`${api.url}/api/hmr/web/upgrade`, {
    method: "POST",
    headers,
    body: gz,
  });
  if (res.ok) return res.json();
  if ([400, 404, 415].includes(res.status)) {
    log(`[${target.id}] gzip web push rejected (${res.status}); falling back to JSON`);
    return post(api, "/api/hmr/web/upgrade", { files });
  }
  const outcome = await res.json().catch(() => ({}));
  throw new Error(`/api/hmr/web/upgrade → ${res.status}: ${JSON.stringify(outcome)}`);
}

/** Pushes the compiled platform bundle to one target INLINE over HTTP (backend phase). */
async function pushPlatform(target) {
  const api = await resolveApi(target);
  const bundle = await fsp.readFile(BUNDLE, "utf8");
  return post(api, "/api/hmr/platform/upgrade", { bundle });
}

/**
 * One atomic push cycle: frontend to every target first, then each backend in
 * turn. Per-target failures are reported and do not abort the rest of the
 * fleet; the cycle itself never interleaves with another.
 */
async function pushCycle() {
  const targets = readTargets();
  if (hasWebDist()) {
    for (const target of targets) {
      try {
        const out = await pushWeb(target);
        log(`[${target.id}] web → rev ${out.rev}`);
      } catch (err) {
        log(`[${target.id}] web push failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  if (!hasPlatformEntry()) {
    log("no platform entry (packages/server/src/platform/entry.ts); frontend-only push cycle");
    return;
  }
  await compilePlatform();
  for (const target of targets) {
    try {
      const out = await pushPlatform(target);
      if (out.status === "blocked") {
        log(
          `[${target.id}] platform BLOCKED (data would be discarded): ` +
            `dropped=${JSON.stringify(out.dropped)} missing=${JSON.stringify(out.missing)} ` +
            `invalid=${JSON.stringify(out.invalid)} — target unchanged.`,
        );
      } else {
        log(`[${target.id}] platform → ${out.mode} (impl ${out.impl})`);
      }
    } catch (err) {
      log(`[${target.id}] platform push failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/** Waits until at least the implicit local target is reachable. */
async function waitForFirstTarget() {
  let announced = false;
  for (;;) {
    const targets = readTargets();
    for (const target of targets) {
      try {
        await resolveApi(target);
        return;
      } catch {
        // not up yet
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
  log("change detected; push cycle (web first, then each backend)...");
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

const watchers = [fs.watch(SERVER_SRC, { recursive: true }, schedule)];
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
log(`watching packages/server/src + packages/web/dist; targets file: ${SERVERS_FILE}`);

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    for (const w of watchers) w.close();
    fs.rmSync(BUNDLE, { force: true });
    process.exit(0);
  });
}
