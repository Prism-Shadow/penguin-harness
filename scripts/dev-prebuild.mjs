#!/usr/bin/env node
/**
 * Serialized dev prestep: ensure dependencies are installed, then build the workspace deps
 * the dev servers consume (skills, core).
 *
 * dev:server and dev:web must both build packages/skills and packages/core before starting
 * (never start on stale deps — see the 2026-07-17 design changelog entry), and every dev
 * command needs `pnpm install` to be current (a fresh clone, or a pulled lockfile change,
 * otherwise starts against missing/stale packages). But when two dev commands launch at the
 * same time in separate terminals, concurrent installs/builds would race (tsup runs with
 * clean:true, so one build deletes files the other just wrote). This script makes the
 * prestep safe and cheap to invoke concurrently:
 *
 * - An exclusive on-disk lock serializes invocations; a second invocation waits instead of
 *   clobbering. The lock (and the stamps below) live under the OS temp directory keyed by
 *   the repo path, so they exist even before node_modules does (a fresh clone can run any
 *   dev command directly). Locks left behind by crashed runs are stolen when the holder PID
 *   is dead or the lock is impossibly old.
 * - Install freshness is stamped with the pnpm-lock.yaml content hash: `pnpm install` runs
 *   only when node_modules is missing or the lockfile changed since the last stamped
 *   install, so the usual dev start pays nothing.
 * - A build success stamp collapses duplicate builds: an invocation that acquires the lock
 *   right after another one finished (within SKIP_WINDOW_MS) skips the rebuild, so a
 *   simultaneous dev:server + dev:web start builds once, and dev:server's inner
 *   re-invocation (from packages/server's dev script) is a no-op. The window is
 *   deliberately tiny so a human edit-then-restart cycle always rebuilds.
 *
 * Usage: `node scripts/dev-prebuild.mjs` (install + build skills/core) or
 * `node scripts/dev-prebuild.mjs --install-only` (dev:docs / dev:landing — no workspace
 * deps to build, but installs must still be current).
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INSTALL_ONLY = process.argv.includes("--install-only");

// Lock and stamps live in the OS temp dir keyed by the repo path (NOT under node_modules:
// they must exist before the first install, and per-checkout isolation comes from the key).
const KEY = createHash("sha1").update(ROOT).digest("hex").slice(0, 12);
const LOCK_DIR = path.join(os.tmpdir(), `penguin-dev-${KEY}.lock`);
const PID_FILE = path.join(LOCK_DIR, "pid");
const INSTALL_STAMP = path.join(os.tmpdir(), `penguin-dev-${KEY}.install-stamp`);
const BUILD_STAMP = path.join(os.tmpdir(), `penguin-dev-${KEY}.build-stamp`);
const STALE_LOCK_MS = 10 * 60 * 1000; // no install+build takes 10 minutes; older locks are leftovers
const SKIP_WINDOW_MS = 5_000;
const VITE_STAMP = path.join(os.tmpdir(), `penguin-dev-${KEY}.vite-stamp`);
const WEB_VITE_CACHE = path.join(ROOT, "packages", "web", "node_modules", ".vite");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function holderAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** One attempt to take the lock; on failure, steal it if the holder crashed. */
function tryAcquire() {
  try {
    mkdirSync(LOCK_DIR); // atomic: EEXIST when someone else holds it
    writeFileSync(PID_FILE, String(process.pid));
    return true;
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    let holder = NaN;
    try {
      holder = Number(readFileSync(PID_FILE, "utf8"));
    } catch {
      // pid not written yet (or lock just released) — retry on the next poll
    }
    let age = 0;
    try {
      age = Date.now() - statSync(LOCK_DIR).mtimeMs;
    } catch {
      return false; // lock vanished between checks — retry
    }
    if ((Number.isFinite(holder) && !holderAlive(holder)) || age > STALE_LOCK_MS) {
      rmSync(LOCK_DIR, { recursive: true, force: true });
    }
    return false;
  }
}

const release = () => rmSync(LOCK_DIR, { recursive: true, force: true });

function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Content fingerprint of the injected workspace deps' build output (skills + core dist):
 * every file's bytes are hashed — chunk renames alone would not do, because tsup's entry
 * outputs keep stable filenames and hold entry-resident code, so an equal-length change
 * there would slip past a path+size check. mtimes are deliberately excluded (tsup runs
 * with clean:true, so every rebuild rewrites them even when nothing changed). The two
 * dist trees are a few MB, so this stays well under the cost of anything else here.
 */
