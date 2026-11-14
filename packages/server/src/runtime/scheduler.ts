/**
 * Schedule runner: a Web server runtime component, active only
 * while the server runs. Loaded at server startup, then periodically reconciles by scanning the
 * `schedule/` directory.
 *
 * Key semantics:
 * - Intent vs state are separate: the file is declarative intent (the system never rewrites its
 *   content); run state lives in SQLite.
 * - No backfill for missed fires: any due time earlier than when this scheduler first learned of the
 *   task (startup reconcile / first registration / start_at reset) is skipped — periodic tasks advance
 *   last_slot straight to now, one-shot tasks are marked missed.
 * - Queue when busy: if the bound Session is running, queue (at most one per task; new due times during
 *   the wait only advance, they don't stack), and send once it becomes idle.
 * - Bound Session deleted: record an error and mark invalid; editing the file re-activates it via reconcile.
 * - Deleting the file removes the task; reconcile also cleans up its SQLite run state and queue entry.
 * - Settled tasks are archived: a one-shot that fired (done), a one-shot whose time passed unseen
 *   (missed) and a task past end_at (expired) can never fire again, so reconcile and the listings
 *   move the file unchanged into `schedule/expired/` and drop its run state, as for a deleted file.
 *   A one-shot moves right after it fires, before `schedule_fired` goes out, so the refetch that
 *   event triggers no longer lists it; a task with a queued fire waits until that fire is sent.
 *   Invalid and disabled tasks stay: fixing the target or re-enabling brings them back.
 *
 * The periodic scan is mtime-gated (trace-index house pattern): the agents-dir
 * listing and each Agent's parsed schedule files are cached and revalidated by stat,
 * so an unchanged tree ticks with zero readdir/readFile — manual edits are still
 * picked up next tick because every edit variant moves an mtime the gate stats.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { agentsDir, buildScheduledMessage, userText } from "@prismshadow/penguin-core";
import type { ScheduleStateRow } from "../db/repos/schedules.js";
import { cacheable, statMtime } from "../internal/mtime-gate.js";
import type { ErrorSink } from "./error-recorder.js";
import type { ScheduleDefinition } from "./schedule-file.js";
import { latestSlotAt, slotInWindow } from "./schedule-file.js";
import {
  ScheduleFileCache,
  archiveScheduleFile,
  readScheduleFile,
  validateScheduleModelRef,
} from "./schedule-store.js";
import type { ScheduleConfigSource } from "./schedule-store.js";
import type { ScheduleServerEvent, ScheduleStatus } from "../api/types.js";
import { Component, Interface, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import { userChannelKey } from "../http/routes/events.js";
import type { Channels, Clock, Paths } from "../hmr/capabilities.js";
import type {
  Schedules,
  Scheduling,
  SessionDrivers,
  SessionIndex,
} from "../mechanisms/sessions.js";
import type { ProjectConfigStore, Projects } from "../mechanisms/projects.js";
import type { Errors } from "../mechanisms/observability.js";

/** Reconcile and fire-check interval (min period is 5m, so 30s granularity is plenty). */
const TICK_INTERVAL_MS = 30_000;

/** Minimal dependency the scheduler needs from SessionManager (eases test doubles). */
export interface ScheduleTaskRunnerShape {
  statusOf(sessionId: string): string;
  startTask(
    sessionId: string,
    input: ReturnType<typeof userText>[],
    opts?: { queueIfBusy?: boolean },
  ): Promise<{ sessionId: string; queued: boolean }>;
}

/** Minimal dependency the scheduler needs from SessionService: new-Session mode (model ref passed through as a pair). */
export interface ScheduleSessionCreatorShape {
  createSession(args: {
    projectId: string;
    agentId: string;
    workspace?: string;
    modelId?: string;
    provider?: string;
    /**
     * Unattended creators pass `allow-all`: nobody is there to answer an ask the default
     * preset's approval mode would bring.
     */
    approvalMode?: "allow-all";
    source?: "schedule" | "workbench";
    client?: "workbench";
  }): Promise<{ sessionId: string }>;
}

/** What the scheduler needs of the session runtime — declared here, at the consumer (Go style). */
export abstract class ScheduleSessionCreator extends Interface<ScheduleSessionCreatorShape>() {}
export abstract class ScheduleTaskRunner extends Interface<ScheduleTaskRunnerShape>() {}

/**
 * Trigger input = a `[scheduled_task]` origin block (task name and fire time) + the prompt
 * body: tells the model this was fired by a schedule; the frontend collapses the origin block
 * into a one-line schedule hint (Trace shows it verbatim). The block itself is built by core's
 * marker module, which also owns the parser the frontend uses.
 */
export const scheduledMessage = buildScheduledMessage;

/** A queued fire (at most one per task). */
interface PendingFire {
  projectId: string;
  agentId: string;
  name: string;
  sessionId: string;
}

