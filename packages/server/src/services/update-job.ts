/**
 * The self-update job: runs the CLI as `node <entry> update --yes` in the background and
 * exposes its progress, so the Web App's update modal can show a bar and be sent to the
 * background instead of holding one long request open (POST /api/version/update used to
 * answer only when the run was over — up to ten minutes with nothing to show). One job per
 * process: a start while one runs joins it, and the finished status stays readable until
 * the next start (which is also how a failed run is retried).
 *
 * How the self-update works: `penguin server|web` exports PENGUIN_CLI_ENTRY (its own entry
 * script path) before importing this server, and the job re-runs that script as
 * `node <entry> update --yes` — the CLI's update command owns all install-kind detection,
 * download and replacement logic (packages/cli/src/commands/update.ts). A server started
 * any other way (tests, a custom embedding) has no CLI to run and reports "unsupported".
 * SECURITY: the spawned argv is a fixed literal list; nothing from any request flows into
 * the command, its arguments, or its environment.
 *
 * Progress is read off the run's combined output, best-effort: the tarball installer
 * prints `Downloading <asset> from <source> ...` right before its `curl --progress-bar`
 * run, whose bar carries the percentage, and `<layer> checksum OK.` once the bundle is
 * verified; everything before the first is the release lookup and the installer fetch. A
 * run that prints none of it (an npm install, say) stays in `resolving` with no
 * percentage — the phase is a hint for the bar, never a fact the outcome depends on.
 *
 * Interpreting the CLI's outcome: `penguin update` exits non-zero only when an upgrade was
 * attempted and failed; refusals (source checkout, unrecognized layout, Windows) print a
 * message and exit 0. Exit codes alone therefore cannot separate "updated" from
 * "unsupported", so the spawn forces PENGUIN_LANG=en and classifies by the refusal
 * messages' stable English fragments (packages/cli/src/i18n.ts, `update` section). That
 * matching is reliable here because the spawned CLI and this server ship in lockstep from
 * the same install — the strings can never be from a different release than this code.
 *
 * A platform hot-swap while a run is in flight builds a fresh service that knows nothing of
 * it; the child finishes on its own and only its status is lost. Rare enough to accept.
 */
import { spawn } from "node:child_process";
import type { UpdateJobPhase, UpdateJobStatus, UpdateRunResponse } from "../api/types.js";

/** Only the tail of the update output is kept (installer logs can be long). */
const OUTPUT_CAP = 64 * 1024;
/** The whole update (download + install) must finish within this window. */
const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * English fragments of the CLI refusal messages (packages/cli/src/i18n.ts `update.*`),
 * one per refusal reason. `needsYes` / `cancelled` are omitted: `--yes` makes the
 * confirmation gate proceed unconditionally, so neither can occur here.
 */
const REFUSAL_MARKERS = [
  "runs from a source checkout", // sourceCheckout
  "Cannot tell how this penguin was installed", // unknownInstall
  "could not be identified", // npmUnknownManager
  "does not run on Windows", // windowsUnsupported
  "cannot run your package manager for you", // windowsGlobalInstall
];

/**
 * Maps the finished CLI run to an UpdateRunResponse. Exit 0 with a refusal message is
 * "unsupported"; any other exit 0 is "updated" — including the CLI's "already on the
 * latest version", because that means the *install* is current and only a restart of this
 * (older, in-memory) process is missing, which is exactly what needsRestart says.
 */
export function classifyUpdateRun(exitCode: number, output: string): UpdateRunResponse {
  if (exitCode !== 0) return { status: "failed", output, needsRestart: false };
  if (REFUSAL_MARKERS.some((marker) => output.includes(marker))) {
    return { status: "unsupported", output, needsRestart: false };
  }
  return { status: "updated", output, needsRestart: true };
}

/** The bar's position: which phase the run is in, and the download percentage while it downloads. */
export interface UpdateProgress {
  phase: UpdateJobPhase;
  percent: number | null;
}

export const INITIAL_PROGRESS: UpdateProgress = { phase: "resolving", percent: null };

/** The installer's line right before its curl run (install.sh: `Downloading $ASSET from $drp_label ...`). */
const DOWNLOAD_LINE = /\bDownloading \S+ from .+\.\.\./;
/** The installer's line after the bundle verified (install.sh verify_sha256: `<layer> checksum OK.`). */
const VERIFIED_LINE = /checksum OK\./;
/** curl's progress bar redraws end in the percentage; the last one in a chunk is the freshest. */
const PERCENT = /(\d{1,3}(?:\.\d+)?)%/g;

/**
 * Folds one output chunk into the progress. Pure, so the parsing is unit-tested without a
 * child process. A chunk may carry the download line and its first bar redraws together
 * (it is one pipe read), so the phase is settled before the percentage is read; the
 * verified line ends the download phase even when a bar redraw follows in the same chunk.
 */
