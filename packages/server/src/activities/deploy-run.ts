/**
 * Running a deploy: one at a time on this server, its stages in order, a live log with a
 * cursor, Stop, and state that outlives the process.
 *
 * A run and the state of each stage are rows in web.db (`activity_deploy_runs`,
 * `activity_deploy_stages`), written on every transition, so the stage list is the same after
 * a restart; a run the restart cut short is marked interrupted. Starting a stage sets every
 * stage after it back to pending: a later stage may run only once the one before it is done
 * since it was last run.
 *
 * The log is kept twice: the last 2 000 lines in memory for the one-second polls, and the whole
 * of it (tail bounded at 256 KB) in `PENGUIN_HOME/activity-deploy/logs/<runId>.log`, which is
 * what a later reader gets once the process that ran it is gone.
 */
import fs from "node:fs";
import path from "node:path";
import type { Db } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import { newId } from "./domain.js";
import { clampLog } from "./sandbox-build-runner.js";
import {
  DEPLOY_STAGE_DEFINITIONS,
  DeployStageFailure,
  DeployStopped,
  stagesFor,
  type DeployStageContext,
} from "./deploy-stages.js";
import {
  DEPLOY_RELEASE_STAGES,
  type DeployLogLine,
  type DeployLogPage,
  type DeployRun,
  type DeployRunMetadata,
  type DeployStage,
  type DeployStageSelection,
  type DeployStageStatus,
  type DeployTarget,
} from "./deploy-types.js";

/** Lines kept in memory per run. */
export const LOG_RING = 2000;
/** Lines one log page carries at most. */
export const LOG_PAGE = 500;
/** How much of a log is kept on disk: its end. */
export const LOG_FILE_MAX = 256 * 1024;
/** One log line's longest. */
const LINE_MAX = 4000;
/** How long Stop waits for the stage to wind down before answering. */
const STOP_WAIT_MS = 5000;

/** A stage's stored state. */
export interface StoredStage {
  status: DeployStageStatus;
  finishedAt: string | null;
  metadata: DeployRunMetadata;
}

/** Where runs and stage states are kept. */
export interface DeployRunStore {
  saveRun(projectId: string, run: DeployRun): void;
  latestRun(projectId: string, activityId: string): DeployRun | null;
  getRun(projectId: string, activityId: string, runId: string): DeployRun | null;
  stages(activityId: string): Partial<Record<DeployStage, StoredStage>>;
  saveStage(activityId: string, stage: DeployStage, state: StoredStage): void;
  /** Marks what a stopped process left running as interrupted. */
  interruptRunning(at: string): void;
}

function parseRun(json: string): DeployRun | null {
  try {
    return JSON.parse(json) as DeployRun;
  } catch {
    return null;
  }
}

/** Every run that was running when it stopped: interrupted, its running stage failed. */
function interrupted(run: DeployRun, at: string): DeployRun {
  return {
    ...run,
    status: "interrupted",
    finishedAt: run.finishedAt ?? at,
    stages: run.stages.map((entry) =>
      entry.status === "running"
        ? { ...entry, status: "failed", error: { code: "interrupted" } }
        : entry,
    ),
  };
}

