#!/usr/bin/env node
/**
 * Watch-and-push for the frontend platform (the web package): the "push" half
 * of `pnpm dev:web`.
 *
 * Vite's dev server (HMR) only reaches browsers pointed at Vite itself; a
 * runtime desktop app's window loads the SERVER's static hosting, which Vite
 * never touches. So the runtime-era dev:web runs `vite build --watch` (Vite
 * stays the web bundler) and this process pushes the rebuilt dist to the
 * runtime's hot API — the runtime retargets its static hosting and broadcasts
 * a reload to every connected client, desktop window included.
 *
 * Rendezvous is the same as the server push: $PENGUIN_HOME/hot/api.json.
 *
 * Usage: `node scripts/watch-push-web.mjs` (long-running).
 * Env: PENGUIN_HOME (default ~/.penguin/dev-data) locates the runtime's api.json.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PENGUIN_HOME = expandHome(process.env.PENGUIN_HOME ?? "~/.penguin/dev-data");
const API_FILE = path.join(PENGUIN_HOME, "hot", "api.json");
const WEB_DIST = path.join(ROOT, "packages", "web", "dist");
// Longer than the server push debounce: `vite build --watch` rewrites the
// whole dist over a short burst, and pushing mid-write would serve a torn
// tree for a moment.
const DEBOUNCE_MS = 800;

function log(msg) {
  console.log(`[watch-push-web] ${msg}`);
}

function expandHome(p) {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForRuntime() {
  let announced = false;
  for (;;) {
    try {
      const { url, token } = JSON.parse(await fsp.readFile(API_FILE, "utf8"));
      if (typeof url === "string" && typeof token === "string") return { url, token };
    } catch {
      // not up yet
    }
    if (!announced) {
      log(`waiting for a runtime to publish ${path.relative(ROOT, API_FILE)} ...`);
      announced = true;
    }
    await sleep(1000);
  }
}

async function waitForDist() {
  let announced = false;
  while (!fs.existsSync(path.join(WEB_DIST, "index.html"))) {
    if (!announced) {
      log("waiting for the first `vite build --watch` output ...");
      announced = true;
    }
    await sleep(1000);
  }
}

async function push(runtime) {
  const res = await fetch(`${runtime.url}/api/hot/web/upgrade`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${runtime.token}` },
    body: JSON.stringify({ distPath: WEB_DIST }),
  });
  const outcome = await res.json().catch(() => ({}));
  if (!res.ok) {
    log(`push failed (${res.status}): ${JSON.stringify(outcome)}`);
    return;
  }
  log(`pushed web dist (rev ${outcome.rev}); connected clients reload.`);
}

const runtime = await waitForRuntime();
await waitForDist();
log(`runtime at ${runtime.url}; pushing initial web dist...`);
await push(runtime);

let pushing = false;
let queued = false;
let timer = null;
function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, DEBOUNCE_MS);
}
async function run() {
  if (pushing) {
    queued = true;
    return;
  }
  pushing = true;
  log("web dist changed; pushing...");
  try {
    await push(runtime);
  } catch (err) {
    log(`error: ${err instanceof Error ? err.message : String(err)}`);
  }
  pushing = false;
  if (queued) {
    queued = false;
    schedule();
  }
}

const watcher = fs.watch(WEB_DIST, { recursive: true }, schedule);
log(`watching ${path.relative(ROOT, WEB_DIST)} for changes.`);

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    watcher.close();
    process.exit(0);
  });
}