export function advanceUpdateProgress(prev: UpdateProgress, chunk: string): UpdateProgress {
  let { phase, percent } = prev;
  if (phase === "resolving" && DOWNLOAD_LINE.test(chunk)) phase = "downloading";
  if (phase === "downloading") {
    if (VERIFIED_LINE.test(chunk)) return { phase: "installing", percent: null };
    let last: number | null = null;
    for (const m of chunk.matchAll(PERCENT)) {
      const value = Number(m[1]);
      if (Number.isFinite(value)) last = Math.min(100, Math.max(0, Math.round(value)));
    }
    if (last !== null) percent = last;
  }
  return { phase, percent };
}

/** One finished run, as the runner reports it. */
export interface UpdateRunExit {
  /** The process exit code; -1 when it died without one. */
  exitCode: number;
  /** The run overran UPDATE_TIMEOUT_MS and was killed. */
  timedOut: boolean;
  /** The command could not be started at all (spawn error); the message. */
  spawnError?: string;
}

/**
 * Runs `node <cliEntry> update --yes` to completion, handing every output chunk to
 * `onOutput` as it arrives. Tests substitute a scripted runner through BuildDepsOverrides.
 */
export type UpdateRunner = (
  cliEntry: string,
  onOutput: (chunk: string) => void,
) => Promise<UpdateRunExit>;

export const spawnUpdateRunner: UpdateRunner = (cliEntry, onOutput) =>
  new Promise((resolve) => {
    // PENGUIN_LANG=en pins the CLI's output language so classifyUpdateRun's markers match
    // regardless of the deployment's configured CLI language.
    const child = spawn(process.execPath, [cliEntry, "update", "--yes"], {
      env: { ...process.env, PENGUIN_LANG: "en" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const forward = (chunk: Buffer) => onOutput(chunk.toString("utf8"));
    child.stdout.on("data", forward);
    child.stderr.on("data", forward);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // A SIGTERM-ignoring child would otherwise leave the job running forever.
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
    }, UPDATE_TIMEOUT_MS);
    timer.unref();

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: -1, timedOut: false, spawnError: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, timedOut });
    });
  });

export class UpdateJobService {
  private current: UpdateJobStatus = { state: "idle", targetVersion: null, output: "" };
  private progress: UpdateProgress = INITIAL_PROGRESS;

  constructor(private readonly runner: UpdateRunner = spawnUpdateRunner) {}

  /** The job as it stands (idle / running with progress / done with its result). */
  status(): UpdateJobStatus {
    return this.current;
  }

  /**
   * Starts a run unless one is in flight (then it is simply joined). `cliEntry` null — no
   * CLI to run — ends at once as `unsupported`, the same answer the old blocking route
   * gave, so the page renders the reason rather than a run that never moves.
   */
  start(cliEntry: string | null, targetVersion: string | null): UpdateJobStatus {
    if (this.current.state === "running") return this.current;
    if (cliEntry === null) {
      this.current = {
        state: "done",
        targetVersion,
        output: "",
        result: {
          status: "unsupported",
          reason: "not_launched_via_cli",
          output: "",
          needsRestart: false,
        },
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      };
      return this.current;
    }
    this.progress = INITIAL_PROGRESS;
    this.current = {
      state: "running",
      targetVersion,
      phase: "resolving",
      percent: null,
      output: "",
      startedAt: new Date().toISOString(),
    };
    void this.runner(cliEntry, (chunk) => this.absorb(chunk)).then((exit) => this.finish(exit));
    return this.current;
  }

  private absorb(chunk: string): void {
    if (this.current.state !== "running") return;
    this.progress = advanceUpdateProgress(this.progress, chunk);
    this.current = {
      ...this.current,
      phase: this.progress.phase,
      percent: this.progress.phase === "downloading" ? this.progress.percent : null,
      output: (this.current.output + chunk).slice(-OUTPUT_CAP),
    };
  }

  private finish(exit: UpdateRunExit): void {
    const output = this.current.output;
    const result: UpdateRunResponse =
      exit.spawnError !== undefined
        ? {
            status: "failed",
            output: `${output}\n[failed to run the update command: ${exit.spawnError}]`.trim(),
            needsRestart: false,
          }
        : exit.timedOut
          ? {
              status: "failed",
              output:
                `${output}\n[the update run was killed after ${UPDATE_TIMEOUT_MS / 60_000} minutes]`.trim(),
              needsRestart: false,
            }
          : classifyUpdateRun(exit.exitCode, output.trim());
    this.current = {
      state: "done",
      targetVersion: this.current.targetVersion,
      output: result.output,
      result,
      ...(this.current.startedAt !== undefined ? { startedAt: this.current.startedAt } : {}),
      finishedAt: new Date().toISOString(),
    };
  }
}
