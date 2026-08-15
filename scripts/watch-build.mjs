#!/usr/bin/env node
/**
 * Watch-build for the injected workspace deps (skills, core).
 *
 * The old dev flow built skills+core ONCE at startup (dev-prebuild.mjs), so
 * editing their source mid-session left every consumer — the web app's Vite
 * prebundle, the server's node_modules copy — serving stale code (the
 * repeated "rebuild core, then pnpm install" foot-gun). This watches their
 * `src/` and rebuilds on change.
 *
 * The rebuild MUST go through `pnpm ... build`, not a bare `tsup --watch`:
 * pnpm's `syncInjectedDepsAfterScripts: [build]` (pnpm-workspace.yaml) is what
 * copies the fresh dist into every injected consumer under node_modules/.pnpm.
 * A tsup watcher would update dist/ but never sync those copies, so consumers
 * would still import the old bytes. After a successful build we also drop the
 * web Vite dep cache (keyed by lockfile/config, never by dependency content —
 * so a rebuilt core would otherwise keep serving the browser old code).
 *
 * First run defers to dev-prebuild.mjs (install + one build + cache refresh),
 * then this enters the watch loop. Rebuilds are debounced and serialized; a
 * change arriving mid-build queues exactly one more build.
 *
 * Runs as the "build" half of `pnpm dev:server` (long-running; Ctrl-C to stop).
 */
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WATCH_DIRS = ["packages/skills/src", "packages/core/src"].map((r) => path.join(ROOT, r));
const KEY = createHash("sha1").update(ROOT).digest("hex").slice(0, 12);
const VITE_STAMP = path.join(os.tmpdir(), `penguin-dev-${KEY}.vite-stamp`);
const WEB_VITE_CACHE = path.join(ROOT, "packages", "web", "node_modules", ".vite");
const DEBOUNCE_MS = 250;
const isWin = process.platform === "win32";

function log(msg) {
  console.log(`[watch-build] ${msg}`);
}

/** Content fingerprint of the injected deps' dist (see dev-prebuild.mjs for the rationale). */
function injectedDistFingerprint() {
  const parts = [];
  for (const rel of ["packages/skills/dist", "packages/core/dist"]) {
    const base = path.join(ROOT, rel);
    try {
      for (const entry of readdirSync(base, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const abs = path.join(entry.parentPath, entry.name);
        parts.push(`${rel}:${createHash("sha256").update(readFileSync(abs)).digest("hex")}`);
      }
    } catch {
      parts.push(`${rel}:missing`);
    }
  }
  return createHash("sha256").update(parts.sort().join("\n")).digest("hex");
}

function refreshViteCacheIfChanged() {
  const fingerprint = injectedDistFingerprint();
  let prev = null;
  try {
    prev = readFileSync(VITE_STAMP, "utf8");
  } catch {
    // no stamp yet
  }
  if (prev === fingerprint) return;
  rmSync(WEB_VITE_CACHE, { recursive: true, force: true });
  writeFileSync(VITE_STAMP, fingerprint);
  log("skills/core output changed; cleared the web Vite dep cache.");
}

// First run: full prestep (install + build + cache refresh), reusing its lock/stamps.
const prestep = spawnSync("node", [path.join(ROOT, "scripts", "dev-prebuild.mjs")], {
  stdio: "inherit",
});
if (prestep.status !== 0) process.exit(prestep.status ?? 1);
// The prestep may have skipped its build (a concurrent dev command did it within the skip
// window); the fingerprint stamp is current either way, so the watch loop only rebuilds on
// a real edit from here.
refreshViteCacheIfChanged();

let building = false;
let queued = false;
let timer = null;

function scheduleBuild() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(runBuild, DEBOUNCE_MS);
}

function runBuild() {
  if (building) {
    queued = true;
    return;
  }
  building = true;
  log("change detected; rebuilding skills + core...");
  // Off the event loop so watch events keep queuing during the build.
  new Promise((resolve) => {
    const child = spawn(
      "pnpm",
      ["--filter", "@prismshadow/penguin-skills", "--filter", "@prismshadow/penguin-core", "build"],
      { cwd: ROOT, stdio: "inherit", shell: isWin },
    );
    child.on("close", (code) => resolve(code === 0));
  }).then((ok) => {
    if (ok) refreshViteCacheIfChanged();
    else log("build failed; keeping the previous output.");
    building = false;
    if (queued) {
      queued = false;
      scheduleBuild();
    }
  });
}

const watchers = [];
for (const dir of WATCH_DIRS) {
  if (!existsSync(dir)) continue;
  // Node >=24 supports recursive watch on Linux/macOS/Windows (engines pins node>=24).
  watchers.push(watch(dir, { recursive: true }, scheduleBuild));
}
log(`watching ${WATCH_DIRS.map((d) => path.relative(ROOT, d)).join(", ")} for changes.`);

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    for (const w of watchers) w.close();
    process.exit(0);
  });
}
