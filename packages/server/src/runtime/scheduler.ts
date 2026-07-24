/**
 * Schedule runner: a Web server runtime component, active only
 * while the server runs. Loaded at server startup, then periodically reconciles by scanning the
 * `schedule/` directory.
 *
 * Key semantics:
 * - Intent vs state are separate: the file is declarative intent (never written back by the system);
 *   run state lives in SQLite.
 * - No backfill for missed fires: any due time earlier than when this scheduler first learned of the
 *   task (startup reconcile / first registration / start_at reset) is skipped — periodic tasks advance
 *   last_slot straight to now, one-shot tasks are marked missed.
 * - Queue when busy: if the bound Session is running, queue (at most one per task; new due times during
 *   the wait only advance, they don't stack), and send once it becomes idle.
 * - Bound Session deleted: record an error and mark invalid; editing the file re-activates it via reconcile.
 * - Deleting the file removes the task; reconcile also cleans up its SQLite run state and queue entry.
 */
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { agentsDir, userText } from "@prismshadow/penguin-core";
import type { ProjectsRepo } from "../db/repos/projects.js";
import type { SchedulesRepo, ScheduleStateRow } from "../db/repos/schedules.js";
import type { SessionsRepo } from "../db/repos/sessions.js";
import type { ErrorSink } from "./error-recorder.js";
import type { ScheduleDefinition } from "./schedule-file.js";
import { latestSlotAt, slotInWindow } from "./schedule-file.js";
import { listScheduleFiles, readScheduleFile, validateScheduleModelRef } from "./schedule-store.js";
import type { ScheduleServerEvent } from "../api/types.js";

/** Reconcile and fire-check interval (min period is 5m, so 30s granularity is plenty). */
const TICK_INTERVAL_MS = 30_000;

/** Minimal dependency the scheduler needs from SessionManager (eases test doubles). */
export interface ScheduleTaskRunner {
  statusOf(sessionId: string): string;
  startTask(
    sessionId: string,
    input: ReturnType<typeof userText>[],
  ): Promise<{ sessionId: string }>;
}

/** Minimal dependency the scheduler needs from SessionService: new-Session mode (model ref passed through as a pair). */
export interface ScheduleSessionCreator {
  createSession(args: {
    projectId: string;
    agentId: string;
    workspace?: string;
    modelId?: string;
    provider?: string;
    source?: "schedule";
  }): Promise<{ sessionId: string }>;
}

/**
 * Trigger input = a `[scheduled_task]` origin block (task name and fire time) + the prompt body:
 * tells the model this was fired by a schedule; the frontend collapses the origin block into a
 * one-line schedule hint (Trace shows it verbatim).
 */
export function scheduledMessage(name: string, firedAt: string, prompt: string): string {
  return [
    "[scheduled_task]",
    "This message was sent automatically by a scheduled task; its origin is listed below and the task prompt follows.",
    `schedule: ${name}`,
    `fired_at: ${firedAt}`,
    "[/scheduled_task]",
    "",
    prompt,
  ].join("\n");
}

export interface SchedulerDeps {
  root: string;
  repo: SchedulesRepo;
  projects: ProjectsRepo;
  sessions: SessionsRepo;
  runner: ScheduleTaskRunner;
  sessionCreator: ScheduleSessionCreator;
  errors: ErrorSink;
  /** Fire and send are notified over the user-level event stream (app layer binds userChannelKey). */
  notify: (userId: string, event: ScheduleServerEvent) => void;
  now?: () => number;
  intervalMs?: number;
}

/** A queued fire (at most one per task). */
interface PendingFire {
  projectId: string;
  agentId: string;
  name: string;
  sessionId: string;
}

/** In-memory view of a registered task (definition + run state + queued flag). */
export interface ScheduleEntryView {
  def: ScheduleDefinition;
  state: ScheduleStateRow;
  queued: boolean;
}

