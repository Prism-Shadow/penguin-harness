/**
 * The `history` stream of this server's own Sessions (http/routes/history.ts,
 * services/history-stream.ts), read over HTTP as SSE the way a reader without the socket reads it.
 *
 * - Given a Session's Trace, when its tail, the window before it and the whole transcript are
 *   read as a stream, then each one's records equal `/messages`' for the same query with their
 *   bulky values elided, and its page facts equal that answer's `page`.
 * - Given a record longer than one frame, then it arrives in parts that join to the record.
 * - Given a stream re-issued with the last event id it saw, then it continues the same window
 *   from there; once the window's hold has lapsed, it gets the window anew under a new id.
 * - Given a resume id sent for another Session's path, or another query, then the reader gets that
 *   Session's or query's own window anew, never the one the id named.
 * - Given many windows held, then a reader keeps only its newest few within its byte bound, and
 *   all readers together stay within theirs; a window too big for one reader is not held.
 * - Given `fill=1`, then `filled` follows `done`: a local Session already holds all of it.
 * - Given a Session the caller cannot see, then the stream's one event says
 *   `session_not_found`, and a malformed query is a `bad_request` the same way; an admin its
 *   Project refuses is told `session_forbidden` instead (the rule every Session route reads by).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  assistantText,
  sessionMeta,
  toolCall,
  toolCallOutput,
  userText,
} from "@prismshadow/penguin-core";
import { elideHistoryRecord } from "@prismshadow/penguin-core/interfaces";
import type { HistoryMessage, HistoryPage, MessagesResponse } from "../src/api/types.js";
import {
  HELD_BYTES,
  HELD_BYTES_PER_USER,
  HELD_WINDOWS_PER_USER,
  HeldWindows,
} from "../src/services/history-stream.js";
import type { HistoryWindow } from "../src/services/history-stream.js";
import { FRAME_TEXT_BUDGET } from "../src/socket/line-frames.js";
import { eventReader, windowRecords } from "./fixtures/history-stream.js";
import type { StreamEvent } from "./fixtures/history-stream.js";
import { sessionRow, uniqueSessionId } from "./fixtures/session.js";
import { createTestApp, loginAdmin, waitFor, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";

let t: TestApp;
let cookie: string;
const SID = uniqueSessionId();
const AGENT = "default_agent";

beforeAll(async () => {
  t = await createTestApp();
  cookie = (await loginAdmin(t.app)).cookie;
  const row = sessionRow(SID);
  t.deps.sessionsRepo.insert(row);
  await writeTraceFile(t.root, row.projectId, AGENT, "2026-10-29", SID, 1, [
    sessionMeta({
      session_id: SID,
      provider: "custom",
      model_id: "m1",
      model_context_window: 1000,
      system_prompt: "",
      agent_state: "/tmp/a",
      workspace: row.workspace,
      source: "user",
    }),
    userText("read the big file"),
    toolCall({ name: "read_file", arguments: '{"file_path":"/w/big.txt"}', toolCallId: "c1" }),
    toolCallOutput({ output: "line\n".repeat(8_000), toolCallId: "c1", status: "completed" }),
    assistantText("it is big"),
    // A prompt longer than a frame: nothing elides a user's own words, so it travels in parts.
    userText(`and this? ${"z".repeat(FRAME_TEXT_BUDGET + 5_000)}`),
    assistantText("that too"),
  ]);
});

afterAll(async () => {
  await t.cleanup();
});

afterEach(() => {
  vi.useRealTimers();
});

const get = (path: string, headers: Record<string, string> = {}) =>
  t.app.request(path, { headers: { cookie, ...headers } });

/** A stream read to its end (the server ends it after `done`, `filled` or `error`). */
async function readAll(path: string, headers: Record<string, string> = {}): Promise<StreamEvent[]> {
  const reader = eventReader(await get(path, headers));
  await reader.finished;
  return reader.named();
}