/** The store over web.db. */
export function dbDeployStore(db: Db): DeployRunStore {
  const one = (sql: string, ...args: string[]) =>
    db.prepare(sql).get(...args) as { record_json: string } | undefined;
  return {
    saveRun(projectId, run) {
      db.prepare(
        `INSERT INTO activity_deploy_runs (run_id, project_id, activity_id, target, status, record_json, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET status = excluded.status, record_json = excluded.record_json, finished_at = excluded.finished_at`,
      ).run(
        run.runId,
        projectId,
        run.activityId,
        run.target,
        run.status,
        JSON.stringify(run),
        run.startedAt,
        run.finishedAt,
      );
    },
    latestRun(projectId, activityId) {
      const row = one(
        "SELECT record_json FROM activity_deploy_runs WHERE project_id = ? AND activity_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1",
        projectId,
        activityId,
      );
      return row ? parseRun(row.record_json) : null;
    },
    getRun(projectId, activityId, runId) {
      const row = one(
        "SELECT record_json FROM activity_deploy_runs WHERE project_id = ? AND activity_id = ? AND run_id = ?",
        projectId,
        activityId,
        runId,
      );
      return row ? parseRun(row.record_json) : null;
    },
    stages(activityId) {
      const rows = db
        .prepare(
          "SELECT stage, status, finished_at, metadata_json FROM activity_deploy_stages WHERE activity_id = ?",
        )
        .all(activityId) as {
        stage: string;
        status: string;
        finished_at: string | null;
        metadata_json: string;
      }[];
      const out: Partial<Record<DeployStage, StoredStage>> = {};
      for (const row of rows) {
        if (!(DEPLOY_RELEASE_STAGES as readonly string[]).includes(row.stage)) continue;
        let metadata: DeployRunMetadata = {};
        try {
          metadata = JSON.parse(row.metadata_json) as DeployRunMetadata;
        } catch {
          metadata = {};
        }
        out[row.stage as DeployStage] = {
          status: row.status as DeployStageStatus,
          finishedAt: row.finished_at,
          metadata,
        };
      }
      return out;
    },
    saveStage(activityId, stage, state) {
      db.prepare(
        `INSERT INTO activity_deploy_stages (activity_id, stage, status, finished_at, metadata_json)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(activity_id, stage) DO UPDATE SET status = excluded.status, finished_at = excluded.finished_at, metadata_json = excluded.metadata_json`,
      ).run(activityId, stage, state.status, state.finishedAt, JSON.stringify(state.metadata));
    },
    interruptRunning(at) {
      const rows = db
        .prepare(
          "SELECT run_id, project_id, record_json FROM activity_deploy_runs WHERE status = 'running'",
        )
        .all() as { run_id: string; project_id: string; record_json: string }[];
      for (const row of rows) {
        const run = parseRun(row.record_json);
        if (run) this.saveRun(row.project_id, interrupted(run, at));
        else
          db.prepare(
            "UPDATE activity_deploy_runs SET status = 'interrupted', finished_at = ? WHERE run_id = ?",
          ).run(at, row.run_id);
      }
      db.prepare(
        "UPDATE activity_deploy_stages SET status = 'failed', finished_at = ? WHERE status = 'running'",
      ).run(at);
    },
  };
}

/** One run's log: a ring of recent lines, and the file. */
class RunLog {
  readonly lines: DeployLogLine[] = [];
  seq = 0;
  private size = 0;

  constructor(
    private readonly file: string,
    private readonly now: () => Date,
  ) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "");
  }

  append(text: string) {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.length > LINE_MAX ? `${raw.slice(0, LINE_MAX)} …` : raw;
      if (line.trim() === "") continue;
      this.seq += 1;
      this.lines.push({ seq: this.seq, at: this.now().toISOString(), text: line });
      if (this.lines.length > LOG_RING) this.lines.shift();
      this.write(`${line}\n`);
    }
  }

  private write(text: string) {
    try {
      fs.appendFileSync(this.file, text);
      this.size += text.length;
      // Kept to its end: a build looping on an error can print without bound.
      if (this.size > LOG_FILE_MAX * 2) {
        const kept = clampLog(fs.readFileSync(this.file, "utf8"), LOG_FILE_MAX);
        fs.writeFileSync(this.file, kept);
        this.size = kept.length;
      }
    } catch {
      // A log that cannot be written must not fail the deploy; the ring still has it.
    }
  }
}

/** A log page from lines numbered by seq. */
export function logPage(
  lines: readonly DeployLogLine[],
  after: number,
  ended: boolean,
): DeployLogPage {
  const next = lines.filter((line) => line.seq > after).slice(0, LOG_PAGE);
  const last = next.length ? next[next.length - 1]!.seq : after;
  const newest = lines.length ? lines[lines.length - 1]!.seq : 0;
  return { lines: next, next: last, done: ended && last >= newest };
}

