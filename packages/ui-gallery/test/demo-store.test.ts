/**
 * The demo store: the same world in both languages, models the built-in catalog knows, the
 * running states the gallery exists to show, and the scripts that move them — a sent message
 * streams a reply and settles, an approval decides the pending command, an abort stops a run.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "@prismshadow/penguin-server/api";
import {
  parseBackgroundTaskDoneMessage,
  parseHandoffMessage,
  parseOrgTriggerMessage,
  parseScheduledMessage,
  parseSkillsMessage,
} from "@prismshadow/penguin-core/markers";
import { catalogEntryFor } from "../../core/dist/state/model-catalog.js";
import { catalogDelta } from "../../web/src/features/models/catalog-sync";
import { splitAttachments } from "../../web/src/lib/attachments";
import {
  createStreamModel,
  finalizeHistory,
  pushMessages,
} from "../../web/src/lib/omni/stream-model";
import { buildFixtures } from "../src/app/mock/fixtures";
import { ALL_SESSION_IDS, IDS } from "../src/app/mock/ids";
import { REPLY_CLOSE_MS, REPLY_HOLD_MS, REPLY_LEAD_MS, resetStore } from "../src/app/mock/store";
import { scriptDuration, streamScript } from "../src/app/mock/stream-script";
import { streamingAnswer, TOOL_CALL_IDS } from "../src/app/mock/transcripts";
import { payloadOf } from "../src/app/mock/types";
import type { OmniMessage, StreamHandlers } from "../src/app/mock/types";

const NOW = Date.parse("2026-09-29T08:00:00Z");

/** The dataset's shape with every string and number reduced to its type (a file's size follows its text), so the two languages compare. */
function shape(value: unknown): unknown {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) return value.map(shape);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, shape(v)]),
    );
  }
  return value;
}

/** A message's payload type, the session_meta record reading as its own kind. */
const typeOf = (m: OmniMessage): string => payloadOf(m)?.type ?? "session_meta";

/** The text deltas among `messages`, in order. */
const textDeltas = (messages: OmniMessage[]): string[] =>
  messages.flatMap((m) => {
    const p = payloadOf(m);
    return p?.type === "partial_text" && p.event_type === "delta" ? [p.text] : [];
  });

/** A subscriber that keeps what it is sent. */
function collector(): StreamHandlers & { messages: OmniMessage[]; events: ServerEvent[] } {
  const messages: OmniMessage[] = [];
  const events: ServerEvent[] = [];
  return {
    messages,
    events,
    onOmniMessage: (msg) => messages.push(msg),
    onServerEvent: (ev) => events.push(ev),
  };
}

describe("the fixtures", () => {
  it("hold the same structure and the same ids in both languages", () => {
    const en = buildFixtures("en", NOW);
    const zh = buildFixtures("zh", NOW);
    expect(shape({ ...en, lang: "x" })).toEqual(shape({ ...zh, lang: "x" }));
    expect(en.sessions.map((s) => s.sessionId)).toEqual(zh.sessions.map((s) => s.sessionId));
    expect(en.agents.map((a) => a.agentId)).toEqual(zh.agents.map((a) => a.agentId));
    expect(en.benchmarks.map((b) => b.id)).toEqual(zh.benchmarks.map((b) => b.id));
    // Prose in the language it claims.
    const han = /[一-鿿]/;
    expect(han.test(zh.agents[0]!.name!)).toBe(true);
    expect(han.test(en.agents[0]!.name!)).toBe(false);
  });

  it("seed every Session id the ids module lists, and no other", () => {
    const f = buildFixtures("en", NOW);
    expect(f.sessions.map((s) => s.sessionId).sort()).toEqual([...ALL_SESSION_IDS].sort());
    expect(
      f.sessions
        .filter((s) => s.status === "running")
        .map((s) => s.sessionId)
        .sort(),
    ).toEqual(
      [
        IDS.sessions.approval,
        IDS.sessions.runningTool,
        IDS.sessions.thinking,
        IDS.sessions.streaming,
      ].sort(),
    );
  });

  it("carry the whole built-in catalog, settled: the app's sync check finds nothing to add or update", () => {
    const f = buildFixtures("en", NOW);
    for (const m of f.models.models) {
      if (m.provider === "custom") continue;
      expect(catalogEntryFor(m.provider, m.modelId), `${m.provider}/${m.modelId}`).toBeDefined();
    }
    expect(f.models.models.length).toBeGreaterThan(100);
    expect(catalogDelta(f.models.models)).toEqual({ added: 0, updated: 0, refs: [] });
    expect(f.models.defaultModel).toEqual({ provider: "deepseek", modelId: "deepseek-flash" });
    expect(f.models.models.filter((m) => m.isDefault).map((m) => m.modelId)).toEqual([
      "deepseek-flash",
    ]);
    for (const s of f.sessions)
      expect(f.models.models.some((m) => m.modelId === s.modelId)).toBe(true);
  });

  it("carry thirty days of usage in both Agents' names", () => {
    const f = buildFixtures("en", NOW);
    expect(new Set(f.usage.map((d) => d.date)).size).toBe(30);
    expect(new Set(f.usage.map((d) => d.agentId))).toEqual(
      new Set([IDS.agents.docs, IDS.agents.notes]),
    );
  });
});

