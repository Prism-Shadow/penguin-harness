/**
 * Scheduler runtime semantics: missed slots are not
 * backfilled; a one-shot task registered after its time is marked missed
 * immediately; periodic stepping never fires twice for the same slot; a busy
 * target queues and sends once idle; a deleted bound Session marks the task
 * invalid, recoverable by editing the file; deleting the file clears the run
 * state; new-Session mode; event notifications.
 * All tests use doubles and a controlled clock — no real LLM / core Session.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentsDir,
  projectConfigPath,
  saveProjectConfig,
  scheduleDir,
} from "@prismshadow/penguin-core";
import { openDatabase } from "../src/db/database.js";
import { ProjectsRepo } from "../src/db/repos/projects.js";
import { SchedulesRepo } from "../src/db/repos/schedules.js";
import { SessionsRepo } from "../src/db/repos/sessions.js";
import { UsersRepo } from "../src/db/repos/users.js";
import type { ErrorRecordArgs } from "../src/runtime/error-recorder.js";
import type { ScheduleSessionCreator, ScheduleTaskRunner } from "../src/runtime/scheduler.js";
import type { OmniMessage } from "@prismshadow/penguin-core";
import { Scheduler } from "../src/runtime/scheduler.js";
import { ProjectConfigService } from "../src/services/project-config-service.js";
import type { ScheduleServerEvent } from "../src/api/types.js";
import { makeTempRoot } from "./helpers.js";
import { wire } from "@prismshadow/penguin-core/kernel";

const P = "p1";
const A = "agent_x";
const T0 = Date.parse("2026-07-16T09:00:00Z");
const MIN = 60_000;

describe("scheduler", () => {
  let root: string;
  let db: ReturnType<typeof openDatabase>;
  let repo: SchedulesRepo;
  let sessions: SessionsRepo;
  let nowMs: number;
  let busy: Set<string>;
  let started: Array<{ sessionId: string; text: string }>;
  let created: Array<{
    projectId: string;
    agentId: string;
    workspace?: string;
    provider?: string;
    modelId?: string;
    source?: "schedule";
  }>;
  let events: Array<{ userId: string; event: ScheduleServerEvent }>;
  let errors: ErrorRecordArgs[];
  let scheduler: Scheduler;

  beforeEach(async () => {
    root = await makeTempRoot();
    // A schedule's model reference is checked against the Project config during
    // reconciliation, so provide a minimal config here: the file must name the whole
    // (provider, model_id) pair for it to match.
    await saveProjectConfig(root, P, {
      default_model: { provider: "custom", model_id: "m-bench" },
      models: [{ provider: "custom", model_id: "m-bench" }],
    });
    db = openDatabase(":memory:");
    const users = wire(UsersRepo, { db: db });
    users.insert({
      userId: "owner_a",
      passwordHash: "x",
      isAdmin: false,
      passwordIsInitial: false,
      createdAt: "2026-07-16T00:00:00Z",
    });
    const projects = wire(ProjectsRepo, { db: db });
    projects.insert({ projectId: P, ownerUserId: "owner_a", createdAt: "2026-07-16T00:00:00Z" });
    repo = wire(SchedulesRepo, { db: db });
    sessions = wire(SessionsRepo, { db: db });
    nowMs = T0;
    busy = new Set();
    started = [];
    created = [];
    events = [];
    errors = [];
    let seq = 0;
    scheduler = wire(Scheduler, {
      paths: { root },
      repo,
      projects,
      sessions,
      runner: {
        statusOf: (id: string) => (busy.has(id) ? "running" : "idle"),
        startTask: async (sessionId: string, input: OmniMessage[]) => {
          started.push({ sessionId, text: JSON.stringify(input[0]?.payload ?? "") });
          return { sessionId };
        },
      } satisfies ScheduleTaskRunner,
      sessionCreator: {
        createSession: async (args: Parameters<ScheduleSessionCreator["createSession"]>[0]) => {
          created.push(args);
          const sessionId = `session-new-${++seq}`;
          insertSession(sessionId);
          return { sessionId };
        },
      },
      projectConfig: wire(ProjectConfigService, { paths: { root } }),
      errors: { record: (args: ErrorRecordArgs) => void errors.push(args) },
      notify: (userId: string, event: ScheduleServerEvent) => void events.push({ userId, event }),
      now: () => nowMs,
    });
    await fs.mkdir(scheduleDir(root, P, A), { recursive: true });
  });
  afterEach(() => {
    scheduler.stop();
    db.close();
  });

  function insertSession(sessionId: string): void {
    sessions.insert({
      sessionId,
      projectId: P,
      agentId: A,
      modelId: "m1",
      provider: "custom",
      workspace: "/tmp/w",
      approvalMode: "allow-all",
      title: null,
      createdAt: new Date(nowMs).toISOString(),
      lastActiveAt: new Date(nowMs).toISOString(),
    });
  }

  async function writeFile(name: string, lines: string[]): Promise<void> {
    await fs.writeFile(
      path.join(scheduleDir(root, P, A), `${name}.toml`),
      lines.join("\n"),
      "utf8",
    );
  }

  function iso(ms: number): string {
    return new Date(ms).toISOString();
  }

  /**
   * Ages the given paths' mtimes past the mtime gate's FRESH_MS window (fresh mtimes are
   * deliberately never cached as clean), so steady-state assertions see a tree that looks
   * quiet — exactly like files written minutes ago. Fixed instants keep backdates idempotent
   * and let a later edit be given a *different* stable mtime.
   */
  async function backdate(paths: string[], instant = "2026-01-01T00:00:00Z"): Promise<void> {
    const at = new Date(instant);
    for (const p of paths) await fs.utimes(p, at, at);
  }

  it("steady state: an unchanged tree ticks with zero file reads and zero dir listings (stat-gated); a new file re-scans", async () => {
    insertSession("session-1");
    // Carries a model reference so every tick also exercises model-ref validation —
    // the per-tick .project_config.toml read+parse this change eliminates.
    await writeFile("cached", [
      `prompt = "cached prompt"`,
      `enabled = true`,
      `start_at = "${iso(T0 + 60 * MIN)}"`,
      `period = "30m"`,
      `provider = "custom"`,
      `model_id = "m-bench"`,
    ]);
    await backdate([
      agentsDir(root, P),
      scheduleDir(root, P, A),
      path.join(scheduleDir(root, P, A), "cached.toml"),
      projectConfigPath(root, P),
    ]);
    await scheduler.tickOnce(); // First look: populates the gate caches (this pass reads).
    expect(repo.find(P, A, "cached")).not.toBeNull();

    const fileReads = scheduler.files.counters.fileReads;
    const dirScans = scheduler.files.counters.dirScans;
    const readFileSpy = vi.spyOn(fs, "readFile");
    const readdirSpy = vi.spyOn(fs, "readdir");
    await scheduler.tickOnce();
    await scheduler.tickOnce();
    // Unchanged tree: the ticks are pure stats — no schedule-file reads, no readdir of the
    // agents/schedule dirs, and no .project_config.toml read for model-ref validation either.
    expect(scheduler.files.counters.fileReads).toBe(fileReads);
    expect(scheduler.files.counters.dirScans).toBe(dirScans);
    expect(readFileSpy).not.toHaveBeenCalled();
    expect(readdirSpy).not.toHaveBeenCalled();
    readFileSpy.mockRestore();
    readdirSpy.mockRestore();

    // A new file moves the schedule dir's mtime: the gate notices and registers it.
    await writeFile("added", [
      `prompt = "a"`,
      `enabled = true`,
      `start_at = "${iso(T0 + 60 * MIN)}"`,
      `session_id = "session-1"`,
    ]);
    await scheduler.tickOnce();
    expect(repo.find(P, A, "added")).not.toBeNull();
    expect(scheduler.files.counters.dirScans).toBe(dirScans + 1);
  });

  it("an in-place edit (file mtime moves, dir mtime does not) is picked up next tick and fires with the new content", async () => {
    insertSession("session-1");
    await writeFile("inplace", [
      `prompt = "old prompt"`,
      `enabled = true`,
      `start_at = "${iso(T0 + 5 * MIN)}"`,
      `period = "5m"`,
      `session_id = "session-1"`,
    ]);
    await backdate([
      agentsDir(root, P),
      scheduleDir(root, P, A),
      path.join(scheduleDir(root, P, A), "inplace.toml"),
      projectConfigPath(root, P),
    ]);
    await scheduler.tickOnce(); // Populate the gate caches at the stable mtimes.
    await scheduler.tickOnce(); // Steady state: served from memory.

    // Overwriting an existing file's CONTENT never moves the directory's mtime — only the
    // file's own — which is exactly what the per-file stats of the unchanged-dir path catch.
    await writeFile("inplace", [
      `prompt = "new prompt"`,
      `enabled = true`,
      `start_at = "${iso(T0 + 5 * MIN)}"`,
      `period = "5m"`,
      `session_id = "session-1"`,
    ]);
    await backdate([path.join(scheduleDir(root, P, A), "inplace.toml")], "2026-01-01T00:01:00Z");

    nowMs = T0 + 5 * MIN;
    const dirScans = scheduler.files.counters.dirScans;
    await scheduler.tickOnce();
    expect(started).toHaveLength(1);
    expect(started[0]?.text).toContain("new prompt");
    expect(started[0]?.text).not.toContain("old prompt");
    // The pickup came from the unchanged-dir path's per-file stat, not a directory rescan.
    expect(scheduler.files.counters.dirScans).toBe(dirScans);
  });

  it("periodic task: registration consumes past slots (missed, not backfilled); fires once on time, never twice", async () => {
    insertSession("session-1");
    await writeFile("report", [
      `prompt = "Write the daily report"`,
      `enabled = true`,
      `start_at = "${iso(T0 - 60 * MIN)}"`,
      `period = "30m"`,
      `session_id = "session-1"`,
    ]);
    await scheduler.tickOnce(); // Registration: all slots before 09:00 are consumed without firing.
    expect(started).toHaveLength(0);

    nowMs = T0 + 30 * MIN; // The next slot that should fire (start+90m)
    await scheduler.tickOnce();
    expect(started).toHaveLength(1);
    expect(started[0]?.sessionId).toBe("session-1");
    // Trigger input = [scheduled_task] source block + the prompt body (tells the model this is a scheduled task).
    expect(started[0]?.text).toContain("[scheduled_task]");
    expect(started[0]?.text).toContain("schedule: report");
    expect(started[0]?.text).toContain("Write the daily report");
    expect(events.map((e) => e.event.type)).toContain("schedule_fired");
    expect(events[0]?.userId).toBe("owner_a");

    await scheduler.tickOnce(); // The same slot doesn't fire twice.
    expect(started).toHaveLength(1);

    const state = repo.find(P, A, "report");
    expect(state?.lastFiredAt).toBe(iso(T0 + 30 * MIN));
  });

  it("one-shot task: fires once when the future slot arrives; already expired at registration is marked missed and never fires", async () => {
    insertSession("session-1");
    await writeFile("future", [
      `prompt = "f"`,
      `enabled = true`,
      `start_at = "${iso(T0 + 10 * MIN)}"`,
      `session_id = "session-1"`,
    ]);
    await writeFile("stale", [
      `prompt = "s"`,
      `enabled = true`,
      `start_at = "${iso(T0 - 10 * MIN)}"`,
      `session_id = "session-1"`,
    ]);
    await scheduler.tickOnce();
    expect(started).toHaveLength(0);
    expect(repo.find(P, A, "stale")?.missed).toBe(true);

    nowMs = T0 + 11 * MIN;
    await scheduler.tickOnce();
    expect(started).toHaveLength(1);
    expect(repo.find(P, A, "future")?.firedOnce).toBe(true);

    nowMs = T0 + 60 * MIN;
    await scheduler.tickOnce();
    expect(started).toHaveLength(1);
  });

  it("busy queueing: a running target queues and notifies, sends once idle; repeated slots don't stack", async () => {
    insertSession("session-1");
    busy.add("session-1");
    await writeFile("q", [
      `prompt = "queued"`,
      `enabled = true`,
      `start_at = "${iso(T0)}"`,
      `period = "5m"`,
      `session_id = "session-1"`,
    ]);
    // Let registration happen before start_at, so the registration baseline
    // doesn't consume the first slot.
    nowMs = T0 - MIN;
    await scheduler.tickOnce();
    nowMs = T0;
    await scheduler.tickOnce();
    expect(started).toHaveLength(0);
    expect(events.map((e) => e.event.type)).toEqual(["schedule_queued"]);

    nowMs = T0 + 5 * MIN; // Another slot: still busy, so it's just consumed, not re-queued.
    await scheduler.tickOnce();
    expect(events.map((e) => e.event.type)).toEqual(["schedule_queued"]);

    busy.delete("session-1");
    nowMs = T0 + 6 * MIN;
    await scheduler.tickOnce();
    expect(started).toHaveLength(1);
    expect(events.map((e) => e.event.type)).toEqual(["schedule_queued", "schedule_fired"]);
  });

  it("missing bound Session: records an error and marks invalid; recovers after the file is edited", async () => {
    await writeFile("ghost", [
      `prompt = "g"`,
      `enabled = true`,
      `start_at = "${iso(T0 - MIN)}"`,
      `period = "5m"`,
      `session_id = "session-gone"`,
    ]);
    nowMs = T0 - 10 * MIN;
    await scheduler.tickOnce(); // Registration (the first future slot hasn't arrived yet).
    nowMs = T0 + 4 * MIN;
    await scheduler.tickOnce(); // Slot arrives: Session doesn't exist → invalidated.
    expect(errors.some((e) => e.code === "schedule_session_missing")).toBe(true);
    expect(repo.find(P, A, "ghost")?.invalidReason).toBe("session_missing");

    nowMs = T0 + 9 * MIN;
    await scheduler.tickOnce(); // No further attempts while invalid.
    expect(errors.filter((e) => e.code === "schedule_session_missing")).toHaveLength(1);

    // Editing the file (rebinding to an existing Session): clears the invalid state and resumes firing.
    insertSession("session-2");
    await writeFile("ghost", [
      `prompt = "g2"`,
      `enabled = true`,
      `start_at = "${iso(T0 - MIN)}"`,
      `period = "5m"`,
      `session_id = "session-2"`,
    ]);
    nowMs = T0 + 14 * MIN;
    await scheduler.tickOnce();
    expect(repo.find(P, A, "ghost")?.invalidReason).toBeNull();
    expect(started.map((s) => s.sessionId)).toEqual(["session-2"]);
  });

  it("enabled=false never fires; deleting the file clears the run state", async () => {
    insertSession("session-1");
    await writeFile("off", [
      `prompt = "o"`,
      `enabled = false`,
      `start_at = "${iso(T0 - MIN)}"`,
      `period = "5m"`,
      `session_id = "session-1"`,
    ]);
    nowMs = T0 + 30 * MIN;
    await scheduler.tickOnce();
    expect(started).toHaveLength(0);
    expect(repo.find(P, A, "off")).not.toBeNull();

    await fs.unlink(path.join(scheduleDir(root, P, A), "off.toml"));
    await scheduler.tickOnce();
    expect(repo.find(P, A, "off")).toBeNull();
  });

  it("new-Session mode: every trigger opens a fresh session and sends (passing workspace through)", async () => {
    await writeFile("fresh", [
      `prompt = "fresh session"`,
      `enabled = true`,
      `start_at = "${iso(T0 + MIN)}"`,
      `period = "5m"`,
      `workspace = "/tmp/ws"`,
      `provider = "custom"`,
      `model_id = "m-bench"`,
    ]);
    await scheduler.tickOnce();
    nowMs = T0 + MIN;
    await scheduler.tickOnce();
    nowMs = T0 + 6 * MIN;
    await scheduler.tickOnce();
    expect(created).toHaveLength(2);
    // The file's model reference is passed straight through as a pair; every schedule-opened
    // session is marked with its origin (SessionService stores it on the row and in core session_meta).
    expect(created[0]).toMatchObject({
      projectId: P,
      agentId: A,
      workspace: "/tmp/ws",
      provider: "custom",
      modelId: "m-bench",
      source: "schedule",
    });
    expect(started.map((s) => s.sessionId)).toEqual(["session-new-1", "session-new-2"]);
  });

  it("new-Session mode: omitting the model reference entirely leaves the Project default to the session creator", async () => {
    await writeFile("default-model", [
      `prompt = "default"`,
      `enabled = true`,
      `start_at = "${iso(T0 + MIN)}"`,
    ]);
    await scheduler.tickOnce();
    nowMs = T0 + MIN;
    await scheduler.tickOnce();
    expect(created).toHaveLength(1);
    expect("provider" in created[0]!).toBe(false);
    expect("modelId" in created[0]!).toBe(false);
  });

  it("a file carrying model_id without provider is invalid: never scheduled, error recorded", async () => {
    // A schedule file persisted before the pairing rule can hold model_id alone. It must
    // fail exactly like any other invalid file — skipped with an error recorded — rather
    // than resolving the provider or throwing out of the tick loop.
    await writeFile("legacy", [
      `prompt = "legacy"`,
      `enabled = true`,
      `start_at = "${iso(T0 + MIN)}"`,
      `model_id = "m-bench"`,
    ]);
    await scheduler.tickOnce();
    nowMs = T0 + 2 * MIN;
    await scheduler.tickOnce();
    expect(created).toHaveLength(0);
    expect(started).toHaveLength(0);
    expect(repo.find(P, A, "legacy")).toBeNull();
    const recorded = errors.filter((e) => e.code === "schedule_invalid_file");
    expect(recorded.length).toBeGreaterThan(0);
    expect((recorded[0]?.err as Error).message).toContain("given together");
  });

  it("invalid files are skipped with an error recorded, without affecting other tasks", async () => {
    insertSession("session-1");
    await writeFile("bad", [`prompt = "x"`, `enabled = true`, `start_at = "nonsense"`]);
    await writeFile("good", [
      `prompt = "g"`,
      `enabled = true`,
      `start_at = "${iso(T0 + MIN)}"`,
      `session_id = "session-1"`,
    ]);
    await scheduler.tickOnce();
    nowMs = T0 + 2 * MIN;
    await scheduler.tickOnce();
    expect(errors.some((e) => e.code === "schedule_invalid_file")).toBe(true);
    expect(started).toHaveLength(1);
  });
});