function injectedDistFingerprint() {
  const parts = [];
  for (const rel of ["packages/skills/dist", "packages/core/dist"]) {
    const base = path.join(ROOT, rel);
    try {
      for (const entry of readdirSync(base, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const abs = path.join(entry.parentPath, entry.name);
        const digest = createHash("sha256").update(readFileSync(abs)).digest("hex");
        parts.push(`${rel}/${path.relative(base, abs)}:${digest}`);
      }
    } catch {
      parts.push(`${rel}:missing`);
    }
  }
  return createHash("sha256").update(parts.sort().join("\n")).digest("hex");
}

/**
 * Drop Vite's dependency-prebundle cache when the injected deps' output changed.
 *
 * The workspace runs with injectWorkspacePackages, so the web app consumes skills/core as
 * snapshot copies inside node_modules/.pnpm (kept current by syncInjectedDepsAfterScripts
 * when the build above runs). Vite then prebundles those copies into
 * packages/web/node_modules/.vite/deps — and that cache is keyed by lockfile/config only,
 * never by dependency content, so a rebuilt core would keep serving the browser the OLD
 * code (e.g. a stale model catalog) until the cache is deleted. Purging only on a real
 * output change keeps the usual dev start free of Vite's re-optimize cost.
 */
function refreshViteCache() {
  const fingerprint = injectedDistFingerprint();
  if (readText(VITE_STAMP) === fingerprint) return;
  rmSync(WEB_VITE_CACHE, { recursive: true, force: true });
  writeFileSync(VITE_STAMP, fingerprint);
  console.log("[dev-prebuild] skills/core output changed; cleared the web Vite dep cache.");
}

/**
 * Ensure `pnpm install` is current: runs it when node_modules is missing or the
 * pnpm-lock.yaml hash differs from the last stamped install. Returns false on failure.
 */
function ensureInstalled() {
  const lock = readText(path.join(ROOT, "pnpm-lock.yaml"));
  const hash = createHash("sha256")
    .update(lock ?? "")
    .digest("hex");
  if (existsSync(path.join(ROOT, "node_modules")) && readText(INSTALL_STAMP) === hash) {
    return true;
  }
  console.log("[dev-prebuild] dependencies missing or lockfile changed; running pnpm install...");
  // shell on Windows: pnpm is a .cmd shim there, which Node refuses to spawn shell-less (CVE-2024-27980).
  const res = spawnSync("pnpm", ["install"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (res.status !== 0) return false;
  writeFileSync(INSTALL_STAMP, hash);
  return true;
}

let announced = false;
while (!tryAcquire()) {
  if (!announced) console.log("[dev-prebuild] another dev prestep is running; waiting...");
  announced = true;
  await sleep(500);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    release();
    process.exit(1);
  });
}

let exitCode = 1;
try {
  if (!ensureInstalled()) {
    exitCode = 1;
  } else if (INSTALL_ONLY) {
    exitCode = 0;
  } else {
    let stampAge = Infinity;
    try {
      stampAge = Date.now() - statSync(BUILD_STAMP).mtimeMs;
    } catch {
      // no stamp yet — build
    }
    if (stampAge < SKIP_WINDOW_MS) {
      console.log("[dev-prebuild] deps were just built by a concurrent invocation; skipping.");
      // The concurrent builder normally refreshed the cache too, but verify against the
      // current output anyway — the check is two directory walks and a hash, and it keeps
      // the invariant unconditional: after any successful prestep, the Vite dep cache
      // matches the injected deps actually on disk.
      refreshViteCache();
      exitCode = 0;
    } else {
      console.log("[dev-prebuild] building skills + core...");
      const res = spawnSync(
        "pnpm",
        [
          "--filter",
          "@prismshadow/penguin-skills",
          "--filter",
          "@prismshadow/penguin-core",
          "build",
        ],
        // shell on Windows: pnpm is a .cmd shim there (see ensureInstalled).
        { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" },
      );
      if (res.status === 0) {
        writeFileSync(BUILD_STAMP, String(Date.now()));
        refreshViteCache();
      }
      exitCode = res.status ?? 1;
    }
  }
} finally {
  release();
}
process.exit(exitCode);
