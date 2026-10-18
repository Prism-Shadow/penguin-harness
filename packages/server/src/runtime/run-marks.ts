/**
 * Run marks: the durable record of which Sessions have a run in flight, so a server
 * restart — graceful or a crash — can resume the interrupted runs instead of stranding
 * them as `[已中断]：用户中断`.
 *
 * - `SessionManager.drive` writes a mark when a driven run starts (Task, compaction, goal
 *   loop, failover switch — drive is the single choke point) and removes it when the run
 *   ends, UNLESS the run was cut short by the server's own shutdown (the abort signal's
 *   reason is core's SERVER_SHUTDOWN_ABORT_REASON): those marks survive for the next boot
 *   to resume. A person's stop always removes the mark — a user-aborted run is never
 *   auto-resumed.
 * - A crash (`kill -9`, OOM, power) writes nothing at shutdown time; the marks the dead
 *   process left behind are exactly the resume set. Any mark found at boot is stale by
 *   definition (a fresh process has no runs in flight).
 * - `resumeInterruptedSessions` runs once per data root per process (see hmr/platform.ts):
 *   each marked Session is re-started with RESUME_AFTER_RESTART, and core's Trace replay
 *   reconstructs the interrupted turn best-effort (`[turn_aborted]` carry-over). Queued
 *   follow-ups are in-memory and do not survive — only the interrupted run itself resumes.
 * - Crash-loop guard: a Session whose resumed run keeps dying with the server (three
 *   auto-resumes inside an hour) is NOT resumed again — the mark is dropped and an error
 *   is recorded, so a poison run cannot cost a model call on every boot forever. Any
 *   normally-ended run (or a skipped loop-break) clears the guard.
 *
 * Storage is files under `<root>/session-runs/` (one `<sessionId>.json` per mark plus
 * `resume-state.json` for the guard), deliberately NOT a DB table: marks must be writable
 * while the DB handle is already closed (drive's finally during shutdown) and readable
 * before any migration runs. All methods are synchronous and never throw — persistence
 * failures are reported through `onError` and must never break a run.
 */
import fs from "node:fs";
import path from "node:path";
import { userText } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";

/** What a Session whose Task a server restart cut short is started again with. */
export const RESUME_AFTER_RESTART =
  "[server_restart] The server restarted while you were working and your run was interrupted. Continue from where you left off. " +
  "Background processes and background subagents from before the restart are gone; restart them if still needed.";

/** Crash-loop guard: at most this many auto-resumes per Session inside the window below. */
export const RESUME_GUARD_MAX_ATTEMPTS = 3;
/** Crash-loop guard window (ms): attempts older than this start a fresh count. */
export const RESUME_GUARD_WINDOW_MS = 60 * 60 * 1000;

const RUNS_DIR = "session-runs";
const GUARD_FILE = "resume-state.json";
const MARK_VERSION = 1;

/** One durable run mark: a Session that had a run in flight when the marks were read. */
export interface RunMark {
  sessionId: string;
  projectId: string;
  agentId: string;
  /** ISO timestamp of the drive that wrote the mark (diagnostics only). */
  startedAt: string;
  /** PID of the process that wrote the mark (diagnostics only). */
  pid: number;
}

/** Crash-loop guard entry for one Session. */
export interface ResumeGuard {
  count: number;
  windowStart: number;
}