/** What the runner needs besides the ports every stage gets. */
export type DeployStageBase = Omit<DeployStageContext, "metadata" | "earlier" | "log" | "signal">;

export interface DeployStartSpec {
  projectId: string;
  activityId: string;
  target: DeployTarget;
  selection: DeployStageSelection;
  base: DeployStageBase;
}

interface Active {
  projectId: string;
  run: DeployRun;
  controller: AbortController;
  done: Promise<void>;
}

export interface DeployRunnerDeps {
  store: DeployRunStore;
  /** Where log files go: PENGUIN_HOME/activity-deploy/logs. */
  logDir: string;
  now?: () => Date;
}

export class DeployRunner {
  private active: Active | null = null;
  private readonly logs = new Map<string, RunLog>();
  private disposed = false;
  private readonly now: () => Date;

  constructor(private readonly deps: DeployRunnerDeps) {
    this.now = deps.now ?? (() => new Date());
    deps.store.interruptRunning(this.now().toISOString());
  }

  /** The run in progress on this server, if any. */
  current(): DeployRun | null {
    return this.active?.run ?? null;
  }

  /** Starts a run; refused with 409 while another is running anywhere on this server. */
  start(spec: DeployStartSpec): DeployRun {
    if (this.disposed) throw new HttpError(503, "deploy_unavailable", "Deploys are not ready.");
    if (this.active)
      throw new HttpError(409, "deploy_running", "A deploy is already running on this server.");
    const stages = stagesFor(spec.selection);
    const run: DeployRun = {
      runId: newId("dep"),
      activityId: spec.activityId,
      target: spec.target,
      selection: spec.selection,
      status: "running",
      stages: stages.map((stage) => ({ stage, status: "pending", error: null })),
      metadata: {},
      startedAt: this.now().toISOString(),
      finishedAt: null,
    };
    const log = new RunLog(path.join(this.deps.logDir, `${run.runId}.log`), this.now);
    this.logs.set(run.runId, log);
    // Only the last few runs' rings stay in memory; older ones are read from their files.
    while (this.logs.size > 20) this.logs.delete(this.logs.keys().next().value!);
    this.deps.store.saveRun(spec.projectId, run);
    const controller = new AbortController();
    const active: Active = {
      projectId: spec.projectId,
      run,
      controller,
      done: Promise.resolve(),
    };
    this.active = active;
    active.done = this.execute(active, spec, log).finally(() => {
      if (this.active === active) this.active = null;
    });
    return structuredClone(run);
  }

  private persist(active: Active) {
    if (!this.disposed) this.deps.store.saveRun(active.projectId, active.run);
  }

  private saveStage(activityId: string, stage: DeployStage, state: StoredStage) {
    if (!this.disposed) this.deps.store.saveStage(activityId, stage, state);
  }