describe("the running states", () => {
  it("a tool call executing: its call is in the history, its output is not, and the Session runs", () => {
    const store = resetStore({ lang: "en", signedIn: true, now: NOW });
    const transcript = store.transcript(IDS.sessions.runningTool)!;
    const calls = transcript.history.filter((m) => typeOf(m) === "tool_call");
    const outputs = transcript.history.filter((m) => typeOf(m) === "tool_call_output");
    expect(calls.length).toBe(outputs.length + 1);
    expect(transcript.running).toBe(true);
    expect(store.liveTail(IDS.sessions.runningTool)).toEqual({ cursor: "g1-0", fragments: [] });
  });

  it("thinking mid-stream: the live tail carries the open fragment, and the stream keeps adding to it", () => {
    vi.useFakeTimers();
    const store = resetStore({ lang: "zh", signedIn: true, now: NOW });
    const tail = store.liveTail(IDS.sessions.thinking)!;
    expect(tail.fragments).toHaveLength(1);
    expect(tail.fragments[0]!.payload).toMatchObject({
      type: "partial_thinking",
      event_type: "start",
    });
    const sub = collector();
    store.channel(IDS.sessions.thinking)!.subscribe(sub);
    store.onSubscribe(IDS.sessions.thinking, sub);
    expect(sub.events[0]).toEqual({ type: "task_state", state: "running" });
    vi.advanceTimersByTime(5000);
    expect(
      sub.messages.filter((m) => typeOf(m) === "partial_thinking").length,
    ).toBeGreaterThanOrEqual(3);
    const grown = store.liveTail(IDS.sessions.thinking)!;
    const before = (tail.fragments[0]!.payload as { thinking: string }).thinking;
    const after = (grown.fragments[0]!.payload as { thinking: string }).thinking;
    expect(after.length).toBeGreaterThan(before.length);
    expect(grown.cursor).not.toBe(tail.cursor);
  });

  it("a reply streaming on a loop: bursty deltas, the complete answer, then a rewind, a resync and the next round", () => {
    vi.useFakeTimers();
    const store = resetStore({ lang: "zh", signedIn: true, now: NOW });
    const id = IDS.sessions.streaming;
    const base = store.transcript(id)!.history.length;
    const answer = streamingAnswer("zh");
    const sub = collector();
    store.channel(id)!.subscribe(sub);
    store.onSubscribe(id, sub);
    // A second subscription (a remount) joins the running loop rather than starting another.
    store.onSubscribe(id, sub);
    expect(sub.events[0]).toEqual({ type: "task_state", state: "running" });

    // Mid-round, the live tail carries the open fragment with exactly what has streamed.
    vi.advanceTimersByTime(REPLY_LEAD_MS + 1500);
    const streamed = textDeltas(sub.messages).join("");
    expect(streamed.length).toBeGreaterThan(0);
    expect(answer.startsWith(streamed)).toBe(true);
    expect(store.liveTail(id)!.fragments.at(-1)!.payload).toEqual({
      type: "partial_text",
      role: "assistant",
      event_type: "start",
      text: streamed,
    });

    // The round closes with the complete answer in the history, cut as the first seed's script.
    const round = REPLY_LEAD_MS + scriptDuration(streamScript(answer, 1)) + REPLY_CLOSE_MS;
    vi.advanceTimersByTime(round - (REPLY_LEAD_MS + 1500));
    expect(textDeltas(sub.messages)).toEqual(streamScript(answer, 1).map((c) => c.text));
    expect(store.transcript(id)!.history.length).toBe(base + 1);
    expect(store.transcript(id)!.history.at(-1)!.payload).toMatchObject({ text: answer });
    expect(store.liveTail(id)!.fragments).toEqual([]);

    // After the hold it is rewound out of the history, the page is told to refetch, and the next
    // round opens a fresh fragment.
    vi.advanceTimersByTime(REPLY_HOLD_MS);
    expect(store.transcript(id)!.history.length).toBe(base);
    expect(sub.events.at(-1)).toEqual({ type: "resync_required" });
    vi.advanceTimersByTime(REPLY_LEAD_MS);
    const starts = sub.messages.filter((m) => {
      const p = payloadOf(m);
      return p?.type === "partial_text" && p.event_type === "start";
    });
    expect(starts).toHaveLength(2);
    expect(store.session(id)?.status).toBe("running");
  });

  it("an approval pending: the subscription is told, and a decision runs the command and settles", () => {
    vi.useFakeTimers();
    const store = resetStore({ lang: "en", signedIn: true, now: NOW });
    const sub = collector();
    store.channel(IDS.sessions.approval)!.subscribe(sub);
    store.onSubscribe(IDS.sessions.approval, sub);
    expect(sub.events.map((e) => e.type)).toEqual(["task_state", "approval_request"]);
    expect(store.decide(IDS.sessions.approval, "nope", "allow")).toBe(false);
    expect(store.decide(IDS.sessions.approval, TOOL_CALL_IDS.pendingPublish, "allow")).toBe(true);
    expect(sub.messages.at(-1)?.payload).toMatchObject({
      type: "approval_decision",
      decision: "allow",
    });
    vi.advanceTimersByTime(4000);
    const types = sub.messages.map(typeOf);
    expect(types).toContain("tool_call_output");
    expect(types).toContain("text");
    expect(sub.events.at(-1)).toEqual({ type: "task_state", state: "idle" });
    expect(store.session(IDS.sessions.approval)?.status).toBe("idle");
    expect(store.session(IDS.sessions.approval)?.pendingApprovalCount).toBe(0);
  });
});