/** Displayed status precedence: invalid > done/missed (one-shot) > expired > enabled flag. */
export function scheduleStatus(
  def: ScheduleDefinition,
  state: ScheduleStateRow,
  nowMs: number,
): ScheduleStatus {
  if (state.invalidReason !== null) return "invalid";
  if (def.periodMs === undefined && state.firedOnce) return "done";
  if (def.periodMs === undefined && state.missed) return "missed";
  if (def.endAtMs !== undefined && nowMs > def.endAtMs) return "expired";
  return def.enabled ? "active" : "disabled";
}

/** Settled = can never fire again without a file edit (done / missed / expired): the statuses the scheduler archives. */
export function isSettledStatus(status: ScheduleStatus): boolean {
  return status === "done" || status === "missed" || status === "expired";
}

/** In-memory view of a registered task (definition + run state + queued flag). */
export interface ScheduleEntryView {
  def: ScheduleDefinition;
  state: ScheduleStateRow;
  queued: boolean;
}

@Component()
export class Scheduler implements Scheduling {
  private intervalMs: number = TICK_INTERVAL_MS;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** key = `${projectId}\0${agentId}\0${name}` */
  private readonly pending = new Map<string, PendingFire>();
  private ticking = false;
  private filesCache: ScheduleFileCache | null = null;
  /** mtime-gated schedule-file scans (public for test observability of its counters). */
  get files(): ScheduleFileCache {
    return (this.filesCache ??= new ScheduleFileCache(this.root));
  }
  /** Per-Project agents-dir listing gate: dir mtime → Agent ids (creating/removing an Agent dir moves it). */
  private readonly agentDirs = new Map<string, { mtimeMs: number; ids: string[] }>();

  @Use() private readonly paths!: Paths;
  private get root(): string {
    return this.paths.root;
  }
  @Use() private readonly repo!: Schedules;
  @Use() private readonly projects!: Projects;
  @Use() private readonly sessions!: SessionIndex;
  @Use() private readonly runner!: ScheduleTaskRunner;
  @Use() private readonly sessionCreator!: ScheduleSessionCreator;
  /** Project-config source for model-ref validation (mtime-cached reads). */
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Use() private readonly errors!: Errors;
  @Use() private readonly channels!: Channels;
  @Use() private readonly clock!: Clock;
  /** Who a scheduled run acts for: the schedule's creator. Absent where a test wires the scheduler by hand. */
  @Use() private readonly drivers?: SessionDrivers;
  private now(): number {
    return this.clock.now().getTime();
  }

  setup({ effect }: ClassCtx): void {
    // Only active while this App is; the successor's start() reconciles missed fires.
    effect(() => this.stop());
  }

  /** Fire and send are notified over the user-level event stream. */
  private notify(userId: string, event: ScheduleServerEvent): void {
    this.channels.get(userChannelKey(userId)).publish(event, "server_event");
  }

