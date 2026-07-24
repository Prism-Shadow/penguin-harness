/**
 * Error-record persistence unit and integration tests: ErrorsRepo's aggregation semantics (including cross-tenant isolation
 * where unattributed errors are **visible only to admins**) and its row-cap eviction
 * (evicts the oldest by id, without misfiring on id gaps left by deleteByProject);
 * ErrorRecorder's expected/unexpected determination (explicit kind takes priority, HTTP
 * infers from HttpError), short-window deduplication (storm protection), and the
 * "never throws itself" guarantee; StreamErrorWatcher picking up LLM / Environment
 * errors from the message stream (attributed to **the Session that actually produced
 * the error**: a child Session's failure is attributed to the child Agent / child
 * Session); HTTP onError actually persisting records; cascading cleanup on Project
 * deletion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import {
  abortEvent,
  assistantText,
  partialToolCallOutput,
  requestBegin,
  requestEnd,
  sessionMeta,
  toolCall,
  toolCallOutput,
  withOrigin,
} from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { ProjectCreateResponse, UsageResponse } from "../src/api/types.js";
import { openDatabase } from "../src/db/database.js";
import { ErrorsRepo } from "../src/db/repos/errors.js";
import type { ErrorRecordInsert } from "../src/db/repos/errors.js";
import { HttpError } from "../src/http/errors.js";
import {
  DEDUP_KEYS_MAX,
  DEDUP_WINDOW_MS,
  ErrorRecorder,
  MESSAGE_MAX,
} from "../src/runtime/error-recorder.js";
import { StreamErrorWatcher } from "../src/runtime/stream-error-watcher.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

function row(date: string, o: Partial<ErrorRecordInsert> = {}): ErrorRecordInsert {
  return {
    ts: `${date}T10:00:00.000Z`,
    date,
    projectId: "p1",
    agentId: null,
    sessionId: null,
    source: "http",
    kind: "unexpected",
    code: "internal",
    status: 500,
    message: "boom",
    ...o,
  };
}

describe("errors-repo", () => {
  let db: DatabaseSync;
  let repo: ErrorsRepo;

  beforeEach(() => {
    db = openDatabase(":memory:");
    repo = new ErrorsRepo(db);
  });
  afterEach(() => db.close());

  it("summary: total and unexpected count; expected ones are still recorded", () => {
    repo.insert(row("2026-07-06"));
    repo.insert(row("2026-07-06", { kind: "expected", code: "not_found", status: 404 }));
    repo.insert(row("2026-07-06", { kind: "expected", code: "bad_request", status: 400 }));
    expect(repo.summary("p1")).toEqual({ total: 3, unexpected: 1 });
  });

  it("unattributed errors (login failure / crash) are admin-only, invisible to members", () => {
    const global = { projectId: null, source: "process", code: "uncaught_exception" };
    repo.insert(row("2026-07-06", global)); // Unattributed: another tenant's login failure / process crash
    repo.insert(row("2026-07-06", global));
    repo.insert(row("2026-07-06", { projectId: "p-other" })); // Another Project: invisible to everyone
    repo.insert(row("2026-07-06", { kind: "expected", code: "not_found", status: 404 })); // This Project

    // Regular member (default includeGlobal=false): all three queries see only the row for this Project.
    expect(repo.summary("p1")).toEqual({ total: 1, unexpected: 0 });
    expect(repo.topCode("p1")).toMatchObject({ code: "not_found", count: 1 });
    expect(repo.recent("p1").map((r) => r.code)).toEqual(["not_found"]);

    // Admin: this Project + unattributed (still can't see another Project's rows).
    const admin = { includeGlobal: true };
    expect(repo.summary("p1", admin)).toEqual({ total: 3, unexpected: 2 });
    expect(repo.topCode("p1", admin)).toMatchObject({ code: "uncaught_exception", count: 2 });
    expect(repo.recent("p1", admin).map((r) => r.code)).toEqual([
      "not_found",
      "uncaught_exception",
      "uncaught_exception",
    ]);

    // A member of another Project likewise only sees their own row: unattributed errors never land in any regular member's view.
    expect(repo.summary("p-other")).toEqual({ total: 1, unexpected: 1 });
    expect(repo.recent("p-other").map((r) => r.code)).toEqual(["internal"]);
  });

  it("top error code: grouped by source+code+kind, takes the highest count", () => {
    for (let i = 0; i < 3; i++) repo.insert(row("2026-07-06", { code: "internal" }));
    repo.insert(row("2026-07-06", { source: "session", code: "session_run_failed" }));
    repo.insert(row("2026-07-06", { kind: "expected", code: "not_found", status: 404 }));
    repo.insert(row("2026-07-06", { kind: "expected", code: "not_found", status: 404 }));

    expect(repo.topCode("p1")).toEqual({
      source: "http",
      code: "internal",
      kind: "unexpected",
      count: 3,
    });
    // No errors / no errors in range -> null (the frontend uses this to hide the metric).
    expect(repo.topCode("p-empty")).toBeNull();
    expect(repo.topCode("p1", { from: "2026-07-07" })).toBeNull();
  });

  it("date range and agent filters (HTTP / process errors have no agent_id)", () => {
    repo.insert(row("2026-07-05"));
    repo.insert(row("2026-07-06", { kind: "expected" }));
    repo.insert(row("2026-07-06", { agentId: "a1", source: "session" }));

    expect(repo.summary("p1")).toEqual({ total: 3, unexpected: 2 });
    expect(repo.summary("p1", { from: "2026-07-06" })).toEqual({ total: 2, unexpected: 1 });
    expect(repo.summary("p1", { agentId: "a1" })).toEqual({ total: 1, unexpected: 1 });
    expect(repo.topCode("p1", { agentId: "a1" })).toMatchObject({ source: "session", count: 1 });
    expect(repo.recent("p1", { agentId: "a1" })).toHaveLength(1);
  });

  it("recent errors: newest first, top limit rows", () => {
    repo.insert(row("2026-07-05", { message: "old" }));
    repo.insert(row("2026-07-06", { message: "new" }));
    const recent = repo.recent("p1", {}, 1);
    expect(recent).toHaveLength(1);
    expect(recent[0]!.message).toBe("new");
  });

  it("deleteByProject: deletes only that Project's rows, unattributed errors remain", () => {
    repo.insert(row("2026-07-06"));
    repo.insert(row("2026-07-06", { projectId: null }));
    repo.deleteByProject("p1");
    const rows = db.prepare("SELECT project_id FROM error_records").all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.project_id).toBeNull();
  });

  // —— Row cap (the second line of defense against error storms; the first is ErrorRecorder's short-window dedup) ——

  const messages = () =>
    db
      .prepare("SELECT message FROM error_records ORDER BY id")
      .all()
      .map((r) => r.message as string);

  it("row cap: evicts the oldest rows by id (checked every pruneEvery inserts)", () => {
    const capped = new ErrorsRepo(db, { maxRows: 5, pruneEvery: 2 });
    for (let i = 0; i < 10; i++) capped.insert(row("2026-07-06", { message: `m${i}` }));
    // The 5 most recent rows within the cap are kept, older ones are evicted.
    expect(messages()).toEqual(["m5", "m6", "m7", "m8", "m9"]);
  });

  it("eviction counts rows: id gaps left by deleteByProject never misdelete valid data", () => {
    const capped = new ErrorsRepo(db, { maxRows: 3, pruneEvery: 1 });
    capped.insert(row("2026-07-06", { message: "keep-1" })); // id 1
    capped.insert(row("2026-07-06", { message: "keep-2" })); // id 2
    capped.insert(row("2026-07-06", { projectId: "p-gone", message: "gone" })); // id 3
    capped.deleteByProject("p-gone"); // id 3 becomes a gap: MAX(id) is now decoupled from the actual row count

    // 3 rows in the table = exactly at the cap; none should be deleted. An approximation (id <= MAX(id) - 3) would wrongly delete keep-1.
    capped.insert(row("2026-07-06", { message: "keep-3" })); // id 4
    expect(messages()).toEqual(["keep-1", "keep-2", "keep-3"]);

    // Once over the cap, the oldest row is evicted as usual (gaps don't affect the "oldest" determination).
    capped.insert(row("2026-07-06", { message: "keep-4" })); // id 5
    expect(messages()).toEqual(["keep-2", "keep-3", "keep-4"]);
  });
});

describe("error-recorder", () => {
  let db: DatabaseSync;
  let repo: ErrorsRepo;
  const now = () => new Date("2026-07-06T10:00:00");

  beforeEach(() => {
    db = openDatabase(":memory:");
    repo = new ErrorsRepo(db);
  });
  afterEach(() => db.close());

  it("HttpError → expected (keeps code and status)", () => {
    new ErrorRecorder(repo, now).record({
      source: "http",
      err: new HttpError(
        404,
        "session_not_found",
        "Session does not exist or you do not have access.",
      ),
      ctx: { projectId: "p1" },
    });
    const r = db.prepare("SELECT * FROM error_records").get()!;
    expect(r.kind).toBe("expected");
    expect(r.code).toBe("session_not_found");
    expect(r.status).toBe(404);
    expect(r.project_id).toBe("p1");
    expect(r.date).toBe("2026-07-06");
  });

  it("non-HttpError → unexpected; HTTP source converges to 500, non-HTTP status is NULL", () => {
    const rec = new ErrorRecorder(repo, now);
    rec.record({ source: "http", err: new Error("boom") });
    rec.record({
      source: "session",
      err: new Error("drive crashed"),
      ctx: { projectId: "p1", agentId: "a1", sessionId: "s1" },
      code: "session_run_failed",
    });
    const rows = db.prepare("SELECT * FROM error_records ORDER BY id").all();
    expect(rows[0]!.kind).toBe("unexpected");
    expect(rows[0]!.code).toBe("internal"); // Matches the same code convention as handleError's external-facing code
    expect(rows[0]!.status).toBe(500);
    expect(rows[0]!.project_id).toBeNull();
    expect(rows[1]!.code).toBe("session_run_failed");
    expect(rows[1]!.status).toBeNull();
    expect(rows[1]!.agent_id).toBe("a1");
    expect(rows[1]!.session_id).toBe("s1");
  });

  it("non-Error throwables and overlong messages: stringified and truncated to the cap", () => {
    const rec = new ErrorRecorder(repo, now);
    rec.record({ source: "process", err: "a string error", code: "unhandled_rejection" });
    rec.record({ source: "usage", err: new Error("x".repeat(MESSAGE_MAX + 100)) });
    const rows = db.prepare("SELECT message FROM error_records ORDER BY id").all();
    expect(rows[0]!.message).toBe("a string error");
    expect((rows[1]!.message as string).length).toBe(MESSAGE_MAX);
  });

  it("the recorder itself never throws (hooked on onError it would recurse forever)", () => {
    const broken = {
      insert() {
        throw new Error("DB is closed");
      },
    } as unknown as ErrorsRepo;
    expect(() =>
      new ErrorRecorder(broken).record({ source: "http", err: new Error("x") }),
    ).not.toThrow();
  });

  it("explicit kind wins over HttpError inference (sources self-report human need)", () => {
    const rec = new ErrorRecorder(repo, now);
    rec.record({ source: "llm", err: "timed out", code: "llm_timeout", kind: "expected" });
    rec.record({ source: "llm", err: "auth failed", code: "llm_failed", kind: "unexpected" });
    const rows = db.prepare("SELECT kind, source, status FROM error_records ORDER BY id").all();
    expect(rows[0]).toMatchObject({ kind: "expected", source: "llm", status: null });
    expect(rows[1]).toMatchObject({ kind: "unexpected", source: "llm", status: null });
  });

  // —— Short-window dedup (the first line of defense against error storms) ——

  const count = () =>
    db.prepare("SELECT COUNT(*) AS n FROM error_records").get()!.n as unknown as number;
  /** Dedup table (private): asserts the hard requirement that it stays "bounded". */
  const lastSeen = (rec: ErrorRecorder) =>
    (rec as unknown as { lastSeen: Map<string, number> }).lastSeen;

  it("short-window dedup: same-kind errors persist once per window, then resume", () => {
    let t = Date.parse("2026-07-06T10:00:00Z");
    const rec = new ErrorRecorder(repo, () => new Date(t));
    const boom = () =>
      rec.record({
        source: "http",
        err: new HttpError(404, "not_found", "Not found."),
        ctx: { projectId: "p1" },
      });

    boom();
    expect(count()).toBe(1);

    t += DEDUP_WINDOW_MS - 1; // Still within the window: a burst of 404s from a scan discards straight away, no persist
    boom();
    boom();
    expect(count()).toBe(1);

    t += 1; // Outside the window: the same kind of error is recorded again (a sustained storm leaves exactly one entry per window, never suppressed forever)
    boom();
    expect(count()).toBe(2);
  });

  it("dedup never crosses source / code / Project (kinds don't suppress each other)", () => {
    const rec = new ErrorRecorder(repo, now); // time frozen: everything lands in the same window
    const err = new Error("boom");
    rec.record({ source: "http", err, ctx: { projectId: "p1" }, code: "c1" });
    rec.record({ source: "http", err, ctx: { projectId: "p1" }, code: "c1" }); // same kind: discarded
    rec.record({ source: "http", err, ctx: { projectId: "p1" }, code: "c2" }); // different code
    rec.record({ source: "http", err, ctx: { projectId: "p2" }, code: "c1" }); // different Project
    rec.record({ source: "session", err, ctx: { projectId: "p1" }, code: "c1" }); // different source
    rec.record({ source: "http", err, code: "c1" }); // unattributed (project_id is NULL): counts as its own kind
    expect(count()).toBe(5);
  });

  it("bounded dedup table: expired entries cleaned first, else wiped; works afterward", () => {
    let t = Date.parse("2026-07-06T10:00:00Z");
    const rec = new ErrorRecorder(repo, () => new Date(t));
    const boom = (code: string) =>
      rec.record({ source: "http", err: "boom", ctx: { projectId: "p1" }, code });

    for (let i = 0; i < DEDUP_KEYS_MAX; i++) boom(`c${i}`); // fill it up (one key per code)
    expect(lastSeen(rec).size).toBe(DEDUP_KEYS_MAX);

    t += DEDUP_WINDOW_MS; // all old keys expired: the next entry triggers cleanup, leaving only the newly registered one
    boom("after-window");
    expect(lastSeen(rec).size).toBe(1);

    for (let i = 0; i < DEDUP_KEYS_MAX; i++) boom(`d${i}`); // all within the same window: nothing to clean → wipe the whole table
    expect(lastSeen(rec).size).toBeLessThanOrEqual(DEDUP_KEYS_MAX);

    // Works normally after being wiped: new errors are still recorded, and duplicates within the window are still discarded.
    const before = count();
    boom("tail");
    boom("tail");
    expect(count()).toBe(before + 1);
  });
});