export class Scheduler {
  private readonly now: () => number;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** key = `${projectId}\0${agentId}\0${name}` */
  private readonly pending = new Map<string, PendingFire>();
  private ticking = false;

  constructor(private readonly deps: SchedulerDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.intervalMs = deps.intervalMs ?? TICK_INTERVAL_MS;
  }

  /** Start: run one reconcile immediately (startup semantics: no backfill), then enter the periodic tick. */
  async start(): Promise<void> {
    await this.tickOnce();
    this.timer = setInterval(() => {
      void this.tickOnce();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One reconcile + fire pass (deterministic entry for tests and routes; concurrent calls run only one). */
  async tickOnce(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const project of this.deps.projects.listAll()) {
        await this.reconcileProject(project.projectId, project.ownerUserId);
      }
      await this.drainQueue();
    } catch (err) {
      this.deps.errors.record({ source: "schedule", err, code: "schedule_tick_failed" });
    } finally {
      this.ticking = false;
    }
  }

  /** Immediate-effect entry after a route write: reconcile just one Agent and drain its queue. */
  async reconcileAgent(projectId: string, agentId: string): Promise<void> {
    const project = this.deps.projects.findById(projectId);
    if (!project) return;
    await this.reconcileOneAgent(projectId, agentId, project.ownerUserId);
    await this.drainQueue();
  }

  /** For route display: the task list after reconcile (including files that failed to parse). */
  async listAgent(
    projectId: string,
    agentId: string,
  ): Promise<{ entries: ScheduleEntryView[]; invalid: Array<{ name: string; error: string }> }> {
    const project = this.deps.projects.findById(projectId);
    const owner = project?.ownerUserId ?? null;
    const files = await listScheduleFiles(this.deps.root, projectId, agentId);
    const entries: ScheduleEntryView[] = [];
    const invalid: Array<{ name: string; error: string }> = [];
    for (const file of files) {
      if (!file.parsed.ok) {
        invalid.push({ name: file.name, error: file.parsed.error });
        continue;
      }
      // A model ref whose (provider, model_id) pair isn't in the config is treated like a parse failure: goes to invalidFiles, not scheduled.
      const refError = await validateScheduleModelRef(this.deps.root, projectId, file.parsed.def);
      if (refError !== null) {
        invalid.push({ name: file.name, error: refError });
        continue;
      }
      const state = this.registerEntry(projectId, agentId, owner, file.parsed.def, file.raw);
      entries.push({
        def: file.parsed.def,
        state,
        queued: this.pending.has(this.keyOf(projectId, agentId, file.name)),
      });
    }
    this.cleanupMissing(
      projectId,
      agentId,
      files.map((f) => f.name),
    );
    return { entries, invalid };
  }

  /** For routes: state cleanup after a task is deleted. */
  dropEntry(projectId: string, agentId: string, name: string): void {
    this.pending.delete(this.keyOf(projectId, agentId, name));
    this.deps.repo.delete(projectId, agentId, name);
  }

  // -------------------------------------------------------------------------

  private keyOf(projectId: string, agentId: string, name: string): string {
    return `${projectId}\0${agentId}\0${name}`;
  }

  private async reconcileProject(projectId: string, ownerUserId: string): Promise<void> {
    for (const agentId of await this.listAgentIds(projectId)) {
      await this.reconcileOneAgent(projectId, agentId, ownerUserId);
    }
  }

  /** Enumerate Agents under a Project: scheduling only cares about Agent dirs that exist on disk (no dir → no tasks). */
  private async listAgentIds(projectId: string): Promise<string[]> {
    try {
      const items = await readdir(agentsDir(this.deps.root, projectId), { withFileTypes: true });
      return items.filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return [];
    }
  }

  private async reconcileOneAgent(
    projectId: string,
    agentId: string,
    ownerUserId: string,
  ): Promise<void> {
    const files = await listScheduleFiles(this.deps.root, projectId, agentId);
    for (const file of files) {
      if (!file.parsed.ok) {
        // Skip invalid files and record an error (the recorder dedups within a short window, so storms don't spam).
        this.deps.errors.record({
          source: "schedule",
          err: new Error(`Invalid schedule file: ${file.name}.toml — ${file.parsed.error}`),
          code: "schedule_invalid_file",
          ctx: { projectId, agentId },
        });
        continue;
      }
      const def = file.parsed.def;
      // At reconcile time, check the (provider, model_id) pair names a configured model: a
      // reference that doesn't is treated like an invalid file — skip scheduling and record an
      // error (recorder dedups in a short window); it recovers once the file/config is fixed.
      const refError = await validateScheduleModelRef(this.deps.root, projectId, def);
      if (refError !== null) {
        this.deps.errors.record({
          source: "schedule",
          err: new Error(`Invalid schedule file: ${file.name}.toml — ${refError}`),
          code: "schedule_invalid_file",
          ctx: { projectId, agentId },
        });
        continue;
      }
      const state = this.registerEntry(projectId, agentId, ownerUserId, def, file.raw);
      await this.evaluateEntry(projectId, agentId, def, state);
    }
    this.cleanupMissing(
      projectId,
      agentId,
      files.map((f) => f.name),
    );
  }

  /** Register (or sync) run state; set the no-backfill baseline only at first registration / start_at reset. */
  private registerEntry(
    projectId: string,
    agentId: string,
    ownerUserId: string | null,
    def: ScheduleDefinition,
    raw: string,
  ): ScheduleStateRow {
    const defHash = createHash("sha1").update(raw).digest("hex");
    const { row, fresh } = this.deps.repo.registerOrSync({
      projectId,
      agentId,
      name: def.name,
      startAtMs: def.startAtMs,
      defHash,
      creatorUserId: ownerUserId,
    });
    if (!fresh) return row;
    // Baseline: if the due time is already in the past at registration → no backfill (mark one-shot tasks
    // missed, let periodic tasks consume all past slots); if start_at is still in the future, do nothing and fire normally when due.
    const slot = latestSlotAt(def, this.now());
    if (slot === null) return row;
    if (def.periodMs === undefined) {
      this.deps.repo.markMissed(projectId, agentId, def.name);
    } else {
      this.deps.repo.markSlot(projectId, agentId, def.name, slot);
    }
    return this.deps.repo.find(projectId, agentId, def.name) ?? row;
  }

  /** Clean up run state and queue entries for deleted files (deleting a file removes the task). */
  private cleanupMissing(projectId: string, agentId: string, presentNames: string[]): void {
    const removed = this.deps.repo.deleteMissing(projectId, agentId, presentNames);
    for (const name of removed) this.pending.delete(this.keyOf(projectId, agentId, name));
  }

  /** Fire decision: if enabled and within the window, consume new due times step by step. */
  private async evaluateEntry(
    projectId: string,
    agentId: string,
    def: ScheduleDefinition,
    state: ScheduleStateRow,
  ): Promise<void> {
    if (!def.enabled || state.invalidReason !== null) return;
    if (def.periodMs === undefined && (state.firedOnce || state.missed)) return;
    const nowMs = this.now();
    const slot = latestSlotAt(def, nowMs);
    if (slot === null || !slotInWindow(def, slot)) return;
    if (state.lastSlotMs !== null && slot <= state.lastSlotMs) return;
    // Consume this slot: never retry the same slot whether the send then succeeds, queues, or fails (the twin rule of no-backfill).
    this.deps.repo.markSlot(projectId, agentId, def.name, slot);
    await this.dispatch(projectId, agentId, def, state);
  }

  /** Send one fire: queue if the bound Session is busy; in new-Session mode, create and send immediately. */
  private async dispatch(
    projectId: string,
    agentId: string,
    def: ScheduleDefinition,
    state: ScheduleStateRow,
  ): Promise<void> {
    const key = this.keyOf(projectId, agentId, def.name);
    if (def.sessionId !== undefined) {
      const row = this.deps.sessions.findById(def.sessionId);
      if (!row || row.projectId !== projectId || row.agentId !== agentId) {
        this.deps.errors.record({
          source: "schedule",
          err: new Error(
            `Schedule ${def.name} is bound to a Session that does not exist: ${def.sessionId}`,
          ),
          code: "schedule_session_missing",
          ctx: { projectId, agentId, sessionId: def.sessionId },
        });
        this.deps.repo.markInvalid(projectId, agentId, def.name, "session_missing");
        return;
      }
      if (this.deps.runner.statusOf(def.sessionId) !== "idle") {
        // Queue when busy: at most one per task; new slots during the wait are consumed but don't stack.
        if (!this.pending.has(key)) {
          this.pending.set(key, { projectId, agentId, name: def.name, sessionId: def.sessionId });
          this.notifyFor(state, {
            type: "schedule_queued",
            projectId,
            agentId,
            name: def.name,
            sessionId: def.sessionId,
          });
        }
        return;
      }
      await this.send(projectId, agentId, def, state, def.sessionId);
      return;
    }
    // New-Session mode: each fire opens a new session (optional workspace and paired model ref; same semantics as opening a session manually).
    try {
      const info = await this.deps.sessionCreator.createSession({
        projectId,
        agentId,
        ...(def.workspace !== undefined ? { workspace: def.workspace } : {}),
        ...(def.modelId !== undefined ? { modelId: def.modelId } : {}),
        ...(def.provider !== undefined ? { provider: def.provider } : {}),
        source: "schedule",
      });
      await this.send(projectId, agentId, def, state, info.sessionId);
    } catch (err) {
      this.deps.errors.record({
        source: "schedule",
        err,
        code: "schedule_create_session_failed",
        ctx: { projectId, agentId },
      });
    }
  }

  private async send(
    projectId: string,
    agentId: string,
    def: ScheduleDefinition,
    state: ScheduleStateRow,
    sessionId: string,
  ): Promise<void> {
    const firedAt = new Date(this.now()).toISOString();
    try {
      await this.deps.runner.startTask(sessionId, [
        userText(scheduledMessage(def.name, firedAt, def.prompt)),
      ]);
    } catch (err) {
      this.deps.errors.record({
        source: "schedule",
        err,
        code: "schedule_send_failed",
        ctx: { projectId, agentId, sessionId },
      });
      return;
    }
    this.deps.repo.markFired(projectId, agentId, def.name, firedAt, def.periodMs === undefined);
    this.notifyFor(state, {
      type: "schedule_fired",
      projectId,
      agentId,
      name: def.name,
      sessionId,
    });
  }

  /** Drain the queue: send once the target Session is idle; drop if the task is disabled/deleted/invalid. */
  private async drainQueue(): Promise<void> {
    for (const [key, fire] of [...this.pending]) {
      const state = this.deps.repo.find(fire.projectId, fire.agentId, fire.name);
      if (!state || state.invalidReason !== null) {
        this.pending.delete(key);
        continue;
      }
      const file = await readScheduleFile(this.deps.root, fire.projectId, fire.agentId, fire.name);
      if (!file || !file.parsed.ok || !file.parsed.def.enabled) {
        this.pending.delete(key);
        continue;
      }
      const row = this.deps.sessions.findById(fire.sessionId);
      if (!row) {
        this.pending.delete(key);
        this.deps.repo.markInvalid(fire.projectId, fire.agentId, fire.name, "session_missing");
        continue;
      }
      if (this.deps.runner.statusOf(fire.sessionId) !== "idle") continue;
      this.pending.delete(key);
      await this.send(fire.projectId, fire.agentId, file.parsed.def, state, fire.sessionId);
    }
  }

  /** Notify the creator (falls back to the Project owner at registration; silent if still absent). */
  private notifyFor(state: ScheduleStateRow, event: ScheduleServerEvent): void {
    const userId = state.creatorUserId;
    if (userId) this.deps.notify(userId, event);
  }
}
