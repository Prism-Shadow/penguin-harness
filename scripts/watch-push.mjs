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
 * Targets come from a servers file — the SAME schema the desktop shell's
 * server picker uses (both sides of the "UI without a server" model speak it):
 *
 *   { "servers": [
 *     { "id": "local",  "type": "local", "home": "~/.penguin/dev-data" },
 *     { "id": "lab",    "type": "ssh",   "host": "user@box", "home": "~/.penguin/data" }
 *   ] }
 *
 * Resolution: $PENGUIN_SERVERS_FILE, else $PENGUIN_HOME/hot/servers.json, else
 * an implicit single local target at $PENGUIN_HOME. A local target is reached
 * through its hot/api.json; an ssh target by scp-ing the artifacts to the
 * remote temp dir and curl-ing the upgrade endpoints over ssh (the remote
 * server stays loopback-only; nothing is exposed on the network).
 *
 * Usage: `node scripts/watch-push.mjs` (long-running; wired into `pnpm dev`).
 */
import { execFile as execFileCb } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);
const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PENGUIN_HOME = expandHome(process.env.PENGUIN_HOME ?? "~/.penguin/dev-data");
const SERVERS_FILE =
  process.env.PENGUIN_SERVERS_FILE ?? path.join(PENGUIN_HOME, "hot", "servers.json");
const ENTRY = path.join(ROOT, "packages", "server", "src", "hot", "dev-platform-entry.ts");
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

/** Local target: read its hot/api.json (the runtime publishes it on boot). */
async function localApi(target) {
  const file = path.join(expandHome(target.home ?? PENGUIN_HOME), "hot", "api.json");
  const { url, token } = JSON.parse(await fsp.readFile(file, "utf8"));
  return { url, token };
}

async function ssh(host, args) {
  const { stdout } = await execFile("ssh", ["-o", "BatchMode=yes", host, ...args]);
  return stdout;
}

/** Remote target: api.json and artifacts live on the remote machine. */
async function sshApi(target) {
  const home = target.home ?? "~/.penguin";
  const raw = await ssh(target.host, [`cat ${home}/hot/api.json`]);
  const { url, token } = JSON.parse(raw);
  return { url, token };
}

/** curl on the remote host (the server is loopback-only there by design). */
async function sshPost(target, api, apiPath, bodyJson) {
  const out = await ssh(target.host, [
    "curl",
    "-s",
    "-X",
    "POST",
    "-H",
    `'Authorization: Bearer ${api.token}'`,
    "-H",
    "'content-type: application/json'",
    "-d",
    `'${bodyJson.replaceAll("'", "'\\''")}'`,
    `'${api.url}${apiPath}'`,
  ]);
  return JSON.parse(out);
}

async function localPost(api, apiPath, body) {
  const res = await fetch(`${api.url}${apiPath}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${api.token}` },
    body: JSON.stringify(body),
  });
  const outcome = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${apiPath} → ${res.status}: ${JSON.stringify(outcome)}`);
  return outcome;
}

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

/** Pushes the web dist to one target (frontend phase). */
async function pushWeb(target) {
  if (target.type === "ssh") {
    const remoteDist = `/tmp/penguin-push-web-${target.id}`;
    await ssh(target.host, [`rm -rf ${remoteDist} && mkdir -p ${remoteDist}`]);
    await execFile("scp", ["-q", "-r", `${WEB_DIST}/.`, `${target.host}:${remoteDist}/`]);
    const api = await sshApi(target);
    return sshPost(target, api, "/api/hot/web/upgrade", JSON.stringify({ distPath: remoteDist }));
  }
  const api = await localApi(target);
  return localPost(api, "/api/hot/web/upgrade", { distPath: WEB_DIST });
}

/** Pushes the compiled platform bundle to one target (backend phase). */
async function pushPlatform(target) {
  if (target.type === "ssh") {
    const remoteBundle = `/tmp/penguin-push-platform-${target.id}.mjs`;
    await execFile("scp", ["-q", BUNDLE, `${target.host}:${remoteBundle}`]);
    const api = await sshApi(target);
    return sshPost(
      target,
      api,
      "/api/hot/platform/upgrade",
      JSON.stringify({ bundlePath: remoteBundle }),
    );
  }
  const api = await localApi(target);
  return localPost(api, "/api/hot/platform/upgrade", { bundlePath: BUNDLE });
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
        if (target.type === "ssh") await sshApi(target);
        else await localApi(target);
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