describe("stream-error-watcher (LLM / Environment errors)", () => {
  let db: DatabaseSync;
  let repo: ErrorsRepo;
  const now = () => new Date("2026-07-06T10:00:00");
  const CTX = { projectId: "p1", agentId: "a1", sessionId: "s1" };

  beforeEach(() => {
    db = openDatabase(":memory:");
    repo = new ErrorsRepo(db);
  });
  afterEach(() => db.close());

  const watcher = () => new StreamErrorWatcher(new ErrorRecorder(repo, now), CTX);
  const rows = () =>
    db.prepare("SELECT * FROM error_records ORDER BY id").all() as Array<Record<string, unknown>>;

  /** Feeds a sequence of messages and finalizes (close: persists any still-pending failure), returning the persisted rows. */
  function feed(msgs: OmniMessage[]): Array<Record<string, unknown>> {
    const w = watcher();
    for (const m of msgs) w.observe(m);
    w.close();
    return rows();
  }

  /**
   * A sub-session's session_meta (its first message): origin = the child Session
   * id, and agentId is derived from the parent directory name in the `agent_state`
   * path (consistent with SessionManager.registerChildSession).
   */
  const childMeta = (sessionId: string, agentState: string) =>
    withOrigin(
      sessionMeta({
        session_id: sessionId,
        model_id: "m1",
        provider: "custom",
        model_context_window: 100000,
        system_prompt: "",
        tools: [],
        thinking_level: "default",
        agent_state: agentState,
        workspace: "/tmp/w",
      }),
      sessionId,
    );

  // —— LLM ——

  it("LLM failed → unexpected (needs a human); message takes the abort reason", () => {
    const got = feed([
      requestBegin(),
      requestEnd("failed"),
      abortEvent("llm request error: 401 invalid api key"),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      source: "llm",
      kind: "unexpected",
      code: "llm_failed",
      message: "llm request error: 401 invalid api key",
      project_id: "p1",
      agent_id: "a1",
      session_id: "s1",
      status: null,
    });
  });

  it("LLM timeout / malformed → expected (engine retries); message from the abort reason", () => {
    const got = feed([
      requestBegin(),
      requestEnd("timeout"), // First attempt times out → the engine retries (revealed by the next request_begin: no reason text yet)
      requestBegin(),
      requestEnd("malformed"),
      abortEvent("malformed response failed after 2 retries"),
    ]);
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({ source: "llm", kind: "expected", code: "llm_timeout" });
    expect(got[0]!.message).toContain("timed out"); // No abort arrived: falls back to the status text
    expect(got[1]).toMatchObject({
      source: "llm",
      kind: "expected",
      code: "llm_malformed",
      message: "malformed response failed after 2 retries",
    });
  });

  it("aborted (user clicked Stop) is not an error: not recorded; neither is completed", () => {
    expect(
      feed([
        requestBegin(),
        requestEnd("completed"),
        requestBegin(),
        requestEnd("aborted"),
        abortEvent("aborted by user"),
      ]),
    ).toHaveLength(0);
  });

  it("interrupt during retry backoff: timeout still recorded, interrupt text distrusted", () => {
    const got = feed([
      requestBegin(),
      requestEnd("timeout"),
      abortEvent("aborted during reconnect backoff"),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ code: "llm_timeout", kind: "expected" });
    expect(got[0]!.message).toContain("timed out");
    expect(got[0]!.message).not.toContain("aborted");
  });

  it("failure pends for its reason; unresolved at run end → close persists (status text)", () => {
    const w = watcher();
    w.observe(requestBegin());
    w.observe(requestEnd("failed"));
    expect(rows()).toHaveLength(0); // Pending: waiting for the abort that immediately follows to supply the real reason
    w.close();
    const got = rows();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ code: "llm_failed", kind: "unexpected" });
    expect(got[0]!.message).toContain("LLM request failed");
  });

  it("parent/child LLM failures pend separately by origin; abort reasons never cross over", () => {
    const got = feed([
      requestBegin(), // parent session initiates
      withOrigin(requestBegin(), "session-child"),
      withOrigin(requestEnd("timeout"), "session-child"),
      withOrigin(abortEvent("reconnect failed after 2 retries"), "session-child"),
      requestEnd("failed"), // the parent session's failure only wraps up now
      abortEvent("llm request error: 500 upstream"),
    ]);
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({
      code: "llm_timeout",
      message: "reconnect failed after 2 retries",
    });
    expect(got[1]).toMatchObject({
      code: "llm_failed",
      message: "llm request error: 500 upstream", // not stolen by the sub-session's abort
    });
  });

  // —— Environment (tool execution) ——

  const call = (name: string, id: string) => toolCall({ name, arguments: "{}", toolCallId: id });

  it("tool failed / timeout → environment + expected, code carries the tool name", () => {
    const got = feed([
      call("run_command", "tc-1"),
      toolCallOutput({
        output: "ls: /nope: No such file or directory\n[tool error] exit code 2",
        toolCallId: "tc-1",
        stopReason: "failed",
      }),
      call("read_file", "tc-2"),
      toolCallOutput({
        output: "[tool timeout: exceeded 30000ms]",
        toolCallId: "tc-2",
        stopReason: "timeout",
      }),
    ]);
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({
      source: "environment",
      kind: "expected", // error fed back to the model; the Agent adjusts on its own — no human needed
      code: "tool_failed:run_command",
      project_id: "p1",
      agent_id: "a1",
      session_id: "s1",
    });
    expect(got[0]!.message).toContain("[tool error] exit code 2"); // the actual error text
    expect(got[1]).toMatchObject({ code: "tool_timeout:read_file", kind: "expected" });
  });

  it("tool aborted (denial / user interrupt) and completed are not recorded", () => {
    expect(
      feed([
        call("run_command", "tc-1"),
        toolCallOutput({
          output: "Tool call denied by user.",
          toolCallId: "tc-1",
          stopReason: "aborted",
        }),
        call("read_file", "tc-2"),
        toolCallOutput({ output: "ok", toolCallId: "tc-2", stopReason: "completed" }),
      ]),
    ).toHaveLength(0);
  });

  it("parallel tools: each tool_call_id maps to its own name despite out-of-order outputs", () => {
    const got = feed([
      call("run_command", "tc-1"),
      call("read_file", "tc-2"),
      call("write_file", "tc-3"),
      toolCallOutput({ output: "boom-2", toolCallId: "tc-2", stopReason: "failed" }),
      toolCallOutput({ output: "ok", toolCallId: "tc-3", stopReason: "completed" }),
      toolCallOutput({ output: "boom-1", toolCallId: "tc-1", stopReason: "failed" }),
    ]);
    expect(got.map((r) => r.code)).toEqual(["tool_failed:read_file", "tool_failed:run_command"]);
    expect(got.map((r) => r.message)).toEqual(["boom-2", "boom-1"]);
  });

  it("a child session's tool failure: no name mix-up with the parent's equal tool_call_id", () => {
    const got = feed([
      call("run_command", "tc-1"), // parent session
      withOrigin(call("write_file", "tc-1"), "session-child"), // sub-session happens to share the same id
      withOrigin(
        toolCallOutput({ output: "child boom", toolCallId: "tc-1", stopReason: "failed" }),
        "session-child",
      ),
      toolCallOutput({ output: "parent boom", toolCallId: "tc-1", stopReason: "failed" }),
    ]);
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({
      code: "tool_failed:write_file", // the sub-session's tool name, not overwritten by the parent's tc-1
      message: "child boom",
      session_id: "s1", // this test didn't feed the sub-session's session_meta → attribution falls back to the parent ctx (see the "attribution" test cases below)
    });
    expect(got[1]).toMatchObject({ code: "tool_failed:run_command", message: "parent boom" });
  });

  it("overlong tool output: message takes the tail (the reason is at the end)", () => {
    const got = feed([
      call("run_command", "tc-1"),
      toolCallOutput({
        output: `${"x".repeat(2000)}\n[tool error] boom`,
        toolCallId: "tc-1",
        stopReason: "failed",
      }),
    ]);
    const message = got[0]!.message as string;
    expect(message.length).toBe(MESSAGE_MAX);
    expect(message.startsWith("…")).toBe(true);
    expect(message.endsWith("[tool error] boom")).toBe(true); // truncating from the head would cut off the reason entirely
  });

  it("irrelevant messages are a no-op: body text and streaming partial_*", () => {
    expect(
      feed([
        assistantText("normal output"),
        call("run_command", "tc-1"),
        partialToolCallOutput({ eventType: "stop", toolCallId: "tc-1", stopReason: "failed" }),
      ]),
    ).toHaveLength(0);
  });

  // —— Attribution: an error is recorded against **the session that actually produced it** (a sub-session's failure must not be attributed to the parent Agent) ——

  it("a child session's LLM failure attributes to the child Agent / Session", () => {
    const got = feed([
      childMeta("session-child", "/data/agents/agent-child/agent_state"),
      withOrigin(requestBegin(), "session-child"),
      withOrigin(requestEnd("failed"), "session-child"),
      withOrigin(abortEvent("llm request error: 401 invalid api key"), "session-child"),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      source: "llm",
      code: "llm_failed",
      message: "llm request error: 401 invalid api key",
      agent_id: "agent-child", // derived from the agent_state path; not the parent's a1
      session_id: "session-child",
      project_id: "p1", // projectId always takes the parent's (a sub-session is always in the same Project)
    });
  });

  it("a child session's tool failure attributes to it (code still carries the tool name)", () => {
    const got = feed([
      childMeta("session-child", "/data/agents/agent-child/agent_state"),
      withOrigin(call("run_command", "tc-1"), "session-child"),
      withOrigin(
        toolCallOutput({ output: "child boom", toolCallId: "tc-1", stopReason: "failed" }),
        "session-child",
      ),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      source: "environment",
      code: "tool_failed:run_command",
      message: "child boom",
      agent_id: "agent-child",
      session_id: "session-child",
      project_id: "p1",
    });
  });

  it("parent/child interleaving: each attributes to its own; no-origin goes to the parent", () => {
    const got = feed([
      requestBegin(), // parent session initiates
      childMeta("session-child", "/data/agents/agent-child/agent_state"),
      withOrigin(requestBegin(), "session-child"),
      withOrigin(requestEnd("timeout"), "session-child"),
      withOrigin(abortEvent("reconnect failed after 2 retries"), "session-child"),
      withOrigin(call("write_file", "tc-9"), "session-child"),
      withOrigin(
        toolCallOutput({ output: "child tool boom", toolCallId: "tc-9", stopReason: "failed" }),
        "session-child",
      ),
      call("run_command", "tc-9"), // parent session happens to share the same id
      toolCallOutput({ output: "parent tool boom", toolCallId: "tc-9", stopReason: "failed" }),
      requestEnd("failed"), // the parent session's LLM failure only wraps up now
      abortEvent("llm request error: 500 upstream"),
    ]);
    // The sub-session's LLM / tool failures attribute to it, the parent's to the parent — the four entries never mix (each has a distinct code, so short-window dedup doesn't suppress any of them).
    expect(got.map((r) => [r.code, r.agent_id, r.session_id])).toEqual([
      ["llm_timeout", "agent-child", "session-child"],
      ["tool_failed:write_file", "agent-child", "session-child"],
      ["tool_failed:run_command", "a1", "s1"],
      ["llm_failed", "a1", "s1"],
    ]);
  });

  it("failure before session_meta arrives: falls back to the parent ctx, no crash", () => {
    const got = feed([
      withOrigin(requestEnd("failed"), "session-child"), // the sub-session's meta hasn't arrived yet
      withOrigin(abortEvent("llm request error: 500"), "session-child"),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ code: "llm_failed", agent_id: "a1", session_id: "s1" });
  });

  it("malformed agent_state path (empty): not registered, falls back to the parent ctx", () => {
    const got = feed([
      childMeta("session-child", ""), // path.basename(path.dirname("")) === "." → caught by the defensive check
      withOrigin(requestEnd("failed"), "session-child"),
      withOrigin(abortEvent("llm request error: 500"), "session-child"),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ code: "llm_failed", agent_id: "a1", session_id: "s1" });
  });
});

