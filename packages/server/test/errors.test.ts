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
  compactionEnd,
  partialToolCallOutput,
  requestBegin,
  requestEnd,
  sessionMeta,
  toolCall,
  toolCallOutput,
  withOrigin,
} from "@prismshadow/penguin-core";
import type { OmniMessage, StopReason } from "@prismshadow/penguin-core";
import type { ProjectCreateResponse, UsageErrorsPage, UsageResponse } from "../src/api/types.js";
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
import { messagingErrorKind } from "../src/runtime/messaging/error-kind.js";
import { MessagingConnectionClosedError } from "../src/runtime/messaging/qq-api.js";
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

  it("a trailing window narrows the dates to instants, both ends inclusive, for reads and the clear alike", () => {
    const window = {
      from: "2026-07-06",
      to: "2026-07-06",
      fromTs: "2026-07-06T10:00:00.000Z",
      toTs: "2026-07-06T11:00:00.000Z",
    };
    for (const [time, message] of [
      ["09:59:59.999", "just before"],
      ["10:00:00.000", "at from"],
      ["10:30:00.000", "inside"],
      ["11:00:00.000", "at to"],
      ["11:00:00.001", "just after"],
    ] as const) {
      repo.insert(row("2026-07-06", { ts: `2026-07-06T${time}Z`, message }));
    }
    // A row stamped exactly on either bound is inside the window …
    expect(repo.summary("p1", window)).toEqual({ total: 3, unexpected: 3 });
    expect(repo.recent("p1", window).map((r) => r.message)).toEqual(["at to", "inside", "at from"]);
    // … and the clear of the same window takes exactly those, sparing the same day's rows a
    // millisecond outside it.
    expect(repo.deleteFiltered("p1", window)).toBe(3);
    expect(repo.recent("p1").map((r) => r.message)).toEqual(["just after", "just before"]);
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

  it("deleteFiltered: takes exactly the rows the same filter would have read", () => {
    repo.insert(row("2026-07-05", { message: "before-range" }));
    repo.insert(row("2026-07-06", { agentId: "a1", message: "in-range-a1" }));
    repo.insert(row("2026-07-06", { agentId: "a2", message: "in-range-a2" }));
    repo.insert(row("2026-07-07", { message: "after-range" }));

    // Narrowed to one Agent inside the range: everything the reader could not see survives.
    expect(repo.deleteFiltered("p1", { from: "2026-07-06", to: "2026-07-06", agentId: "a1" })).toBe(
      1,
    );
    expect(repo.recent("p1").map((r) => r.message)).toEqual([
      "after-range",
      "in-range-a2",
      "before-range",
    ]);

    // The range alone still spares the dates outside it.
    expect(repo.deleteFiltered("p1", { from: "2026-07-06", to: "2026-07-06" })).toBe(1);
    expect(repo.recent("p1").map((r) => r.message)).toEqual(["after-range", "before-range"]);
  });

  it("deleteFiltered follows the caller's includeGlobal: a member's clear leaves unattributed rows, an admin's takes them", () => {
    // Unattributed rows appear in every Project's admin view and in no member's. The clear
    // reaches exactly what the caller's read reaches, so only a read that includes them
    // deletes them; another Project's rows are out of reach either way.
    repo.insert(row("2026-07-06", { projectId: null, source: "process", message: "crash" }));
    repo.insert(row("2026-07-06", { projectId: "p-other", message: "other tenant" }));
    repo.insert(row("2026-07-06", { message: "mine" }));
    const remaining = () =>
      db
        .prepare("SELECT message FROM error_records ORDER BY id")
        .all()
        .map((r) => r.message);

    expect(repo.deleteFiltered("p1")).toBe(1);
    expect(remaining()).toEqual(["crash", "other tenant"]);

    expect(repo.deleteFiltered("p1", { includeGlobal: true })).toBe(1);
    expect(remaining()).toEqual(["other tenant"]);
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

  it("a gateway close is filed by its own verdict: the routine one leaves the count alone", () => {
    // The path the messaging bridge takes for a dropped connection: the connector's typed
    // close, classified by messagingErrorKind, persisted under `messaging_connect_failed`.
    // Both rows land — the log keeps everything — but only the one a person has to act on
    // reaches the unexpected count the cost center highlights.
    const rec = new ErrorRecorder(repo, now);
    const closed = (message: string, code: number, recovers: boolean) =>
      new MessagingConnectionClosedError(message, code, recovers);
    for (const err of [
      closed("gateway connection closed (code 4009)", 4009, true),
      closed("gateway connection closed (code 4004)", 4004, false),
    ]) {
      rec.record({
        source: "messaging",
        err,
        code: "messaging_connect_failed",
        kind: messagingErrorKind(err, "messaging_connect_failed"),
        // Distinct Projects so the recorder's short-window dedup does not swallow the second.
        ctx: { projectId: err.recovers ? "p-routine" : "p-fault" },
      });
    }
    const rows = db.prepare("SELECT kind, code, message FROM error_records ORDER BY id").all();
    expect(rows[0]).toMatchObject({ kind: "expected", code: "messaging_connect_failed" });
    expect(rows[1]).toMatchObject({ kind: "unexpected", code: "messaging_connect_failed" });
    expect(repo.summary("p-routine")).toEqual({ total: 1, unexpected: 0 });
    expect(repo.summary("p-fault")).toEqual({ total: 1, unexpected: 1 });
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

  /** A legacy stream's abort: prose reason only (cores from before the unified error pair). */
  function legacyAbort(reason: string): OmniMessage {
    const msg = abortEvent();
    delete (msg.payload as { error_code?: string }).error_code;
    (msg.payload as { reason?: string }).reason = reason;
    return msg;
  }

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
        agent_state: agentState,
        workspace: "/tmp/w",
      }),
      sessionId,
    );

  // —— LLM ——

  it("an unrecovered LLM failed → unexpected (needs a human); message takes the abort reason", () => {
    // Nothing follows this failure but the abort, so the ladder did not carry it: the user
    // lost the turn and it belongs in front of an operator.
    const got = feed([
      requestBegin(),
      requestEnd("retryable"),
      legacyAbort("llm request failed after 5 retries: 400 unknown parameter"),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      source: "llm",
      kind: "unexpected",
      code: "llm_failed",
      message: "llm request failed after 5 retries: 400 unknown parameter",
      project_id: "p1",
      agent_id: "a1",
      session_id: "s1",
      status: null,
    });
  });

  it("a retried retryable → expected; an exhausted one → unexpected; messages from abort/fallback", () => {
    const got = feed([
      requestBegin(),
      requestEnd("retryable"), // First attempt fails → the engine retries (revealed by the next request_begin: no reason text yet)
      requestBegin(),
      requestEnd("retryable"),
      legacyAbort("llm request failed after 2 retries"),
    ]);
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({ source: "llm", kind: "expected", code: "llm_retried" });
    // No abort arrived for the carried failure: falls back to the generic status text.
    expect(got[0]!.message).toContain("reconnects and retries");
    expect(got[1]).toMatchObject({
      source: "llm",
      kind: "unexpected",
      code: "llm_failed",
      message: "llm request failed after 2 retries",
    });
  });

  it("request_end(fatal) gets its own llm_fatal code, out of the retried dedup bucket", () => {
    // A run-ending rejection needs a code of its own: dedup is (source, code, Project)
    // over a short window, and `llm_retried` fires on every blip the ladder absorbs —
    // sharing a bucket would let a real credential failure be dropped as a duplicate.
    const got = feed([
      requestBegin(),
      requestEnd("fatal", { errorMessage: "401 invalid x-api-key (invalid_api_key)" }),
      legacyAbort("llm request error: 401 invalid x-api-key (invalid_api_key)"),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      source: "llm",
      kind: "unexpected",
      code: "llm_fatal",
      message: "llm request error: 401 invalid x-api-key (invalid_api_key)",
    });
  });

  it("a fatal with no abort (the live protocol): close persists it with the same prose", () => {
    // Failures no longer emit an abort event; the pending record resolves at close, and
    // the message is composed from the request_end's own detail.
    const got = feed([
      requestBegin(),
      requestEnd("fatal", { errorMessage: "401 invalid x-api-key (invalid_api_key)" }),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      source: "llm",
      kind: "unexpected",
      code: "llm_fatal",
      message: "llm request error: 401 invalid x-api-key (invalid_api_key)",
    });
  });

  it("an exhausted ladder with no abort: the terminal request_end's attempt shapes the record", () => {
    const got = feed([
      requestBegin(),
      requestEnd("retryable", { errorMessage: "socket hang up", attempt: 1, retryInMs: 2000 }),
      requestBegin(),
      // The final failure plans no retry (no retry_in_ms) — the run ends on it.
      requestEnd("retryable", { errorMessage: "socket hang up", attempt: 2 }),
    ]);
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({ code: "llm_retried", kind: "expected" });
    expect(got[1]).toMatchObject({
      source: "llm",
      kind: "unexpected",
      code: "llm_failed",
      message: "llm request failed after 1 retry: socket hang up",
    });
  });

  it("a retryable the ladder carried → expected under its own code, not an operator incident", () => {
    // The same status covers "a gateway hiccup the user never saw" and "the run died on
    // it". A following request_begin proves another attempt happened — that one is
    // expected.
    const got = feed([
      requestBegin(),
      requestEnd("retryable", {
        errorMessage: "Upstream HTTP/2 stream failed (upstream_http2_stream_error)",
      }),
      requestBegin(),
      requestEnd("completed"),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      source: "llm",
      kind: "expected",
      code: "llm_retried",
      // No abort ever arrives on the retry path: the staged request_end's own detail is the
      // message of record.
      message: "Upstream HTTP/2 stream failed (upstream_http2_stream_error)",
    });
  });

  it("a recovered retryable does not dedup away a fatal that lands right after", () => {
    // The two share a 2s dedup window; separate codes keep the one failure that always
    // needs a human from being silenced by the one that never does.
    const got = feed([
      requestBegin(),
      requestEnd("retryable", { errorMessage: "Upstream HTTP/2 stream failed" }),
      requestBegin(), // The retry: resolves the failure above as recovered.
      requestEnd("fatal", { errorMessage: "401 invalid x-api-key" }),
      legacyAbort("llm request error: 401 invalid x-api-key"),
    ]);
    expect(got.map((r) => [r.code, r.kind])).toEqual([
      ["llm_retried", "expected"],
      ["llm_fatal", "unexpected"],
    ]);
  });

  it("a retried failure keeps its real detail: request_end(retryable).message lands in the record", () => {
    // The retry path: the engine reconnects (request_begin) and eventually succeeds, so no
    // abort ever arrives for the staged failure — the request_end's own failure detail
    // (LLMOutcome.errorMessage, e.g. a rate-limit code) is the message of record, not the
    // generic status text. This is what the Cost center shows for a retried 429.
    const got = feed([
      requestBegin(),
      requestEnd("retryable", {
        errorMessage: "429 rate limited (slow down)",
      }),
      requestBegin(),
      requestEnd("completed"),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      source: "llm",
      kind: "expected",
      code: "llm_retried",
      message: "429 rate limited (slow down)",
    });
  });

  it("an abort reason still outranks the staged request_end detail (fatal exit path)", () => {
    const got = feed([
      requestBegin(),
      requestEnd("fatal", { errorMessage: "401 invalid x-api-key (invalid_api_key)" }),
      legacyAbort("llm request error: 401 invalid x-api-key (invalid_api_key)"),
    ]);
    expect(got).toHaveLength(1);
    // The abort's prose (with core's "llm request error" framing) wins over the raw detail.
    expect(got[0]!.message).toBe("llm request error: 401 invalid x-api-key (invalid_api_key)");
  });

  it("interrupt during backoff with a staged detail: the detail wins over the status text", () => {
    // The interrupt message is distrusted (not the failure's reason), but the staged
    // request_end detail IS the failure's reason — prefer it over the generic status text.
    const got = feed([
      requestBegin(),
      // A backoff interrupt cuts a PLANNED retry short — the failure announced one.
      requestEnd("retryable", { errorMessage: "429 rate limited (slow down)", retryInMs: 4000 }),
      abortEvent("backoff_interrupted"),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]!.message).toBe("429 rate limited (slow down)");
  });

  it("aborted (user clicked Stop) is not an error: not recorded; neither is completed", () => {
    expect(
      feed([
        requestBegin(),
        requestEnd("completed"),
        requestBegin(),
        requestEnd("aborted"),
        abortEvent(),
      ]),
    ).toHaveLength(0);
  });

  it("interrupt during retry backoff: the failure still recorded, interrupt text distrusted", () => {
    const got = feed([requestBegin(), requestEnd("retryable"), abortEvent("backoff_interrupted")]);
    expect(got).toHaveLength(1);
    // No retry followed (the interrupt ended the run): the conservative branch records it
    // as the unrecovered class.
    expect(got[0]).toMatchObject({ code: "llm_failed", kind: "unexpected" });
    expect(got[0]!.message).toContain("did not recover");
    expect(got[0]!.message).not.toContain("aborted");
  });

  it("failure pends for its reason; unresolved at run end → close persists (status text)", () => {
    const w = watcher();
    w.observe(requestBegin());
    w.observe(requestEnd("retryable"));
    expect(rows()).toHaveLength(0); // Pending: waiting for the abort that immediately follows to supply the real reason
    w.close();
    const got = rows();
    expect(got).toHaveLength(1);
    // close() is not proof of a retry, so it takes the conservative branch: unrecovered.
    expect(got[0]).toMatchObject({ code: "llm_failed", kind: "unexpected" });
    expect(got[0]!.message).toBe("LLM request failed and the retries did not recover it.");
  });

  it("parent/child LLM failures pend separately by origin; abort reasons never cross over", () => {
    // The child fails fatal and the parent retryable-unrecovered: distinct codes, so the
    // short-window dedup (source, code, Project) suppresses neither.
    const got = feed([
      requestBegin(), // parent session initiates
      withOrigin(requestBegin(), "session-child"),
      withOrigin(requestEnd("fatal"), "session-child"),
      withOrigin(legacyAbort("llm request error: 401 invalid api key"), "session-child"),
      requestEnd("retryable"), // the parent session's failure only wraps up now
      legacyAbort("llm request error: 500 upstream"),
    ]);
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({
      code: "llm_fatal",
      message: "llm request error: 401 invalid api key",
    });
    expect(got[1]).toMatchObject({
      code: "llm_failed",
      message: "llm request error: 500 upstream", // not stolen by the sub-session's abort
    });
  });

  // —— Environment (tool execution) ——

  const call = (name: string, id: string) => toolCall({ name, arguments: "{}", toolCallId: id });

  it("a command tool's ordinary non-zero exit is not recorded: an exit status is information", () => {
    // Both command tools end in resultForExit, which maps ANY non-zero exit to `failed`, so
    // grep finding nothing (exit 1), `test -f` on a missing file, or a diff that differs would
    // all land in the cost center and bury the real errors. input_command is covered alongside
    // exec_command because it is how a backgrounded command is polled for its eventual exit —
    // dropping one but not the other would depend on where the command happened to finish.
    // Every other tool still records, whatever its output says.
    const got = feed([
      call("exec_command", "tc-1"),
      toolCallOutput({
        output: "grep: no match\n[exit code: 1]",
        toolCallId: "tc-1",
        stopReason: "fatal",
      }),
      call("input_command", "tc-2"),
      toolCallOutput({
        output: "make: *** [build] Error 2\n[exit code: 2]",
        toolCallId: "tc-2",
        stopReason: "fatal",
      }),
      call("write_file", "tc-3"),
      toolCallOutput({
        output: "EACCES\n[exit code: 1]",
        toolCallId: "tc-3",
        stopReason: "fatal",
      }),
    ]);
    expect(got.map((r) => r.code)).toEqual(["tool_fatal:write_file"]);
  });

  it("a command tool killed by a signal, or that never spawned, is still recorded", () => {
    // `failed` from these tools is not only "exited non-zero": an OOM kill or a segfault
    // (resultForExit's signal branch) and a spawn failure (nonexistent workdir, EMFILE, an
    // unresolvable shell) are config/environment faults — the recorder's "needs a human"
    // category — that no amount of Agent self-correction gets around. Only the exit marker
    // separates them, which is why the rule reads the note rather than the tool name.
    const got = feed([
      call("exec_command", "tc-1"),
      toolCallOutput({
        output: "cc1plus: out of memory\n[terminated by signal SIGKILL]",
        toolCallId: "tc-1",
        stopReason: "fatal",
      }),
      call("input_command", "tc-2"),
      toolCallOutput({
        output: "[spawn error: ENOENT: no such file or directory, posix_spawn '/bin/nope']",
        toolCallId: "tc-2",
        stopReason: "fatal",
      }),
    ]);
    expect(got.map((r) => r.code)).toEqual(["tool_fatal:exec_command", "tool_fatal:input_command"]);
  });

  it("a command tool's timeout and a missing session manager are recorded (neither is an exit)", () => {
    // Environment finalizes a tool timeout as stop_reason `failed` plus its own note — it never
    // emits stop_reason "timeout" for these tools — so a hung command surfaces as tool_failed
    // with no exit marker to drop it. A missing command session manager is a server
    // misconfiguration and produces no exit marker either.
    const got = feed([
      call("exec_command", "tc-1"),
      toolCallOutput({
        output: "still building…\n[tool timeout: exceeded 60000ms]",
        toolCallId: "tc-1",
        stopReason: "fatal",
      }),
      call("input_command", "tc-2"),
      toolCallOutput({
        output: "[input_command unavailable: no command session manager configured]",
        toolCallId: "tc-2",
        stopReason: "fatal",
      }),
    ]);
    expect(got.map((r) => r.code)).toEqual(["tool_fatal:exec_command", "tool_fatal:input_command"]);
  });

  it("an exit marker with no cached tool name is dropped, not filed under tool_fatal:unknown", () => {
    // Only the command tools ever write that marker, so a cache miss (the tool_call evicted, or
    // never seen) is still that noise — recording it nameless would defeat the exclusion.
    const got = feed([
      toolCallOutput({ output: "[exit code: 1]", toolCallId: "tc-1", stopReason: "fatal" }),
      toolCallOutput({ output: "boom", toolCallId: "tc-2", stopReason: "fatal" }),
    ]);
    expect(got.map((r) => [r.code, r.message])).toEqual([["tool_fatal:unknown", "boom"]]);
  });

  it("a tool fatal → environment + expected, code carries the tool name; legacy failed/timeout spellings still record", () => {
    const legacyOutput = (args: { output: string; toolCallId: string; stopReason: string }) =>
      toolCallOutput(args as Parameters<typeof toolCallOutput>[0]);
    const got = feed([
      call("write_file", "tc-1"),
      toolCallOutput({
        output: "EACCES: permission denied\n[tool error] write failed",
        toolCallId: "tc-1",
        stopReason: "fatal",
      }),
      // Traces written before the stop-reason unification spell tool failures failed/timeout.
      call("read_file", "tc-2"),
      legacyOutput({
        output: "[tool timeout: exceeded 30000ms]",
        toolCallId: "tc-2",
        stopReason: "timeout",
      }),
      call("edit_file", "tc-3"),
      legacyOutput({ output: "[tool error] boom", toolCallId: "tc-3", stopReason: "failed" }),
    ]);
    expect(got).toHaveLength(3);
    expect(got[0]).toMatchObject({
      source: "environment",
      kind: "expected", // error fed back to the model; the Agent adjusts on its own — no human needed
      code: "tool_fatal:write_file",
      project_id: "p1",
      agent_id: "a1",
      session_id: "s1",
    });
    expect(got[0]!.message).toContain("[tool error] write failed"); // the actual error text
    expect(got[1]).toMatchObject({ code: "tool_timeout:read_file", kind: "expected" });
    expect(got[2]).toMatchObject({ code: "tool_failed:edit_file", kind: "expected" });
  });

  it("tool aborted (denial / user interrupt) and completed are not recorded", () => {
    expect(
      feed([
        call("write_file", "tc-1"),
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
      call("write_file", "tc-1"),
      call("read_file", "tc-2"),
      call("write_file", "tc-3"),
      toolCallOutput({ output: "boom-2", toolCallId: "tc-2", stopReason: "fatal" }),
      toolCallOutput({ output: "ok", toolCallId: "tc-3", stopReason: "completed" }),
      toolCallOutput({ output: "boom-1", toolCallId: "tc-1", stopReason: "fatal" }),
    ]);
    expect(got.map((r) => r.code)).toEqual(["tool_fatal:read_file", "tool_fatal:write_file"]);
    expect(got.map((r) => r.message)).toEqual(["boom-2", "boom-1"]);
  });

  it("a child session's tool failure: no name mix-up with the parent's equal tool_call_id", () => {
    const got = feed([
      call("read_file", "tc-1"), // parent session
      withOrigin(call("write_file", "tc-1"), "session-child"), // sub-session happens to share the same id
      withOrigin(
        toolCallOutput({ output: "child boom", toolCallId: "tc-1", stopReason: "fatal" }),
        "session-child",
      ),
      toolCallOutput({ output: "parent boom", toolCallId: "tc-1", stopReason: "fatal" }),
    ]);
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({
      code: "tool_fatal:write_file", // the sub-session's tool name, not overwritten by the parent's tc-1
      message: "child boom",
      session_id: "s1", // this test didn't feed the sub-session's session_meta → attribution falls back to the parent ctx (see the "attribution" test cases below)
    });
    expect(got[1]).toMatchObject({ code: "tool_fatal:read_file", message: "parent boom" });
  });

  it("overlong tool output: message takes the tail (the reason is at the end)", () => {
    const got = feed([
      call("write_file", "tc-1"),
      toolCallOutput({
        output: `${"x".repeat(2000)}\n[tool error] boom`,
        toolCallId: "tc-1",
        stopReason: "fatal",
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
        call("write_file", "tc-1"),
        partialToolCallOutput({ eventType: "stop", toolCallId: "tc-1", stopReason: "fatal" }),
      ]),
    ).toHaveLength(0);
  });

  // —— Attribution: an error is recorded against **the session that actually produced it** (a sub-session's failure must not be attributed to the parent Agent) ——

  it("a child session's LLM failure attributes to the child Agent / Session", () => {
    const got = feed([
      childMeta("session-child", "/data/agents/agent-child/agent_state"),
      withOrigin(requestBegin(), "session-child"),
      withOrigin(requestEnd("retryable"), "session-child"),
      withOrigin(legacyAbort("llm request error: 401 invalid api key"), "session-child"),
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
      withOrigin(call("write_file", "tc-1"), "session-child"),
      withOrigin(
        toolCallOutput({ output: "child boom", toolCallId: "tc-1", stopReason: "fatal" }),
        "session-child",
      ),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      source: "environment",
      code: "tool_fatal:write_file",
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
      withOrigin(requestEnd("fatal"), "session-child"),
      withOrigin(legacyAbort("llm request error: 401 dead key"), "session-child"),
      withOrigin(call("write_file", "tc-9"), "session-child"),
      withOrigin(
        toolCallOutput({ output: "child tool boom", toolCallId: "tc-9", stopReason: "fatal" }),
        "session-child",
      ),
      call("read_file", "tc-9"), // parent session happens to share the same id
      toolCallOutput({ output: "parent tool boom", toolCallId: "tc-9", stopReason: "fatal" }),
      requestEnd("retryable"), // the parent session's LLM failure only wraps up now
      legacyAbort("llm request error: 500 upstream"),
    ]);
    // The sub-session's LLM / tool failures attribute to it, the parent's to the parent — the four entries never mix (each has a distinct code, so short-window dedup doesn't suppress any of them).
    expect(got.map((r) => [r.code, r.agent_id, r.session_id])).toEqual([
      ["llm_fatal", "agent-child", "session-child"],
      ["tool_fatal:write_file", "agent-child", "session-child"],
      ["tool_fatal:read_file", "a1", "s1"],
      ["llm_failed", "a1", "s1"],
    ]);
  });

  it("failure before session_meta arrives: falls back to the parent ctx, no crash", () => {
    const got = feed([
      withOrigin(requestEnd("retryable"), "session-child"), // the sub-session's meta hasn't arrived yet
      withOrigin(legacyAbort("llm request error: 500"), "session-child"),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ code: "llm_failed", agent_id: "a1", session_id: "s1" });
  });

  it("malformed agent_state path (empty): not registered, falls back to the parent ctx", () => {
    const got = feed([
      childMeta("session-child", ""), // path.basename(path.dirname("")) === "." → caught by the defensive check
      withOrigin(requestEnd("retryable"), "session-child"),
      withOrigin(legacyAbort("llm request error: 500"), "session-child"),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ code: "llm_failed", agent_id: "a1", session_id: "s1" });
  });

  // —— Compaction ——

  it("an abandoned compaction records one error row; the message carries attempts and the error", () => {
    // Issue #170: a compaction is an ordinary LLM request whose failures core retries under
    // the standard budget — a retryable end means the retries ran out, and the cost
    // center's row shows how many attempts were spent and what the last failure was.
    const got = feed([
      compactionEnd({
        reason: "context",
        mode: "summarize",
        status: "retryable",
        attempt: 5,
        errorMessage: "the response contained no usable summary",
      }),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      source: "compaction",
      kind: "unexpected",
      code: "compaction_failed",
      message:
        "summarize compaction failed after 5 attempts: the response contained no usable summary; trigger context, original context kept.",
      project_id: "p1",
      agent_id: "a1",
      session_id: "s1",
    });
  });

  it("compaction completed / aborted are not errors; fatal and an old-core failed still record", () => {
    const legacyEnd = (status: string) =>
      compactionEnd({ reason: "turns", mode: "summarize", status: status as StopReason });
    const got = feed([
      compactionEnd({ reason: "context", mode: "summarize", status: "completed", attempt: 1 }),
      compactionEnd({ reason: "manual", mode: "summarize", status: "aborted", attempt: 2 }),
      compactionEnd({ reason: "context", mode: "summarize", status: "fatal", attempt: 1 }),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ code: "compaction_failed" });
    // An old core's compaction_end (retired `failed` spelling, no attempt/error fields)
    // still records — its own feed, since the short-window dedup shares the code above.
    const legacy = feed([legacyEnd("failed")]);
    expect(legacy).toHaveLength(2); // rows are cumulative: the fatal row above plus this one
    expect(legacy[1]).toMatchObject({
      code: "compaction_failed",
      message: "summarize compaction failed; trigger turns, original context kept.",
    });
  });

  it("a child session's failed compaction attributes to the child Agent/Session", () => {
    const got = feed([
      childMeta("session-child", "/data/agents/agent-child/agent_state"),
      withOrigin(
        compactionEnd({ reason: "context", mode: "summarize", status: "retryable", attempt: 6 }),
        "session-child",
      ),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      code: "compaction_failed",
      agent_id: "agent-child",
      session_id: "session-child",
    });
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

  it("the paged error route pages inside the caller's own tenant, at every offset", async () => {
    // The point of the route is that paging back is not a way around the dashboard's isolation:
    // the rows a member can reach at offset N are the same set the summary counted, never
    // another tenant's and never the unattributed ones. Seeded directly so the interleaving is
    // exact — going through HTTP would collapse repeats into the recorder's dedup window.
    const repo = new ErrorsRepo(t.deps.db);
    const seed = (owner: string | null, code: string) =>
      repo.insert({
        ts: "2026-07-27T00:00:00.000Z",
        date: "2026-07-27",
        projectId: owner,
        agentId: "a1",
        sessionId: "s1",
        source: "http",
        kind: "expected",
        code,
        status: 404,
        message: code,
      });
    const foreign = (await (
      await api.post("/api/projects", { projectId: "err_user-tenant_2", name: "Other tenant" })
    ).json()) as ProjectCreateResponse;
    // Interleaved, so a mistaken filter would show up inside the first page rather than past it.
    seed(projectId, "mine_0");
    seed(foreign.project.projectId, "theirs_0");
    seed(null, "unattributed_0");
    seed(projectId, "mine_1");
    seed(projectId, "mine_2");

    const pageOf = async (offset: number, limit: number) =>
      (await (
        await api.get(`/api/projects/${projectId}/usage/errors?offset=${offset}&limit=${limit}`)
      ).json()) as UsageErrorsPage;

    const first = await pageOf(0, 2);
    expect(first.total).toBe(3); // the filtered count, not the table's
    expect(first.items.map((e) => e.code)).toEqual(["mine_2", "mine_1"]); // newest first
    const second = await pageOf(2, 2);
    expect(second.total).toBe(3);
    expect(second.items.map((e) => e.code)).toEqual(["mine_0"]);
    expect((await pageOf(3, 2)).items).toEqual([]); // past the end is empty, not an error

    // The admin is the only one who reaches the unattributed rows — the same rule the dashboard
    // applies, so paging cannot be used to slip past it.
    const adminApi = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const adminPage = (await (
      await adminApi.get(`/api/projects/default_project/usage/errors?offset=0&limit=20`)
    ).json()) as UsageErrorsPage;
    expect(adminPage.items.map((e) => e.code)).toEqual(["unattributed_0"]);
  });

  it("the paged error route rejects a page it cannot serve rather than guessing", async () => {
    expect((await api.get(`/api/projects/${projectId}/usage/errors?offset=-1`)).status).toBe(400);
    expect((await api.get(`/api/projects/${projectId}/usage/errors?limit=0`)).status).toBe(400);
    expect((await api.get(`/api/projects/${projectId}/usage/errors?limit=1001`)).status).toBe(400);
    expect((await api.get(`/api/projects/${projectId}/usage/errors?from=2026-13-01`)).status).toBe(
      400,
    );
    // A `kind` outside the two categories is a bad request, not a silently empty page: the
    // cost-center badge reads `total` as "is anything waiting", and a typo answering 0 would
    // read as "nothing is".
    expect((await api.get(`/api/projects/${projectId}/usage/errors?kind=oops`)).status).toBe(400);
  });

  it("the paged error route narrows to one category on request, counting only that one", async () => {
    // What the cost-center badge asks: one row of `unexpected`, for the count and the newest
    // timestamp its dismissal is stamped against. Seeded directly, so the interleaving is exact.
    const repo = new ErrorsRepo(t.deps.db);
    const seed = (kind: string, code: string, ts: string) =>
      repo.insert({
        ts,
        date: ts.slice(0, 10),
        projectId,
        agentId: "a1",
        sessionId: "s1",
        source: "http",
        kind,
        code,
        status: kind === "unexpected" ? 500 : 404,
        message: code,
      });
    seed("expected", "expected_0", "2026-07-27T00:00:00.000Z");
    seed("unexpected", "unexpected_0", "2026-07-27T01:00:00.000Z");
    seed("expected", "expected_1", "2026-07-27T02:00:00.000Z");
    seed("unexpected", "unexpected_1", "2026-07-27T03:00:00.000Z");

    const probe = (await (
      await api.get(`/api/projects/${projectId}/usage/errors?offset=0&limit=1&kind=unexpected`)
    ).json()) as UsageErrorsPage;
    expect(probe.total).toBe(2); // only the unexpected ones are counted
    expect(probe.items.map((e) => e.code)).toEqual(["unexpected_1"]); // newest first, one row

    const expectedOnly = (await (
      await api.get(`/api/projects/${projectId}/usage/errors?offset=0&limit=20&kind=expected`)
    ).json()) as UsageErrorsPage;
    expect(expectedOnly.items.map((e) => e.code)).toEqual(["expected_1", "expected_0"]);

    // No `kind` still counts both, so the panel the badge leads to is unchanged.
    const all = (await (
      await api.get(`/api/projects/${projectId}/usage/errors?offset=0&limit=20`)
    ).json()) as UsageErrorsPage;
    expect(all.total).toBe(4);
  });

  /** Seeds one row straight into the table, so a batch's dates and Agents are exact. */
  const seedRow = (o: Partial<ErrorRecordInsert> & { date: string; code: string }) =>
    new ErrorsRepo(t.deps.db).insert({
      ts: `${o.date}T00:00:00.000Z`,
      projectId,
      agentId: null,
      sessionId: null,
      source: "http",
      kind: "expected",
      status: 404,
      message: o.code,
      ...o,
    });

  it("clearing errors takes the filter on screen and nothing outside it", async () => {
    seedRow({ date: "2026-07-05", code: "before_range" });
    seedRow({ date: "2026-07-06", code: "in_range_a1", agentId: "a1" });
    seedRow({ date: "2026-07-06", code: "in_range_a2", agentId: "a2" });
    seedRow({ date: "2026-07-08", code: "after_range" });

    // Narrowed to one Agent inside the range: exactly the rows that filter reads.
    const narrow = await api.delete(
      `/api/projects/${projectId}/usage/errors?from=2026-07-06&to=2026-07-06&agentId=a1`,
    );
    expect(narrow.status).toBe(200);
    expect(await narrow.json()).toEqual({ deleted: 1 });
    expect(errorRows().map((r) => r.code)).toEqual(["before_range", "in_range_a2", "after_range"]);

    // The range on its own still spares the dates the reader was not looking at.
    const ranged = await api.delete(
      `/api/projects/${projectId}/usage/errors?from=2026-07-06&to=2026-07-07`,
    );
    expect(await ranged.json()).toEqual({ deleted: 1 });
    expect(errorRows().map((r) => r.code)).toEqual(["before_range", "after_range"]);

    // No filter clears the Project's whole history, which is what an unfiltered panel showed.
    expect(await (await api.delete(`/api/projects/${projectId}/usage/errors`)).json()).toEqual({
      deleted: 2,
    });
    expect(errorRows()).toHaveLength(0);
  });

  it("a trailing-window clear deletes exactly the rows the window listed", async () => {
    const day = "2026-07-06";
    seedRow({ date: day, code: "before_window", ts: `${day}T09:59:59.999Z` });
    seedRow({ date: day, code: "at_from", ts: `${day}T10:00:00.000Z` });
    seedRow({ date: day, code: "at_to", ts: `${day}T11:00:00.000Z` });
    seedRow({ date: day, code: "after_window", ts: `${day}T11:00:00.001Z` });
    const window = `from=${day}&to=${day}&fromTs=${day}T10:00:00.000Z&toTs=${day}T11:00:00.000Z`;

    // What the panel lists for the window …
    const listed = (await (
      await api.get(`/api/projects/${projectId}/usage/errors?offset=0&limit=20&${window}`)
    ).json()) as UsageErrorsPage;
    expect(listed.items.map((e) => e.code)).toEqual(["at_to", "at_from"]);
    expect(listed.total).toBe(2);

    // … is what the clear of the same window takes: the same day's rows a millisecond
    // outside it stay.
    const cleared = await api.delete(`/api/projects/${projectId}/usage/errors?${window}`);
    expect(await cleared.json()).toEqual({ deleted: 2 });
    expect(errorRows().map((r) => r.code)).toEqual(["before_window", "after_window"]);

    // Half a window is refused, as the dashboard refuses it.
    const half = await api.delete(
      `/api/projects/${projectId}/usage/errors?fromTs=${day}T10:00:00.000Z`,
    );
    expect(half.status).toBe(400);
  });

  it("a member cannot clear the log, so it is no route to the unattributed rows", async () => {
    seedRow({ date: "2026-07-06", code: "project_row" });
    seedRow({ date: "2026-07-06", code: "unattributed_row", projectId: null, source: "process" });

    // The refusals below are recorded by app.onError like any other, so the seeded rows are
    // read back by code rather than by counting the table.
    const seeded = () =>
      errorRows()
        .map((r) => r.code as string)
        .filter((c) => c === "project_row" || c === "unattributed_row");

    const member = await provisionUser(t.app, "member_user");
    expect(member.user.isAdmin).toBe(false);
    const added = await api.post(`/api/projects/${projectId}/members`, { userId: "member_user" });
    expect(added.status).toBe(201);
    const memberApi = apiClient(t.app, member.cookie);

    // Reading the panel is a member's right; emptying it is the owner's, like deleting an Agent.
    expect((await memberApi.get(`/api/projects/${projectId}/usage/errors?offset=0`)).status).toBe(
      200,
    );
    const refused = await memberApi.delete(`/api/projects/${projectId}/usage/errors`);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      "owner_required",
    );
    expect(seeded()).toEqual(["project_row", "unattributed_row"]);

    // A non-member is not told the Project exists, let alone allowed to empty it.
    const outsider = await provisionUser(t.app, "outsider_user");
    const outsiderApi = apiClient(t.app, outsider.cookie);
    expect((await outsiderApi.delete(`/api/projects/${projectId}/usage/errors`)).status).toBe(404);
    expect(seeded()).toEqual(["project_row", "unattributed_row"]);
  });

  it("an admin's clear takes the unattributed rows an admin's read showed", async () => {
    // They show in every Project's admin view and in no member's, so the clear follows the
    // read: the one person who can see them anywhere empties them from the panel that showed
    // them, while a member's clear (whose read never lists them) never reaches them.
    const adminApi = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    new ErrorsRepo(t.deps.db).insert({
      ts: "2026-07-06T00:00:00.000Z",
      date: "2026-07-06",
      projectId: null,
      agentId: null,
      sessionId: null,
      source: "process",
      kind: "unexpected",
      code: "uncaught_exception",
      status: null,
      message: "crash",
    });
    // The admin can see it from their own Project, which is exactly the view being cleared.
    const before = (await (
      await adminApi.get(`/api/projects/default_project/usage/errors?offset=0&limit=20`)
    ).json()) as UsageErrorsPage;
    expect(before.items.map((e) => e.code)).toEqual(["uncaught_exception"]);

    const cleared = await adminApi.delete(`/api/projects/default_project/usage/errors`);
    expect(await cleared.json()).toEqual({ deleted: 1 });
    expect(errorRows().filter((r) => r.project_id === null)).toHaveLength(0);
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