  /**
   * Start: the periodic tick, and one reconcile now (startup semantics: no backfill) — the
   * returned promise is that first pass. The tick is armed first, so a stop that comes while
   * the pass runs leaves nothing armed; a tick that comes due meanwhile finds the pass running
   * and does nothing.
   */
  async start(): Promise<void> {
    this.timer = setInterval(() => {
      void this.tickOnce();
    }, this.intervalMs);
    this.timer.unref?.();
    await this.tickOnce();
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
      const projects = this.projects.listAll();
      for (const project of projects) {
        await this.reconcileProject(project.projectId, project.ownerUserId);
      }
      // A deleted Project simply stops being listed, so its cache entries are swept
      // here (removed Agents inside a live Project are dropped by listAgentIds).
      const live = new Set(projects.map((p) => p.projectId));
      this.files.retainProjects(live);
      for (const projectId of this.agentDirs.keys()) {
        if (!live.has(projectId)) this.agentDirs.delete(projectId);
      }
      await this.drainQueue();
    } catch (err) {
      this.errors.record({ source: "schedule", err, code: "schedule_tick_failed" });
    } finally {
      this.ticking = false;
    }
  }

  /** Immediate-effect entry after a route write: reconcile just one Agent (bypassing the mtime gate) and drain its queue. */
  async reconcileAgent(projectId: string, agentId: string): Promise<void> {
    const project = this.projects.findById(projectId);
    if (!project) return;
    await this.reconcileOneAgent(projectId, agentId, project.ownerUserId, { force: true });
    await this.drainQueue();
  }

  /** For route display: the task list after reconcile (including files that failed to parse). */
  async listAgent(
    projectId: string,
    agentId: string,
  ): Promise<{ entries: ScheduleEntryView[]; invalid: Array<{ name: string; error: string }> }> {
    const project = this.projects.findById(projectId);
    const owner = project?.ownerUserId ?? null;
    const files = await this.files.list(projectId, agentId);
    const entries: ScheduleEntryView[] = [];
    const invalid: Array<{ name: string; error: string }> = [];
    for (const file of files) {
      if (!file.parsed.ok) {
        invalid.push({ name: file.name, error: file.parsed.error });
        continue;
      }
      // A model ref whose (provider, model_id) pair isn't in the config is treated like a parse failure: goes to invalidFiles, not scheduled.
      const refError = await validateScheduleModelRef(
        this.projectConfig,
        projectId,
        file.parsed.def,
      );
      if (refError !== null) {
        invalid.push({ name: file.name, error: refError });
        continue;
      }
      const state = this.registerEntry(projectId, agentId, owner, file.parsed.def, file.raw);
      // A settled task is archived here too, so no listing ever shows one (a task found already
      // past at its first registration lands here); it stays listed only while it cannot move.
      if (await this.archiveIfSettled(projectId, agentId, file.parsed.def)) continue;
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

  /**
   * For the Project-wide route display: every Agent's tasks in one list, each stamped with the
   * Agent whose schedule directory holds it. It goes through listAgent instead of reading the
   * files itself so both listings reconcile along the same path and can never disagree about a
   * task's state. The ids are sorted because readdir order is not stable across platforms and
   * the order of this list is part of the response.
   */
  async listProject(projectId: string): Promise<{
    entries: Array<ScheduleEntryView & { agentId: string }>;
    invalid: Array<{ agentId: string; name: string; error: string }>;
  }> {
    const entries: Array<ScheduleEntryView & { agentId: string }> = [];
    const invalid: Array<{ agentId: string; name: string; error: string }> = [];
    const agentIds = [...(await this.listAgentIds(projectId))].sort();
    for (const agentId of agentIds) {
      const listed = await this.listAgent(projectId, agentId);
      for (const entry of listed.entries) entries.push({ agentId, ...entry });
      for (const bad of listed.invalid) invalid.push({ agentId, ...bad });
    }
    return { entries, invalid };
  }

  /** For routes: state cleanup after a task is deleted (the unlink moved the dir mtime, but invalidate for immediate effect anyway). */
  dropEntry(projectId: string, agentId: string, name: string): void {
    this.pending.delete(this.keyOf(projectId, agentId, name));
    this.repo.delete(projectId, agentId, name);
    this.files.invalidate(projectId, agentId);
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

  /**
   * Enumerate Agents under a Project: scheduling only cares about Agent dirs that exist on
   * disk (no dir → no tasks). mtime-gated: an unchanged agents dir serves the cached ids
   * with one stat and no readdir (creating/removing an Agent dir moves the dir's mtime);
   * removed Agents also drop their schedule-file cache entries here.
   */
  private async listAgentIds(projectId: string): Promise<string[]> {
    const cached = this.agentDirs.get(projectId);
    const mtimeMs = await statMtime(agentsDir(this.root, projectId));
    if (mtimeMs === null) {
      this.agentDirs.delete(projectId);
      return [];
    }
    if (cached && cached.mtimeMs === mtimeMs) return cached.ids;
    let ids: string[];
    try {
      const items = await fs.readdir(agentsDir(this.root, projectId), {
        withFileTypes: true,
      });
      // A dot-directory (`.deleting/`, where a deleted Agent's files wait) is never an Agent.
      ids = items.filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name);
    } catch {
      this.agentDirs.delete(projectId);
      return [];
    }
    for (const gone of cached?.ids.filter((id) => !ids.includes(id)) ?? []) {
      this.files.invalidate(projectId, gone);
    }
    this.agentDirs.set(projectId, { mtimeMs: cacheable(mtimeMs), ids });
    return ids;
  }

  private async reconcileOneAgent(
    projectId: string,
    agentId: string,
    ownerUserId: string,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    const files = await this.files.list(projectId, agentId, opts);
    for (const file of files) {
      if (!file.parsed.ok) {
        // Skip invalid files and record an error (the recorder dedups within a short window, so storms don't spam).
        this.errors.record({
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
      const refError = await validateScheduleModelRef(this.projectConfig, projectId, def);
      if (refError !== null) {
        this.errors.record({
          source: "schedule",
          err: new Error(`Invalid schedule file: ${file.name}.toml — ${refError}`),
          code: "schedule_invalid_file",
          ctx: { projectId, agentId },
        });
        continue;
      }
      const state = this.registerEntry(projectId, agentId, ownerUserId, def, file.raw);
      await this.evaluateEntry(projectId, agentId, def, state);
      await this.archiveIfSettled(projectId, agentId, def);
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
    const { row, fresh } = this.repo.registerOrSync({
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
      this.repo.markMissed(projectId, agentId, def.name);
    } else {
      this.repo.markSlot(projectId, agentId, def.name, slot);
    }
    return this.repo.find(projectId, agentId, def.name) ?? row;
  }

  /**
   * Archive a settled task (done / missed / expired): move its file unchanged into
   * `schedule/expired/` and drop its run state, exactly as if the file had been deleted.
   * Returns true when the task is gone from `schedule/` (archived now, or already gone), false
   * when it stays: not settled, a fire still queued for it (sent first; the send archives it), or
   * the move failed (recorded; the next pass tries again).
   */
  private async archiveIfSettled(
    projectId: string,
    agentId: string,
    def: ScheduleDefinition,
  ): Promise<boolean> {
    const state = this.repo.find(projectId, agentId, def.name);
    if (!state) return true;
    if (!isSettledStatus(scheduleStatus(def, state, this.now()))) return false;
    if (this.pending.has(this.keyOf(projectId, agentId, def.name))) return false;
    try {
      await archiveScheduleFile(this.root, projectId, agentId, def.name, this.now());
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.errors.record({
        source: "schedule",
        err: new Error(`Could not archive ${def.name}.toml into schedule/expired/ — ${reason}`),
        code: "schedule_archive_failed",
        ctx: { projectId, agentId },
      });
      return false;
    }
    this.repo.delete(projectId, agentId, def.name);
    this.files.invalidate(projectId, agentId);
    return true;
  }

  /** Clean up run state and queue entries for deleted files (deleting a file removes the task). */
  private cleanupMissing(projectId: string, agentId: string, presentNames: string[]): void {
    const removed = this.repo.deleteMissing(projectId, agentId, presentNames);
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
    this.repo.markSlot(projectId, agentId, def.name, slot);
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
      const row = this.sessions.findById(def.sessionId);
      if (!row || row.projectId !== projectId || row.agentId !== agentId) {
        this.errors.record({
          source: "schedule",
          err: new Error(
            `Schedule ${def.name} is bound to a Session that does not exist: ${def.sessionId}`,
          ),
          code: "schedule_session_missing",
          ctx: { projectId, agentId, sessionId: def.sessionId },
        });
        this.repo.markInvalid(projectId, agentId, def.name, "session_missing");
        return;
      }
      if (this.runner.statusOf(def.sessionId) !== "idle") {
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
      const info = await this.sessionCreator.createSession({
        projectId,
        agentId,
        ...(def.workspace !== undefined ? { workspace: def.workspace } : {}),
        ...(def.modelId !== undefined ? { modelId: def.modelId } : {}),
        ...(def.provider !== undefined ? { provider: def.provider } : {}),
        // Unattended: the Sandbox card's default preset may ask, and nobody would answer.
        approvalMode: "allow-all",
        source: "schedule",
      });
      await this.send(projectId, agentId, def, state, info.sessionId);
    } catch (err) {
      this.errors.record({
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
    // The run acts for the schedule's creator: an agent's browser calls in it drive their Chrome.
    if (state.creatorUserId) this.drivers?.note(sessionId, state.creatorUserId);
    try {
      await this.runner.startTask(sessionId, [
        // sender "server": in the Trace this user turn was injected by the server's scheduler, not typed by a human.
        userText(scheduledMessage(def.name, firedAt, def.prompt), "server"),
      ]);
    } catch (err) {
      this.errors.record({
        source: "schedule",
        err,
        code: "schedule_send_failed",
        ctx: { projectId, agentId, sessionId },
      });
      return;
    }
    this.repo.markFired(projectId, agentId, def.name, firedAt, def.periodMs === undefined);
    // A one-shot is settled the moment it fires (as is a periodic task whose last fire went out
    // after end_at): archive it before the event, or the refetch the event triggers would still
    // list it as done.
    await this.archiveIfSettled(projectId, agentId, def);
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
      const state = this.repo.find(fire.projectId, fire.agentId, fire.name);
      if (!state || state.invalidReason !== null) {
        this.pending.delete(key);
        continue;
      }
      const file = await readScheduleFile(this.root, fire.projectId, fire.agentId, fire.name);
      if (!file || !file.parsed.ok || !file.parsed.def.enabled) {
        this.pending.delete(key);
        continue;
      }
      const row = this.sessions.findById(fire.sessionId);
      if (!row) {
        this.pending.delete(key);
        this.repo.markInvalid(fire.projectId, fire.agentId, fire.name, "session_missing");
        continue;
      }
      if (this.runner.statusOf(fire.sessionId) !== "idle") continue;
      this.pending.delete(key);
      await this.send(fire.projectId, fire.agentId, file.parsed.def, state, fire.sessionId);
    }
  }

  /** Notify the creator (falls back to the Project owner at registration; silent if still absent). */
  private notifyFor(state: ScheduleStateRow, event: ScheduleServerEvent): void {
    const userId = state.creatorUserId;
    if (userId) this.notify(userId, event);
  }
}