/** What `/messages` answers for `query`, each record elided as the stream elides it. */
async function elidedMessages(
  query: string,
): Promise<{ records: HistoryMessage[]; page: MessagesResponse["page"] }> {
  const res = await get(`/api/sessions/${SID}/messages${query}`);
  const body = (await res.json()) as MessagesResponse;
  return {
    page: body.page,
    records: body.messages.map(
      (m) =>
        elideHistoryRecord(m, {
          agentId: AGENT,
          sessionId: SID,
          fileIndex: m.tracePosition!.fileIndex,
          ordinal: m.tracePosition!.ordinal,
        }).record,
    ),
  };
}

const pageOf = (events: StreamEvent[]): HistoryPage =>
  JSON.parse(events.find((e) => e.event === "page")!.data) as HistoryPage;

describe("the history stream of a local Session", () => {
  it.each([
    ["the tail", "?tailLimit=1"],
    ["the whole transcript", ""],
  ])("sends %s as /messages answers it, elided", async (_name, query) => {
    const events = await readAll(`/api/sessions/${SID}/history${query}`);
    const expected = await elidedMessages(query);
    expect(windowRecords(events)).toEqual(JSON.parse(JSON.stringify(expected.records)));
    const page = pageOf(events);
    expect(page.count).toBe(expected.records.length);
    expect(page.page).toEqual(expected.page);
    expect(events.at(-1)?.event).toBe("done");
  });

  it("sends the window before a cursor as /messages answers it", async () => {
    const tail = pageOf(await readAll(`/api/sessions/${SID}/history?tailLimit=1`));
    const before = `?before=${encodeURIComponent(tail.page!.before!)}&limit=1`;
    const events = await readAll(`/api/sessions/${SID}/history${before}`);
    expect(windowRecords(events)).toEqual(
      JSON.parse(JSON.stringify((await elidedMessages(before)).records)),
    );
  });

  it("sends a record longer than a frame in parts that join to it", async () => {
    const events = await readAll(`/api/sessions/${SID}/history?tailLimit=1`);
    const parts = events.filter((e) => e.event === "part");
    expect(parts.length).toBeGreaterThan(1);
    expect(
      parts.every((e) => (JSON.parse(e.data) as { text: string }).text.length <= FRAME_TEXT_BUDGET),
    ).toBe(true);
    const prompt = windowRecords(events).find(
      (r) =>
        ((r as HistoryMessage).payload as { text?: string }).text?.startsWith("and this?") === true,
    );
    expect(((prompt as HistoryMessage).payload as { text: string }).text).toHaveLength(
      "and this? ".length + FRAME_TEXT_BUDGET + 5_000,
    );
  });

  it("continues a re-issued stream from its last event id, and starts anew once the hold has lapsed", async () => {
    const path = `/api/sessions/${SID}/history?tailLimit=1`;
    const first = eventReader(await get(path));
    await waitFor(() => first.events.some((e) => e.event === "part"));
    await first.stop();
    const seen = first.named();
    const lastId = seen.filter((e) => e.id !== null).at(-1)!.id!;
    const windowId = pageOf(seen).windowId;

    const resumed = await readAll(path, { "last-event-id": lastId });
    expect(resumed.some((e) => e.event === "page")).toBe(false);
    const whole = await readAll(path);
    expect(windowRecords([...seen, ...resumed])).toEqual(windowRecords(whole));
    expect(resumed.every((e) => e.id === null || e.id.startsWith(`${windowId}:`))).toBe(true);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 121_000);
    const lapsed = await readAll(path, { "last-event-id": lastId });
    expect(pageOf(lapsed).windowId).not.toBe(windowId);
    expect(windowRecords(lapsed)).toEqual(windowRecords(whole));
  });

  it("never continues another Session's window, or another query's, under a resume id", async () => {
    const other = uniqueSessionId();
    const row = sessionRow(other);
    t.deps.sessionsRepo.insert(row);
    await writeTraceFile(t.root, row.projectId, AGENT, "2026-10-29", other, 1, [
      userText("the other conversation"),
      assistantText("plain"),
    ]);
    const mine = await readAll(`/api/sessions/${SID}/history?tailLimit=1`);
    const lastId = mine.filter((e) => e.id !== null).at(-1)!.id!;
    const windowId = pageOf(mine).windowId;

    const elsewhere = await readAll(`/api/sessions/${other}/history?tailLimit=1`, {
      "last-event-id": lastId,
    });
    expect(pageOf(elsewhere).windowId).not.toBe(windowId);
    expect(JSON.stringify(windowRecords(elsewhere))).toContain("the other conversation");
    expect(JSON.stringify(windowRecords(elsewhere))).not.toContain("and this?");

    const otherQuery = await readAll(`/api/sessions/${SID}/history?tailLimit=2`, {
      "last-event-id": lastId,
    });
    expect(pageOf(otherQuery).windowId).not.toBe(windowId);
  });

  it("follows done with filled for fill=1", async () => {
    const events = await readAll(`/api/sessions/${SID}/history?tailLimit=1&fill=1`);
    expect(events.slice(-2).map((e) => e.event)).toEqual(["done", "filled"]);
  });

  it.each([
    [
      "a Session it cannot see",
      `/api/sessions/${uniqueSessionId()}/history?tailLimit=1`,
      "session_not_found",
    ],
    ["a malformed query", `/api/sessions/${SID}/history?tailLimit=1&before=1:0`, "bad_request"],
  ])("answers %s with one terminal error event", async (_name, path, code) => {
    const events = await readAll(path);
    expect(events.map((e) => e.event)).toEqual(["error"]);
    expect((JSON.parse(events[0]!.data) as { code: string }).code).toBe(code);
  });

  it("tells an admin the Session's Project refuses that it is refused, not that the Session is gone", async () => {
    const access = t.deps.access as unknown as Record<string, unknown>;
    const had = Object.prototype.hasOwnProperty.call(access, "requireProjectAccess");
    const original = access.requireProjectAccess;
    access.requireProjectAccess = () => {
      throw new Error("refused");
    };
    try {
      const events = await readAll(`/api/sessions/${SID}/history?tailLimit=1`);
      expect(events.map((e) => e.event)).toEqual(["error"]);
      expect((JSON.parse(events[0]!.data) as { code: string }).code).toBe("session_forbidden");
    } finally {
      if (had) access.requireProjectAccess = original;
      else delete access.requireProjectAccess;
    }
  });
});