describe("HTTP onError persistence (integration)", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let projectId: string;

  beforeEach(async () => {
    t = await createTestApp();
    const u = await provisionUser(t.app, "err_user");
    api = apiClient(t.app, u.cookie);
    const created = (await (
      await api.post("/api/projects", { projectId: "err_user-proj", name: "Error project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const errorRows = () =>
    t.deps.db.prepare("SELECT * FROM error_records ORDER BY id").all() as Array<
      Record<string, unknown>
    >;

  it("business error (HttpError 404) → expected, with code / status / projectId", async () => {
    const res = await api.get(`/api/projects/${projectId}/agents/agent-nope/sessions`);
    expect(res.status).toBe(404);

    const rows = errorRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe("http");
    expect(rows[0]!.kind).toBe("expected");
    expect(rows[0]!.code).toBe("agent_not_found");
    expect(rows[0]!.status).toBe(404);
    // Taken from the route params, but only when the requester actually has access — see the "HTTP error attribution" test group below.
    expect(rows[0]!.project_id).toBe(projectId);
  });

  it("unexpected error (service layer throws a plain Error) → unexpected + 500", async () => {
    // handleError logs the stack trace: silence it in the test so it doesn't clutter output.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    t.deps.usageService.query = () => {
      throw new Error("query blew up");
    };
    const res = await api.get(`/api/projects/${projectId}/usage?groupBy=date`);
    expect(res.status).toBe(500);
    spy.mockRestore();

    const rows = errorRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("unexpected");
    expect(rows[0]!.code).toBe("internal");
    expect(rows[0]!.status).toBe(500);
    expect(rows[0]!.message).toBe("query blew up");
    expect(rows[0]!.project_id).toBe(projectId);
  });

  it("errors exposed via the usage endpoint: summary / top code / recent", async () => {
    // An error in another Project owned by the same owner: attributed to that Project, not this one's view.
    const other = (await (
      await api.post("/api/projects", { projectId: "err_user-proj_2", name: "Another project" })
    ).json()) as ProjectCreateResponse;
    await api.get(`/api/projects/${other.project.projectId}/agents/agent-nope/sessions`); // 404
    await api.get(`/api/projects/${projectId}/agents/agent-nope/sessions`); // 404 → expected

    const res = await api.get(`/api/projects/${projectId}/usage?groupBy=date`);
    const body = (await res.json()) as UsageResponse;
    // The entry from another Project doesn't count in this view (only this Project's errors + admin-visible unattributed errors show here).
    expect(body.errors.total).toBe(1);
    expect(body.errors.unexpected).toBe(0);
    expect(body.errors.topCode).toEqual({
      source: "http",
      code: "agent_not_found",
      kind: "expected",
      count: 1,
    });
    expect(body.errors.recent[0]).toMatchObject({ source: "http", code: "agent_not_found" });
  });

  it("unattributed errors (login failure) are admin-only, hidden from members", async () => {
    // A login failure has no Project context → produces one unattributed error (project_id is NULL).
    const bad = await t.app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "err_user", password: "wrong-password" }),
    });
    expect(bad.status).toBe(401);
    expect(errorRows().filter((r) => r.project_id === null)).toHaveLength(1);

    // A regular member in their own Project: sees none of it.
    const plain = await provisionUser(t.app, "plain_user");
    expect(plain.user.isAdmin).toBe(false);
    const plainApi = apiClient(t.app, plain.cookie);
    const own = (await (
      await plainApi.post("/api/projects", { projectId: "plain_user-proj", name: "Member project" })
    ).json()) as ProjectCreateResponse;
    const plainBody = (await (
      await plainApi.get(`/api/projects/${own.project.projectId}/usage?groupBy=date`)
    ).json()) as UsageResponse;
    expect(plainBody.errors).toMatchObject({ total: 0, unexpected: 0, topCode: null, recent: [] });

    // The admin can see it — the category most in need of visibility isn't rendered invisible by the isolation.
    const adminApi = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const adminBody = (await (
      await adminApi.get(`/api/projects/default_project/usage?groupBy=date`)
    ).json()) as UsageResponse;
    expect(adminBody.errors.total).toBe(1);
    expect(adminBody.errors.topCode).toMatchObject({ source: "http", code: "invalid_credentials" });
    expect(adminBody.errors.recent[0]).toMatchObject({ code: "invalid_credentials" });
  });

  it("Project deletion cascade-cleans that Project's error records", async () => {
    await api.get(`/api/projects/${projectId}/agents/agent-nope/sessions`);
    expect(errorRows().filter((r) => r.project_id === projectId)).toHaveLength(1);

    const del = await api.delete(`/api/projects/${projectId}`);
    expect(del.status).toBe(204);
    expect(errorRows().filter((r) => r.project_id === projectId)).toHaveLength(0);
  });
});