/** Durable run-mark + resume-guard storage (see the module doc). */
export interface RunMarkStore {
  /** Record that a driven run started (overwrites any mark, stale or not). */
  markStart(sessionId: string, info: { projectId: string; agentId: string }): void;
  /** Record that a run ended normally or by a person's stop: drops the mark AND the guard. */
  markEnd(sessionId: string): void;
  /** Drop the mark only (the loader healed the Session under a new id; that run owns its own mark). */
  removeMark(sessionId: string): void;
  /** Every mark on disk (corrupt files are skipped). */
  listMarks(): RunMark[];
  /** The crash-loop guard entry, if any. */
  readResumeGuard(sessionId: string): ResumeGuard | undefined;
  /** Count one auto-resume attempt (rolls the window when expired); returns the new entry. */
  noteResumeAttempt(sessionId: string, now?: number): ResumeGuard;
  /** Clear the crash-loop guard entry, if any. */
  clearResumeGuard(sessionId: string): void;
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function markFileName(sessionId: string): string | null {
  if (!SESSION_ID_PATTERN.test(sessionId) || sessionId === "resume-state") return null;
  return `${sessionId}.json`;
}

/** File-backed RunMarkStore under `<root>/session-runs/`. Never throws (see module doc). */
export function createFileRunMarkStore(
  root: string,
  opts?: { onError?: (message: string) => void; now?: () => number },
): RunMarkStore {
  const dir = path.join(root, RUNS_DIR);
  const guardPath = path.join(dir, GUARD_FILE);
  const now = opts?.now ?? (() => Date.now());
  const report = (message: string): void => {
    try {
      opts?.onError?.(message);
    } catch {
      // Reporting must never break the caller either.
    }
  };

  const ensureDir = (): boolean => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      return true;
    } catch (err) {
      report(
        `[run-marks] cannot create ${dir}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  };

  const readGuardFile = (): Record<string, ResumeGuard> => {
    try {
      const raw = fs.readFileSync(guardPath, "utf8");
      const parsed = JSON.parse(raw) as { entries?: Record<string, ResumeGuard> };
      if (
        parsed &&
        typeof parsed === "object" &&
        parsed.entries &&
        typeof parsed.entries === "object"
      ) {
        return parsed.entries;
      }
      return {};
    } catch {
      // Missing or corrupt: a corrupt guard must never block a resume — start fresh.
      return {};
    }
  };

  const writeGuardFile = (entries: Record<string, ResumeGuard>): void => {
    try {
      if (!ensureDir()) return;
      fs.writeFileSync(guardPath, JSON.stringify({ version: MARK_VERSION, entries }));
    } catch (err) {
      report(
        `[run-marks] cannot write ${guardPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const removeMark = (sessionId: string): void => {
    const file = markFileName(sessionId);
    if (file === null) return;
    try {
      fs.rmSync(path.join(dir, file), { force: true });
    } catch (err) {
      report(
        `[run-marks] cannot remove mark for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const clearResumeGuard = (sessionId: string): void => {
    const entries = readGuardFile();
    if (!(sessionId in entries)) return;
    delete entries[sessionId];
    writeGuardFile(entries);
  };

  return {
    markStart(sessionId, info): void {
      const file = markFileName(sessionId);
      if (file === null || !ensureDir()) return;
      const mark: RunMark & { version: number } = {
        version: MARK_VERSION,
        sessionId,
        projectId: info.projectId,
        agentId: info.agentId,
        startedAt: new Date(now()).toISOString(),
        pid: process.pid,
      };
      try {
        fs.writeFileSync(path.join(dir, file), JSON.stringify(mark));
      } catch (err) {
        report(
          `[run-marks] cannot write mark for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    markEnd(sessionId): void {
      removeMark(sessionId);
      clearResumeGuard(sessionId);
    },

    removeMark,

    listMarks(): RunMark[] {
      let names: string[];
      try {
        names = fs.readdirSync(dir);
      } catch {
        return []; // No directory yet: nothing was ever marked.
      }
      const marks: RunMark[] = [];
      for (const name of names) {
        if (!name.endsWith(".json") || name === GUARD_FILE) continue;
        const sessionId = name.slice(0, -".json".length);
        if (markFileName(sessionId) !== name) continue;
        try {
          const parsed = JSON.parse(
            fs.readFileSync(path.join(dir, name), "utf8"),
          ) as Partial<RunMark>;
          if (
            parsed.sessionId !== sessionId ||
            typeof parsed.projectId !== "string" ||
            typeof parsed.agentId !== "string"
          ) {
            continue;
          }
          marks.push({
            sessionId,
            projectId: parsed.projectId,
            agentId: parsed.agentId,
            startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
            pid: typeof parsed.pid === "number" ? parsed.pid : 0,
          });
        } catch {
          continue; // A half-written mark from a crash: skip it rather than fail the boot.
        }
      }
      // Deterministic order (oldest mark first when timestamps parse), so a restart with
      // many interrupted runs always resumes them in the same sequence.
      marks.sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
      return marks;
    },

    readResumeGuard(sessionId): ResumeGuard | undefined {
      return readGuardFile()[sessionId];
    },

    noteResumeAttempt(sessionId, at?: number): ResumeGuard {
      const timestamp = at ?? now();
      const entries = readGuardFile();
      const prev = entries[sessionId];
      const next: ResumeGuard =
        prev && timestamp - prev.windowStart < RESUME_GUARD_WINDOW_MS
          ? { count: prev.count + 1, windowStart: prev.windowStart }
          : { count: 1, windowStart: timestamp };
      entries[sessionId] = next;
      writeGuardFile(entries);
      return next;
    },

    clearResumeGuard,
  };
}

/** Minimal starter surface `resumeInterruptedSessions` needs (a subset of SessionManager). */
export interface ResumeTaskStarter {
  startTask(
    sessionId: string,
    input: OmniMessage[],
  ): Promise<{ sessionId: string; queued: boolean }>;
}

/**
 * Cold-boot resume: restart every run the previous process left marked (see the module
 * doc), one by one, best-effort. Outcomes per mark:
 * - guard tripped (≥3 attempts inside an hour): the mark is DROPPED and an error recorded —
 *   a poison run must not cost a model call on every boot; a person resumes it by hand.
 * - start accepted: the new drive owns the mark from here (its end clears it); when the
 *   loader healed the Session under a new id, the stale mark AND its guard entry are
 *   removed (the healed run owns a fresh mark and a fresh guard).
 * - busy (`task_in_progress` / `compacting`) or `shutting_down`: left alone — the run in
 *   flight (or the next boot) owns the lifecycle.
 * - anything else (session gone, loader/credential failure): the mark is dropped and an
 *   error recorded (except a plain 404, which only logs — deleting while down is routine).
 */
export async function resumeInterruptedSessions(opts: {
  store: RunMarkStore;
  starter: ResumeTaskStarter;
  log: (line: string) => void;
  recordError?: (code: string, err: unknown, mark: RunMark) => void;
  now?: () => number;
}): Promise<{ resumed: string[]; skipped: { sessionId: string; reason: string }[] }> {
  const resumed: string[] = [];
  const skipped: { sessionId: string; reason: string }[] = [];
  const timestamp = opts.now?.() ?? Date.now();
  let marks: RunMark[];
  try {
    marks = opts.store.listMarks();
  } catch (err) {
    opts.log(`[resume] cannot list run marks: ${err instanceof Error ? err.message : String(err)}`);
    return { resumed, skipped };
  }
  if (marks.length === 0) return { resumed, skipped };
  opts.log(`[resume] ${marks.length} interrupted run(s) to resume after the restart`);
  for (const mark of marks) {
    const guard = opts.store.readResumeGuard(mark.sessionId);
    if (
      guard &&
      timestamp - guard.windowStart < RESUME_GUARD_WINDOW_MS &&
      guard.count >= RESUME_GUARD_MAX_ATTEMPTS
    ) {
      opts.store.markEnd(mark.sessionId);
      const reason = `auto-resume skipped after ${guard.count} attempts inside an hour (possible poison run); resume it by hand`;
      opts.log(`[resume] ${mark.sessionId}: ${reason}`);
      opts.recordError?.("auto_resume_loop", new Error(reason), mark);
      skipped.push({ sessionId: mark.sessionId, reason: "loop_guard" });
      continue;
    }
    opts.store.noteResumeAttempt(mark.sessionId, timestamp);
    try {
      const res = await opts.starter.startTask(mark.sessionId, [
        userText(RESUME_AFTER_RESTART, "server"),
      ]);
      if (res.sessionId !== mark.sessionId) {
        // The loader healed the Session under a new id: the stale mark goes, with its
        // guard (the new run owns a fresh mark and a fresh guard from here).
        opts.store.removeMark(mark.sessionId);
        opts.store.clearResumeGuard(mark.sessionId);
      }
      opts.log(`[resume] ${mark.sessionId} resumed`);
      resumed.push(mark.sessionId);
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (code === "task_in_progress" || code === "compacting" || code === "shutting_down") {
        opts.log(`[resume] ${mark.sessionId}: still ${String(code)}, left for its owner`);
        skipped.push({ sessionId: mark.sessionId, reason: String(code) });
        continue;
      }
      opts.store.markEnd(mark.sessionId);
      const message = err instanceof Error ? err.message : String(err);
      opts.log(
        `[resume] ${mark.sessionId}: cannot resume (${String(code ?? "error")}): ${message}`,
      );
      if (code !== "session_not_found") opts.recordError?.("auto_resume_failed", err, mark);
      skipped.push({ sessionId: mark.sessionId, reason: String(code ?? "error") });
    }
  }
  return { resumed, skipped };
}