describe("the windows held for a re-issued stream", () => {
  const windowOf = (windowId: string, bytes: number): HistoryWindow => ({
    windowId,
    text: "",
    page: { windowId, count: 0, bytes, serverNowMs: null },
  });
  const owner = (userId: string) => ({ sessionId: SID, userId, query: "q" });

  it("keeps a few per reader and a bounded number of bytes in all, the oldest let go first", () => {
    const held = new HeldWindows(() => 0);
    for (let i = 0; i < HELD_WINDOWS_PER_USER + 2; i++)
      held.hold(windowOf(`a${i}`, 10), owner("ann"));
    expect(held.find("a0", owner("ann"))).toBeNull();
    expect(held.find("a1", owner("ann"))).toBeNull();
    expect(held.find(`a${HELD_WINDOWS_PER_USER + 1}`, owner("ann"))).not.toBeNull();
    // Another reader's windows are not counted against the first one's.
    held.hold(windowOf("b0", 10), owner("bob"));
    expect(held.find("a2", owner("ann"))).not.toBeNull();
    expect(held.find("b0", owner("ann"))).toBeNull();

    // Bytes: a reader's big windows push out its older ones; one too big is not held at all.
    held.hold(windowOf("big1", HELD_BYTES_PER_USER - 5), owner("bob"));
    expect(held.find("b0", owner("bob"))).toBeNull();
    held.hold(windowOf("huge", HELD_BYTES_PER_USER + 1), owner("bob"));
    expect(held.find("huge", owner("bob"))).toBeNull();
    expect(held.find("big1", owner("bob"))).not.toBeNull();
  });

  it("lets go of the oldest windows when all readers together pass the byte bound", () => {
    const held = new HeldWindows(() => 0);
    // Five readers, each within its own bound, together just past the bound for all.
    const per = Math.floor(HELD_BYTES / 5) + 1;
    for (const user of ["u1", "u2", "u3", "u4", "u5"]) held.hold(windowOf(user, per), owner(user));
    expect(held.find("u1", owner("u1"))).toBeNull();
    expect(held.find("u2", owner("u2"))).not.toBeNull();
    expect(held.find("u5", owner("u5"))).not.toBeNull();
  });
});
