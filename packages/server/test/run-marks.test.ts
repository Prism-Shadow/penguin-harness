/**
 * Durable run marks + cold-boot resume (see src/runtime/run-marks.ts):
 * - the file store round-trips marks, skips corrupt files, and never lists its own
 *   guard file as a mark;
 * - the crash-loop guard counts attempts inside an hour and rolls over after it;
 * - resume restarts every marked Session with the server_restart prompt, drops the mark
 *   when the Session is gone or the start fails deterministically, leaves busy and
 *   shutting-down marks alone, and refuses a poison run after three attempts an hour;
 * - when the loader heals a Session under a new id, the stale mark is removed.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OmniMessage } from "@prismshadow/penguin-core";
import { HttpError } from "../src/http/errors.js";
import {
  RESUME_AFTER_RESTART,
  RESUME_GUARD_MAX_ATTEMPTS,
  createFileRunMarkStore,
  resumeInterruptedSessions,
} from "../src/runtime/run-marks.js";
import type { RunMark } from "../src/runtime/run-marks.js";

describe("run-marks", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "run-marks-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("round-trips marks; markEnd drops the mark and the guard", () => {
    const store = createFileRunMarkStore(root, { onError: () => {} });
    expect(store.listMarks()).toEqual([]);
    store.markStart("session-1", { projectId: "p1", agentId: "a1" });
    const marks = store.listMarks();
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ sessionId: "session-1", projectId: "p1", agentId: "a1" });
    store.noteResumeAttempt("session-1");
    expect(store.readResumeGuard("session-1")).toMatchObject({ count: 1 });
    store.markEnd("session-1");
    expect(store.listMarks()).toEqual([]);
    expect(store.readResumeGuard("session-1")).toBeUndefined();
  });

  it("skips corrupt marks and never lists the guard file as a mark", async () => {
    const store = createFileRunMarkStore(root, { onError: () => {} });
    store.markStart("session-1", { projectId: "p1", agentId: "a1" });
    store.noteResumeAttempt("session-1");
    await writeFile(path.join(root, "session-runs", "session-2.json"), "{not json");
    await writeFile(path.join(root, "session-runs", "resume-state.json.bak"), "{}");
    const marks = store.listMarks();
    expect(marks.map((m) => m.sessionId)).toEqual(["session-1"]);
  });

  it("guard rolls the window over after an hour", () => {
    const store = createFileRunMarkStore(root, { onError: () => {} });
    expect(store.noteResumeAttempt("session-1", 1_000)).toMatchObject({ count: 1 });
    expect(store.noteResumeAttempt("session-1", 2_000)).toMatchObject({ count: 2 });
    expect(store.noteResumeAttempt("session-1", 3_700_000)).toMatchObject({ count: 1 });
  });

  it("resume restarts every marked session with the server_restart prompt", async () => {
    const store = createFileRunMarkStore(root, { onError: () => {} });
    store.markStart("session-1", { projectId: "p1", agentId: "a1" });
    store.markStart("session-2", { projectId: "p1", agentId: "a1" });
    const started: { sessionId: string; input: OmniMessage[] }[] = [];
    const logs: string[] = [];
    const res = await resumeInterruptedSessions({
      store,
      starter: {
        startTask: async (sessionId, input) => {
          started.push({ sessionId, input });
          return { sessionId, queued: false };
        },
      },
      log: (line) => logs.push(line),
    });
    expect(res).toEqual({ resumed: ["session-1", "session-2"], skipped: [] });
    expect(started).toHaveLength(2);
    for (const s of started) {
      expect(s.input).toHaveLength(1);
      const payload = s.input[0]!.payload as { text?: string; sender?: string };
      expect(payload.text).toBe(RESUME_AFTER_RESTART);
      expect(payload.sender).toBe("server");
    }
    // Attempts are counted for the loop guard; the new drives own their marks now.
    expect(store.readResumeGuard("session-1")).toMatchObject({ count: 1 });
  });

  it("resume refuses a poison run after three attempts inside an hour", async () => {
    const store = createFileRunMarkStore(root, { onError: () => {} });
    store.markStart("session-1", { projectId: "p1", agentId: "a1" });
    for (let i = 0; i < RESUME_GUARD_MAX_ATTEMPTS; i++) store.noteResumeAttempt("session-1");
    let calls = 0;
    const errors: { code: string; mark: RunMark }[] = [];
    const res = await resumeInterruptedSessions({
      store,
      starter: {
        startTask: async (sessionId) => {
          calls += 1;
          return { sessionId, queued: false };
        },
      },
      log: () => {},
      recordError: (code, _err, mark) => errors.push({ code, mark }),
    });
    expect(calls).toBe(0);
    expect(res.skipped).toEqual([{ sessionId: "session-1", reason: "loop_guard" }]);
    expect(store.listMarks()).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe("auto_resume_loop");
  });

  it("resume leaves busy marks alone but drops gone ones without an error record", async () => {
    const store = createFileRunMarkStore(root, { onError: () => {} });
    store.markStart("session-busy", { projectId: "p1", agentId: "a1" });
    store.markStart("session-gone", { projectId: "p1", agentId: "a1" });
    const errors: { code: string }[] = [];
    const res = await resumeInterruptedSessions({
      store,
      starter: {
        startTask: async (sessionId) => {
          if (sessionId === "session-busy") throw new HttpError(409, "task_in_progress", "busy");
          throw new HttpError(404, "session_not_found", "gone");
        },
      },
      log: () => {},
      recordError: (code) => errors.push({ code }),
    });
    expect(res.resumed).toEqual([]);
    expect(res.skipped).toEqual([
      { sessionId: "session-busy", reason: "task_in_progress" },
      { sessionId: "session-gone", reason: "session_not_found" },
    ]);
    // Busy stays marked (the run in flight owns the lifecycle); gone is dropped quietly.
    expect(store.listMarks().map((m) => m.sessionId)).toEqual(["session-busy"]);
    expect(errors).toEqual([]);
  });

  it("resume drops the mark and records when the start fails deterministically", async () => {
    const store = createFileRunMarkStore(root, { onError: () => {} });
    store.markStart("session-1", { projectId: "p1", agentId: "a1" });
    const errors: { code: string; mark: RunMark }[] = [];
    const res = await resumeInterruptedSessions({
      store,
      starter: {
        startTask: async () => {
          throw new HttpError(500, "loader_failed", "boom");
        },
      },
      log: () => {},
      recordError: (code, _err, mark) => errors.push({ code, mark }),
    });
    expect(res.resumed).toEqual([]);
    expect(store.listMarks()).toEqual([]);
    expect(errors).toEqual([
      { code: "auto_resume_failed", mark: expect.objectContaining({ sessionId: "session-1" }) },
    ]);
  });

  it("resume removes the stale mark when the loader heals under a new id", async () => {
    const store = createFileRunMarkStore(root, { onError: () => {} });
    store.markStart("session-old", { projectId: "p1", agentId: "a1" });
    const res = await resumeInterruptedSessions({
      store,
      starter: {
        startTask: async () => ({ sessionId: "session-new", queued: false }),
      },
      log: () => {},
    });
    expect(res.resumed).toEqual(["session-old"]);
    expect(store.listMarks()).toEqual([]);
    // The healed run owns a fresh mark and guard; the stale guard goes with the mark.
    expect(store.readResumeGuard("session-old")).toBeUndefined();
  });
});