describe("the harness Session", () => {
  it("reads, through the chat's own stream model, as every row the harness writes", () => {
    const store = resetStore({ lang: "zh", signedIn: true, now: NOW });
    const model = createStreamModel();
    pushMessages(model, store.transcript(IDS.sessions.harness)!.history, NOW);
    finalizeHistory(model);
    const kinds = model.items.map((item) => item.kind);
    for (const kind of [
      "mcp_connect",
      "background_notice",
      "reconnect",
      "abort",
      "llm_error",
      "compaction",
      "model_change",
      "user_steering",
      "task_stats",
    ]) {
      expect(kinds, kind).toContain(kind);
    }
    const sent = model.items.flatMap((item) => (item.kind === "user_text" ? [item] : []));
    expect(parseHandoffMessage(sent[0]!.text)?.sessionId).toBe(IDS.sessions.notes[0]);
    const prompt = parseSkillsMessage(sent[1]!.text)!;
    expect(prompt.skills).toEqual(["claude-code-expert", "docs-sync"]);
    expect(splitAttachments(prompt.rest).files).toHaveLength(1);
    expect(sent.filter((t) => t.sender === "harness")).toHaveLength(3);
    const done = sent.map((t) => parseBackgroundTaskDoneMessage(t.text)?.done.status);
    expect(done).toContain("completed");
    const fired = sent.map((t) => parseScheduledMessage(t.text)?.origin.name);
    expect(fired).toContain("weekly-link-check");
    const mcp = model.items.find((item) => item.kind === "mcp_connect");
    expect(mcp?.kind === "mcp_connect" && mcp.failed).toEqual(["docs-search"]);
    const compaction = model.items.find((item) => item.kind === "compaction");
    expect(compaction).toMatchObject({ status: "completed", mode: "summarize" });
    expect(compaction?.kind === "compaction" && compaction.thinkingText).toBeTruthy();
    expect(compaction?.kind === "compaction" && compaction.summaryText).toBeTruthy();
    expect(kinds.at(-1)).toBe("task_stats");

    // The goal banner: a fresh subscription is told the goal run and its outcome.
    const sub = collector();
    store.onSubscribe(IDS.sessions.harness, sub);
    expect(sub.events.map((e) => e.type)).toEqual(["task_state", "goal_started", "goal_finished"]);
  });

  it("opens the organization's desk Session with its trigger block", () => {
    const store = resetStore({ lang: "en", signedIn: true, now: NOW });
    const history = store.transcript(IDS.sessions.orgDesk)!.history;
    const first = history.find((m) => payloadOf(m)?.type === "text")!;
    const text = (payloadOf(first) as { text: string }).text;
    expect(parseOrgTriggerMessage(text)?.origin.kind).toBe("event");
    expect(store.session(IDS.sessions.orgDesk)?.client).toBe("org");
  });
});

