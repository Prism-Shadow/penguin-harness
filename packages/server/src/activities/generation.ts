import fs from "node:fs/promises";
import path from "node:path";
import { userText } from "@prismshadow/penguin-core";
import { Component, Use, type ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { Config, Db, Channels, Log } from "../hmr/capabilities.js";
import type { ActivityAuthoring, ActivityGeneration } from "../mechanisms/activities.js";
import type { AgentConfig } from "../mechanisms/agents.js";
import type { Sessions, SessionServiceIface } from "../runtime/session-manager.js";
import { HttpError } from "../http/errors.js";
import { ActivityLocks, atomicJson } from "./service.js";
import {
  newId,
  validateActivitySpec,
  type ActivityRun,
  type ActivityRunSummary,
} from "./domain.js";

const MAX_CANDIDATE_BYTES = 2 * 1024 * 1024;
interface Observer {
  unsubscribe: () => void;
  completed: boolean;
  error: string | null;
}

@Component()
export class ActivityGenerationService implements ActivityGeneration {
  @Use() private readonly config!: Config;
  @Use() private readonly db!: Db;
  @Use() private readonly activities!: ActivityAuthoring;
  @Use() private readonly agents!: AgentConfig;
  @Use() private readonly sessions!: Sessions;
  @Use() private readonly sessionService!: SessionServiceIface;
  @Use() private readonly channels!: Channels;
  @Use() private readonly log!: Log;
  private readonly locks = new ActivityLocks();
  private readonly observers = new Map<string, Observer>();
  private readonly operations = new Set<Promise<unknown>>();
  private stopped = false;
  private drained: Promise<void> | null = null;
  private tick: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  setup({ effect }: ClassCtx) {
    // A restart or hot replacement cannot prove an old task finished. Preserve its
    // workspace and record the uncertainty; retry always creates a new attempt.
    for (const run of this.running())
      this.finish(run, "interrupted", "Server restarted. Review the session and retry explicitly.");
    this.timer = setInterval(() => {
      if (!this.tick && !this.stopped) {
        this.tick = this.reconcile()
          .catch((error: unknown) => {
            this.log.line(`[activities] Generation reconciliation failed: ${String(error)}`);
          })
          .finally(() => {
            this.tick = null;
          });
      }
    }, 1000);
    this.timer.unref();
    effect(() => this.stop());
  }

  private stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (const observer of this.observers.values()) observer.unsubscribe();
    this.observers.clear();
    // Effects seal admissions synchronously. The App awaits shutdown's drain before
    // closing the DB or booting a successor, so an entered publication can commit its
    // matching terminal record before the remaining attempts become interrupted.
    const finishRemaining = () => {
      for (const run of this.running())
        this.finish(run, "interrupted", "Server stopped before the result was published.");
    };
    if (this.operations.size) {
      this.drained = Promise.allSettled([...this.operations]).then(finishRemaining);
    } else {
      finishRemaining();
      this.drained = Promise.resolve();
    }
  }
  async shutdown(): Promise<void> {
    this.stop();
    await this.drained;
  }

  private workspace(run: ActivityRun): string {
    return path.join(this.config.root, "activity-runs", run.runId);
  }
  private save(run: ActivityRun) {
    this.db
      .prepare("UPDATE activity_runs SET status = ?, record_json = ? WHERE run_id = ?")
      .run(run.status, JSON.stringify(run), run.runId);
  }
  private running(): ActivityRun[] {
    return (
      this.db.prepare("SELECT record_json FROM activity_runs WHERE status = 'running'").all() as {
        record_json: string;
      }[]
    ).map((row) => JSON.parse(row.record_json) as ActivityRun);
  }
  private finish(run: ActivityRun, status: ActivityRun["status"], error: string | null = null) {
    run.status = status;
    run.error = error;
    run.finishedAt = new Date().toISOString();
    this.save(run);
    this.observers.get(run.runId)?.unsubscribe();
    this.observers.delete(run.runId);
  }
  private track<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation);
    void operation.finally(() => this.operations.delete(operation)).catch(() => {});
    return operation;
  }

  async list(projectId: string, activityId: string): Promise<ActivityRunSummary[]> {
    await this.activities.getActivity(projectId, activityId);
    return (
      this.db
        .prepare(
          "SELECT json_remove(record_json, '$.candidate') AS record_json, json_type(record_json, '$.candidate') = 'text' AS has_candidate FROM activity_runs WHERE project_id = ? AND activity_id = ? ORDER BY created_at DESC, run_id DESC LIMIT 50",
        )
        .all(projectId, activityId) as { record_json: string; has_candidate: number }[]
    ).map((row) => ({ ...JSON.parse(row.record_json), hasCandidate: !!row.has_candidate }));
  }

  private async getRun(projectId: string, activityId: string, runId: string): Promise<ActivityRun> {
    await this.activities.getActivity(projectId, activityId);
    const row = this.db
      .prepare(
        "SELECT record_json FROM activity_runs WHERE project_id = ? AND activity_id = ? AND run_id = ?",
      )
      .get(projectId, activityId, runId) as { record_json: string } | undefined;
    if (!row) throw new HttpError(404, "run_not_found", "Generation not found.");
    return JSON.parse(row.record_json) as ActivityRun;
  }

  async candidate(projectId: string, activityId: string, runId: string): Promise<string | null> {
    return (await this.getRun(projectId, activityId, runId)).candidate;
  }

  start(
    projectId: string,
    activityId: string,
    agentId: string,
    expectedRevision: string,
  ): Promise<ActivityRun> {
    return this.track(
      this.locks.run(activityId, async () => {
        if (this.stopped) throw new HttpError(503, "activity_stopping", "Server is stopping.");
        const activity = await this.activities.getActivity(projectId, activityId);
        if (activity.draft.contentRevision !== expectedRevision)
          throw new HttpError(409, "draft_conflict", "Save or reload the draft before generating.");
        if (!activity.draft.description.trim())
          throw new HttpError(400, "description_required", "Add a description before generating.");
        await this.agents.requireExists(projectId, agentId);
        if (this.stopped) throw new HttpError(503, "activity_stopping", "Server is stopping.");
        if (this.running().some((run) => run.activityId === activityId))
          throw new HttpError(
            409,
            "generation_running",
            "This activity already has a running generation.",
          );
        const run: ActivityRun = {
          runId: newId("run"),
          activityId,
          projectId,
          draftId: activity.draft.draftId,
          inputRevision: activity.draft.contentRevision,
          agentId,
          sessionId: null,
          status: "running",
          createdAt: new Date().toISOString(),
          finishedAt: null,
          error: null,
          candidate: null,
        };
        this.db
          .prepare(
            "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, record_json) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(run.runId, projectId, activityId, run.status, run.createdAt, JSON.stringify(run));
        try {
          const workspace = this.workspace(run);
          await fs.mkdir(workspace, { recursive: true });
          await atomicJson(path.join(workspace, "input.json"), activity);
          await fs.writeFile(
            path.join(workspace, "description.md"),
            activity.draft.description,
            "utf8",
          );
          if (this.stopped) {
            this.finish(run, "interrupted", "Server stopped before generation started.");
            return run;
          }
          const session = await this.sessionService.createSession({
            projectId,
            agentId,
            workspace,
            approvalMode: "always-ask",
          });
          run.sessionId = session.sessionId;
          this.save(run);
          if (this.stopped) {
            this.finish(run, "interrupted", "Server stopped before generation started.");
            return run;
          }
          const observer: Observer = { unsubscribe: () => {}, completed: false, error: null };
          observer.unsubscribe = this.channels.get(session.sessionId).subscribe((event) => {
            if (event.event) return;
            const msg = JSON.parse(event.data) as {
              origin?: unknown[];
              payload?: { type?: string; status?: string; error_message?: string };
            };
            if (msg.origin?.length) return;
            const payload = msg.payload;
            if (payload?.type === "request_begin") observer.completed = false;
            if (payload?.type === "request_end") {
              observer.completed = payload.status === "completed";
              observer.error = observer.completed
                ? null
                : (payload.error_message ?? "The model request did not complete.");
            }
            if (payload?.type === "abort") {
              observer.completed = false;
              observer.error = "Session was stopped.";
            }
          });
          this.observers.set(run.runId, observer);
          await this.sessions.startTask(session.sessionId, [userText(generationPrompt)], {
            queueIfBusy: false,
          });
        } catch (error) {
          this.finish(
            run,
            this.stopped ? "interrupted" : "failed",
            error instanceof HttpError
              ? error.message
              : "Could not start generation. Check the agent and model configuration.",
          );
        }
        return run;
      }),
    );
  }

  cancel(projectId: string, activityId: string, runId: string): Promise<ActivityRun> {
    return this.track(
      this.locks.run(activityId, async () => {
        if (this.stopped) throw new HttpError(503, "activity_stopping", "Server is stopping.");
        const run = await this.getRun(projectId, activityId, runId);
        if (this.stopped) throw new HttpError(503, "activity_stopping", "Server is stopping.");
        if (run.status === "running") {
          this.finish(run, "cancelled", "Generation cancelled.");
          if (run.sessionId) this.sessions.abortTask(run.sessionId);
        }
        return run;
      }),
    );
  }

  /** Deterministic reconciliation entry used by the timer and lifecycle tests. */
  reconcile(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return this.track(this.collect());
  }

  private async collect(): Promise<void> {
    if (this.stopped) return;
    for (const initial of this.running()) {
      await this.locks.run(initial.activityId, async () => {
        if (this.stopped) return;
        const run = this.running().find((item) => item.runId === initial.runId);
        if (
          !run ||
          !run.sessionId ||
          this.stopped ||
          this.sessions.statusOf(run.sessionId) !== "idle"
        )
          return;
        try {
          await this.sessions.atIdleBoundary(run.sessionId, async () => {
            const file = path.join(this.workspace(run), "activity-spec.json");
            try {
              const stat = await fs.lstat(file);
              if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CANDIDATE_BYTES)
                throw new Error("The output must be a regular JSON file smaller than 2 MiB.");
              run.candidate = await fs.readFile(file, "utf8");
              this.save(run);
              if (this.stopped) return;
              const observer = this.observers.get(run.runId);
              if (!observer?.completed)
                throw new Error(
                  observer?.error ?? "The session ended without a confirmed completed request.",
                );
              const spec = validateActivitySpec(JSON.parse(run.candidate));
              // Cancellation and completion share the activity lock. The authoring
              // service separately serializes this comparison against draft edits.
              if (this.stopped) return;
              await this.activities.applySpec(
                run.projectId,
                run.activityId,
                spec,
                run.inputRevision,
              );
              this.finish(run, "succeeded");
            } catch (error) {
              if (this.stopped && run.candidate === null) return;
              const conflict = error instanceof HttpError && error.code === "draft_conflict";
              const message =
                (error as NodeJS.ErrnoException).code === "ENOENT"
                  ? "The session ended without activity-spec.json."
                  : error instanceof Error
                    ? error.message
                    : "Could not collect generation output.";
              this.finish(run, conflict ? "conflict" : "failed", message);
            }
          });
        } catch {
          // A user may have resumed this session between the idle probe and its lock.
          // Leave the run active for the next tick.
        }
      });
    }
  }
}

const generationPrompt = `Generate a WAF HTML activity specification from description.md and input.json.
Work in this workspace. Write activity-spec.json as a JSON object, without Markdown fences.
Do not edit the input files or any activity collection. Do not delegate this task.
The specification contract:
- id: safe letters/numbers/dots/underscores/hyphens, starting and ending with a letter or number.
- title: non-empty string; activityDescription: string.
- moduleFolder, if present: waf-module- followed by a safe id.
- runtime: { "engine": "html", "layout": "mainOnly", "theme": "park", "resolution": "640x480", "usesAssessment": false }. Choose layout, theme and resolution appropriate to the description.
- scenes: a non-empty array of objects with string id and description.
- Optional scene media: images, video and animations arrays of { key, description, targetPath? } with string values.
- Optional scene audio: tracks array of { key, description, script?, targetPath?, interruptible? }; interruptible is boolean.
- Optional acceptance_criterias: string array; audience: null or { gradeBand: string or null }.
Describe the actual learning flow, interactions, feedback and media needs. Preserve useful existing draft details in input.json.
Use Harness's normal approval flow for tool actions. Finish only after writing valid JSON.`;
