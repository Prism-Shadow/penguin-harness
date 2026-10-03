/**
 * The runs not ended yet, and the processes runs start.
 *
 * The table of live runs is process-wide (one `Symbol.for` key on globalThis): a hot update
 * builds a new registry while a run the old one started — a deploy — is still going, and that
 * run ends on the old instance (its store connection stays open until then). The new instance
 * reads the same table, so "one run of an Action at a time" and the live output of
 * `GET …/actions/runs/:id` hold across the update. Nothing else is shared between instances.
 */
import type { ProcessEnd } from "./action-model.js";
import type { RunStart } from "./action-store.js";
import { startProcess, type StartProcess } from "./deploy-process.js";

/** A process run is stopped after an hour. */
export const PROCESS_TIMEOUT_MS = 60 * 60_000;
/** After the timeout's SIGTERM, how long a process has before SIGKILL. */
const KILL_GRACE_MS = 10_000;
/** The kept tail of a process's output, in characters. */
export const OUTPUT_LIMIT = 1024 * 1024;

export interface LiveRun {
  start: RunStart;
  /** `<projectId>/<orgId>`. */
  orgKey: string;
  /** The kept tail of the output, and how many characters were dropped before it. */
  output: string;
  dropped: number;
  hasProcess: boolean;
}

const LIVE = Symbol.for("penguin.company-proposals.live-action-runs");

/** The process-wide table of live runs. */
export function liveRuns(): Map<string, LiveRun> {
  const g = globalThis as { [LIVE]?: Map<string, LiveRun> };
  g[LIVE] ??= new Map();
  return g[LIVE];
}

/** How many runs of `key` have not ended in the organization. */
export function runningCount(orgKey: string, key: string): number {
  let n = 0;
  for (const r of liveRuns().values()) if (r.orgKey === orgKey && r.start.key === key) n++;
  return n;
}

/** The output of a live run from an offset, the way the routes answer it. */
export function outputFrom(
  r: { output: string; dropped: number },
  from: number,
): { output: string; from: number; next: number } {
  const start = Math.max(from, r.dropped);
  const next = r.dropped + r.output.length;
  return {
    output: r.output.slice(Math.min(start - r.dropped, r.output.length)),
    from: Math.min(start, next),
    next,
  };
}

/**
 * Runs `argv` for a live run: its output appended to the run (a bounded tail), SIGTERM after
 * `timeoutMs` and SIGKILL after the grace. Resolves when it exits or fails to start.
 */
export function runProcess(
  live: LiveRun,
  argv: readonly string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; start?: StartProcess; timeoutMs?: number },
): Promise<ProcessEnd> {
  if (argv.length === 0 || argv[0]!.trim() === "") {
    return Promise.resolve({ exitCode: null, error: "no program to run", timedOut: false });
  }
  const proc = (opts.start ?? startProcess)(argv, { cwd: opts.cwd, env: opts.env });
  live.hasProcess = true;
  const timeoutMs = opts.timeoutMs ?? PROCESS_TIMEOUT_MS;
  return new Promise((resolve) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), KILL_GRACE_MS).unref();
    }, timeoutMs);
    timer.unref();
    proc.onOutput((text) => {
      live.output += text;
      if (live.output.length > OUTPUT_LIMIT) {
        const cut = live.output.length - OUTPUT_LIMIT;
        live.output = live.output.slice(cut);
        live.dropped += cut;
      }
    });
    proc.onExit((code, error) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        error: timedOut ? `stopped after the ${Math.round(timeoutMs / 1000)} s limit` : error,
        timedOut,
      });
    });
  });
}