describe("a sent message", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("streams thinking, a tool call with its output and the answer, then settles with a title", () => {
    vi.useFakeTimers();
    const store = resetStore({ lang: "en", signedIn: true, now: NOW });
    const user = collector();
    store.userChannel.subscribe(user);
    const row = store.createSession(IDS.agents.docs, {});
    expect(user.events.at(-1)).toMatchObject({ type: "session_created", sessionId: row.sessionId });
    const sub = collector();
    store.channel(row.sessionId)!.subscribe(sub);
    expect(store.startTask(row.sessionId, "What does the corpus say?")).toBe(true);
    expect(store.startTask(row.sessionId, "again")).toBe(false);
    expect(sub.events[0]).toEqual({ type: "task_state", state: "running" });
    expect(sub.messages[0]?.payload).toMatchObject({ type: "text", role: "user" });
    vi.advanceTimersByTime(30_000);
    const types = sub.messages.map(typeOf);
    for (const expected of [
      "partial_thinking",
      "thinking",
      "partial_tool_call",
      "tool_call",
      "tool_call_output",
      "partial_text",
      "text",
      "token_usage",
      "request_end",
    ]) {
      expect(types, expected).toContain(expected);
    }
    // The complete messages are history; the fragments never are.
    const history = store.transcript(row.sessionId)!.history.map(typeOf);
    expect(history.some((t) => t.startsWith("partial_"))).toBe(false);
    expect(history).toContain("text");
    expect(sub.events.at(-1)).toEqual({ type: "task_state", state: "idle" });
    expect(store.session(row.sessionId)?.title).toBeDefined();
    expect(user.events.some((e) => e.type === "session_title")).toBe(true);
  });

  it("stops on abort, leaving the Session idle with an abort event in its history", () => {
    vi.useFakeTimers();
    const store = resetStore({ lang: "en", signedIn: true, now: NOW });
    const row = store.createSession(IDS.agents.docs, {});
    const sub = collector();
    store.channel(row.sessionId)!.subscribe(sub);
    store.startTask(row.sessionId, "hi");
    vi.advanceTimersByTime(1000);
    store.abort(row.sessionId);
    const count = sub.messages.length;
    vi.advanceTimersByTime(30_000);
    expect(sub.messages.length).toBe(count);
    expect(store.session(row.sessionId)?.status).toBe("idle");
    const last = store.transcript(row.sessionId)!.history.at(-1);
    expect(last && typeOf(last)).toBe("abort");
  });
});