describe("HTTP error attribution (only when the requester actually has Project access)", () => {
  let t: TestApp;
  /** The built-in admin: unattributed errors are visible only to them. */
  let adminApi: ReturnType<typeof apiClient>;
  let adminProjectId: string;
  /** The victim Project's owner: a regular user, so their stats center only shows errors attributed to this Project. */
  let ownerApi: ReturnType<typeof apiClient>;
  let projectId: string;

  beforeEach(async () => {
    t = await createTestApp();
    const admin = await loginAdmin(t.app);
    adminApi = apiClient(t.app, admin.cookie);
    adminProjectId = (
      (await (
        await adminApi.post("/api/projects", { projectId: "admin_proj", name: "Admin project" })
      ).json()) as ProjectCreateResponse
    ).project.projectId;

    const owner = await provisionUser(t.app, "owner_user");
    expect(owner.user.isAdmin).toBe(false);
    ownerApi = apiClient(t.app, owner.cookie);
    projectId = (
      (await (
        await ownerApi.post("/api/projects", { projectId: "owner_user-victim", name: "Victim" })
      ).json()) as ProjectCreateResponse
    ).project.projectId;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const errorRows = () =>
    t.deps.db.prepare("SELECT * FROM error_records ORDER BY id").all() as Array<
      Record<string, unknown>
    >;
  /** The victim Project's stats center (owner's view: only this Project's errors). */
  const ownerErrors = async () =>
    (
      (await (
        await ownerApi.get(`/api/projects/${projectId}/usage?groupBy=date`)
      ).json()) as UsageResponse
    ).errors;
  /** The admin's stats center (this Project + unattributed errors). */
  const adminErrors = async () =>
    (
      (await (
        await adminApi.get(`/api/projects/${adminProjectId}/usage?groupBy=date`)
      ).json()) as UsageResponse
    ).errors;

  it("not logged in → 401: unattributed (anyone could flood another's error stats)", async () => {
    const res = await t.app.request(`/api/projects/${projectId}/usage?groupBy=date`);
    expect(res.status).toBe(401);

    // The requester isn't even logged in: this error must not be pinned to projectId.
    // Note: today this also **incidentally** relies on a Hono quirk — `c.req.param()`
    // resolves only against "the route the current handler belongs to"; the 401 is
    // thrown in the `/api/*` authMiddleware, whose route has no :projectId, so no
    // value is available there. The attribution guard removes the dependency on
    // that quirk: when not logged in, `c.var.user` is undefined at runtime → unattributed.
    const rows = errorRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "http", code: "unauthorized", status: 401 });
    expect(rows[0]!.project_id).toBeNull();

    // The owner's stats center gains nothing; the trace of the unauthorized probe lands in the admin's view — right where it belongs.
    expect(await ownerErrors()).toMatchObject({ total: 0, unexpected: 0, topCode: null });
    const admin = await adminErrors();
    expect(admin.total).toBe(1);
    expect(admin.recent[0]).toMatchObject({ source: "http", code: "unauthorized" });
  });

  it("logged in but without access (non-member) → 404: likewise unattributed", async () => {
    const outsider = await provisionUser(t.app, "outsider");
    const res = await apiClient(t.app, outsider.cookie).get(
      `/api/projects/${projectId}/usage?groupBy=date`,
    );
    expect(res.status).toBe(404);

    const rows = errorRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "http", code: "project_not_found", status: 404 });
    expect(rows[0]!.project_id).toBeNull();

    expect(await ownerErrors()).toMatchObject({ total: 0, unexpected: 0, topCode: null });
    expect((await adminErrors()).recent[0]).toMatchObject({ code: "project_not_found" });
  });

  it("business errors from an authorized member → attributed as usual", async () => {
    // owner: an invalid groupBy → 400.
    expect((await ownerApi.get(`/api/projects/${projectId}/usage?groupBy=bogus`)).status).toBe(400);

    // An authorized member: a 404 in the same Project → attributed the same way (the member branch of canAccess).
    const member = await provisionUser(t.app, "member_user");
    const added = await ownerApi.post(`/api/projects/${projectId}/members`, {
      userId: "member_user",
    });
    expect(added.status).toBe(201);
    const missing = await apiClient(t.app, member.cookie).get(
      `/api/projects/${projectId}/agents/agent-nope/sessions`,
    );
    expect(missing.status).toBe(404);

    expect(errorRows().map((r) => [r.code, r.project_id])).toEqual([
      ["bad_request", projectId],
      ["agent_not_found", projectId],
    ]);
    expect(await ownerErrors()).toMatchObject({ total: 2, unexpected: 0 });
  });

  it("the attribution check throws: onError survives, error lands unattributed", async () => {
    t.deps.projectService.canAccess = () => {
      throw new Error("access check blew up");
    };
    const res = await ownerApi.get(`/api/projects/${projectId}/usage?groupBy=bogus`);
    expect(res.status).toBe(400); // still the original business error: not turned into a 500, nor an empty response
    expect(await res.json()).toMatchObject({ error: { code: "bad_request" } });

    const rows = errorRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.code).toBe("bad_request");
    expect(rows[0]!.project_id).toBeNull(); // a failed determination always falls back to unattributed
  });
});