  private async execute(active: Active, spec: DeployStartSpec, log: RunLog) {
    const { run, controller } = active;
    const stored = this.deps.store.stages(run.activityId);
    const earlier: DeployStageContext["earlier"] = {};
    for (const stage of DEPLOY_RELEASE_STAGES) {
      const state = stored[stage];
      if (state?.status === "done") earlier[stage] = state.metadata;
    }
    let outcome: DeployRun["status"] = "succeeded";
    for (const entry of run.stages) {
      if (controller.signal.aborted) {
        entry.status = "cancelled";
        outcome = "cancelled";
        continue;
      }
      if (outcome !== "succeeded") continue;
      entry.status = "running";
      this.persist(active);
      this.saveStage(run.activityId, entry.stage, {
        status: "running",
        finishedAt: null,
        metadata: {},
      });
      // What comes after this stage must be done again once it has run.
      for (const later of DEPLOY_RELEASE_STAGES.slice(
        DEPLOY_RELEASE_STAGES.indexOf(entry.stage) + 1,
      ))
        this.saveStage(run.activityId, later, {
          status: "pending",
          finishedAt: null,
          metadata: {},
        });
      log.append(`== ${entry.stage}`);
      const ctx: DeployStageContext = {
        ...spec.base,
        metadata: run.metadata,
        earlier,
        log: (text) => log.append(text),
        signal: controller.signal,
      };
      try {
        await DEPLOY_STAGE_DEFINITIONS[entry.stage].run(ctx);
        entry.status = "done";
        this.saveStage(run.activityId, entry.stage, {
          status: "done",
          finishedAt: this.now().toISOString(),
          metadata: { ...run.metadata },
        });
      } catch (error) {
        if (this.disposed) return;
        if (error instanceof DeployStopped || controller.signal.aborted) {
          entry.status = "cancelled";
          outcome = "cancelled";
          log.append("Stopped.");
        } else {
          entry.status = "failed";
          entry.error = error instanceof DeployStageFailure ? error.error : { code: "unexpected" };
          outcome = "failed";
          if (!(error instanceof DeployStageFailure))
            log.append(`Unexpected: ${error instanceof Error ? error.message : String(error)}`);
        }
        this.saveStage(run.activityId, entry.stage, {
          status: entry.status,
          finishedAt: this.now().toISOString(),
          metadata: { ...run.metadata },
        });
      }
      this.persist(active);
    }
    if (this.disposed) return;
    run.status = outcome;
    run.finishedAt = this.now().toISOString();
    log.append(`== ${outcome}`);
    this.persist(active);
  }

  /** Stops the activity's running deploy: the child process tree is killed, the run cancelled. */
  async stop(projectId: string, activityId: string): Promise<DeployRun | null> {
    const active = this.active;
    if (!active || active.projectId !== projectId || active.run.activityId !== activityId)
      return this.deps.store.latestRun(projectId, activityId);
    active.controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      active.done,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, STOP_WAIT_MS);
        timer.unref?.();
      }),
    ]);
    clearTimeout(timer);
    return structuredClone(active.run);
  }

  /** The activity's latest run: the live one while it runs. */
  latest(projectId: string, activityId: string): DeployRun | null {
    const active = this.active;
    if (active && active.projectId === projectId && active.run.activityId === activityId)
      return structuredClone(active.run);
    return this.deps.store.latestRun(projectId, activityId);
  }

  /** The log lines after `after`, with the run they belong to; null when there is no such run. */
  log(
    projectId: string,
    activityId: string,
    runId: string,
    after: number,
  ): { log: DeployLogPage; run: DeployRun } | null {
    const active = this.active;
    const run =
      active &&
      active.run.runId === runId &&
      active.projectId === projectId &&
      active.run.activityId === activityId
        ? structuredClone(active.run)
        : this.deps.store.getRun(projectId, activityId, runId);
    if (!run) return null;
    const ended = run.status !== "running";
    const ring = this.logs.get(runId);
    if (ring) return { log: logPage(ring.lines, after, ended), run };
    let text = "";
    try {
      text = fs.readFileSync(path.join(this.deps.logDir, `${runId}.log`), "utf8");
    } catch {
      text = "";
    }
    const lines = text
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "")
      .map((line, index) => ({ seq: index + 1, at: run.finishedAt ?? run.startedAt, text: line }));
    return { log: logPage(lines, after, true), run };
  }

  /** The server is stopping: a running deploy is interrupted and its child stopped. */
  dispose() {
    if (this.disposed) return;
    const active = this.active;
    if (active) {
      const at = this.now().toISOString();
      this.deps.store.saveRun(active.projectId, interrupted(active.run, at));
      for (const entry of active.run.stages)
        if (entry.status === "running")
          this.deps.store.saveStage(active.run.activityId, entry.stage, {
            status: "failed",
            finishedAt: at,
            metadata: { ...active.run.metadata },
          });
    }
    this.disposed = true;
    active?.controller.abort();
  }
}
