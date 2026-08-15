#!/usr/bin/env node
/**
 * Watch-and-push for the backend platform (the server package): the "push"
 * half of `pnpm dev:server`.
 *
 * The runtime (started by `pnpm dev`) boots the server and WAITS for
 * hot-reload requests — it never watches its own code. This process is the
 * other half: it watches the server package's source (the server package IS
 * the backend platform unit; the web package is the frontend one, and Vite's
 * HMR under `pnpm dev:web` is its watch-push), compiles the platform entry to
 * one self-contained file on change, and pushes it to the runtime's
 * hot-upgrade API. A code edit reloads the running platform
 * (park → migrate → boot) with no server restart.
 *
 * esbuild here is not a new bundler in the tree: it is the engine tsup (the
 * server/core build tool) already runs on; Vite stays the web bundler.
 *
 * The two halves are genuinely separable: they rendezvous only through
 * $PENGUIN_HOME/hot/api.json (the runtime publishes { url, token } there on
 * boot) and an HTTP POST — one terminal or different machines both work.
 *
 * Usage: `node scripts/watch-push-platform.mjs` (long-running).
 * Env: PENGUIN_HOME (default ~/.penguin/dev-data) locates the runtime's api.json.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const PENGUIN_HOME = expandHome(process.env.PENGUIN_HOME ?? "~/.penguin/dev-data");
const API_FILE = path.join(PENGUIN_HOME, "hot", "api.json");
const ENTRY = path.join(ROOT, "packages", "server", "src", "hot", "dev-platform-entry.ts");
// The whole server package: the platform bundle only contains what the entry
// imports, but any server-source edit may reach it — an unrelated edit costs
// one silent re-swap (state preserved), which is cheap and keeps "watch push
// server changes" literal.
const WATCH_DIR = path.join(ROOT, "packages", "server", "src");
const OUTFILE = path.join(os.tmpdir(), `penguin-dev-platform-${process.pid}.mjs`);
const DEBOUNCE_MS = 300;

function log(msg) {
  console.log(`[watch-push] ${msg}`);
}

function expandHome(p) {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Waits for the runtime to publish its hot API credential, then reads it. */
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

/** Compiles the platform entry to ONE self-contained file (kernel bundled in). */
async function compile() {
  const esbuild = await import("esbuild");
  const kernelPath = require.resolve("@prismshadow/penguin-core/kernel");
  await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: OUTFILE,
    logLevel: "silent",
    // The kernel is imported as a bare specifier; resolve it to the host's copy
    // and bundle it in (its objects are pure data + closures, so a private copy
    // interoperates with the running host kernel).
    alias: { "@prismshadow/penguin-core/kernel": kernelPath },
  });
  return OUTFILE;
}

async function push(runtime) {
  const bundlePath = await compile();
  const res = await fetch(`${runtime.url}/api/hot/platform/upgrade`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${runtime.token}` },
    body: JSON.stringify({ bundlePath }),
  });
  const outcome = await res.json().catch(() => ({}));
  if (!res.ok) {
    log(`push failed (${res.status}): ${JSON.stringify(outcome)}`);
    return;
  }
  if (outcome.status === "blocked") {
    log(
      `upgrade blocked — data would be discarded: ` +
        `dropped=${JSON.stringify(outcome.dropped)} missing=${JSON.stringify(outcome.missing)} ` +
        `invalid=${JSON.stringify(outcome.invalid)}. The running platform is unchanged.`,
    );
    return;
  }
  log(`pushed → ${outcome.mode} (impl ${outcome.impl}).`);
}

const runtime = await waitForRuntime();
log(`runtime at ${runtime.url}; pushing initial platform...`);
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
  log("platform source changed; compiling and pushing...");
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

const watcher = fs.watch(WATCH_DIR, { recursive: true }, schedule);
log(`watching ${path.relative(ROOT, WATCH_DIR)} for changes.`);

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    watcher.close();
    fs.rmSync(OUTFILE, { force: true });
    process.exit(0);
  });
}
