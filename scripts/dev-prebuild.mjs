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
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  const res = spawnSync("pnpm", ["install"], { cwd: ROOT, stdio: "inherit" });
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
        { cwd: ROOT, stdio: "inherit" },
      );
      if (res.status === 0) writeFileSync(BUILD_STAMP, String(Date.now()));
      exitCode = res.status ?? 1;
    }
  }
} finally {
  release();
}
process.exit(exitCode);
