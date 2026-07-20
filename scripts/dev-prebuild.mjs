#!/usr/bin/env node
/**
 * Serialized prebuild of the workspace deps the dev servers consume (skills, core).
 *
 * dev:server and dev:web must both build packages/skills and packages/core before starting
 * (never start on stale deps — see the 2026-07-17 design changelog entry). But when the two
 * commands are launched at the same time in separate terminals, two tsup builds race on the
 * same dist/ directories (tsup runs with clean:true, so one build deletes files the other
 * just wrote). This script makes the prebuild safe to invoke concurrently:
 *
 * - An exclusive on-disk lock (atomic mkdir under node_modules/) serializes invocations;
 *   a second invocation waits instead of clobbering. Locks left behind by crashed runs are
 *   stolen when the holder PID is dead or the lock is impossibly old.
 * - A success stamp collapses duplicate builds: an invocation that acquires the lock right
 *   after another one finished (within SKIP_WINDOW_MS) skips the rebuild, so a simultaneous
 *   dev:server + dev:web start builds once, and dev:server's inner re-invocation (from
 *   packages/server's dev script) is a no-op. The window is deliberately tiny so a human
 *   edit-then-restart cycle always rebuilds.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Both live under node_modules/ so no extra ignore rules are needed.
const LOCK_DIR = path.join(ROOT, "node_modules", ".dev-prebuild.lock");
const PID_FILE = path.join(LOCK_DIR, "pid");
const STAMP = path.join(ROOT, "node_modules", ".dev-prebuild-stamp");
const STALE_LOCK_MS = 10 * 60 * 1000; // no build takes 10 minutes; older locks are leftovers
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

let announced = false;
while (!tryAcquire()) {
  if (!announced) console.log("[dev-prebuild] another dev prebuild is running; waiting...");
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
  let stampAge = Infinity;
  try {
    stampAge = Date.now() - statSync(STAMP).mtimeMs;
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
      ["--filter", "@prismshadow/penguin-skills", "--filter", "@prismshadow/penguin-core", "build"],
      { cwd: ROOT, stdio: "inherit" },
    );
    if (res.status === 0) writeFileSync(STAMP, String(Date.now()));
    exitCode = res.status ?? 1;
  }
} finally {
  release();
}
process.exit(exitCode);
