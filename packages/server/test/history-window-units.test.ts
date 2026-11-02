/**
 * How many Tasks a history window holds (`page.units`), counted where the window is cut — the
 * count a client pages by until N Tasks are on screen, so it must be the one `tailLimit` and
 * `limit` count, not a second reading of the records.
 *
 * Fixture: a prompt sent with an image, a plain prompt, a compaction (its own prompt and summary
 * inside the span, a summary opening the next file), then one more prompt.
 *
 * - Given a window over the whole history, it holds three Tasks: the image rides with its prompt,
 *   and nothing of the compaction opens one.
 * - Given windows of two Tasks and then of the rest, each says how many it holds, and asking for
 *   that many again from the same cursor gives back the same window.
 * - Given a byte budget that cuts the window to its newest Task, it says one.
 */
import fs from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assistantText,
  compactionBegin,
  compactionEnd,
  imageUrlMessage,
  requestBegin,
  requestEnd,
  sessionMeta,
  tokenUsage,
  userText,
} from "@prismshadow/penguin-core";
import type { AmspRecord, TokenCounts } from "@prismshadow/penguin-core";
import { decodeCursor } from "../src/services/message-window.js";
import type { TraceService } from "../src/services/trace-service.js";
import { makeTempRoot, makeTraceHarness, writeTraceFile } from "./helpers.js";

const P = "project-u";
const A = "agent-u";
const S = "session-2026-07-21-10-00-00-aabb0101";

const counts = (total: number): TokenCounts => ({
  cache_read: 0,
  cache_write: 0,
  output: total,
  total,
});
const meta = () =>
  sessionMeta({
    session_id: S,
    model_id: "m1",
    provider: "custom",
    model_context_window: 1000,
    system_prompt: "sp",
    agent_state: "/tmp/a",
    workspace: "/tmp/w",
    source: "user",
  });
const answered = (text: string): AmspRecord[] => [
  requestBegin(),
  assistantText(text),
  requestEnd("completed"),
  tokenUsage(counts(100), counts(10)),
];
const prompts = (records: AmspRecord[]) =>
  records
    .filter(
      (m) =>
        (m.payload as { type?: string; role?: string }).role === "user" &&
        (m.payload as { type?: string }).type === "text",
    )
    .map((m) => (m.payload as { text: string }).text)
    .filter((t) => !t.startsWith("[context_summary]") && t !== "COMPACT NOW");

describe("the Tasks a window holds", () => {
  let root: string;
  let harness: ReturnType<typeof makeTraceHarness>;
  let svc: TraceService;

  beforeAll(async () => {
    root = await makeTempRoot();
    harness = makeTraceHarness(root);
    svc = harness.service;
    await writeTraceFile(root, P, A, "2026-07-21", S, 1, [
      meta(),
      userText("look at this"),
      imageUrlMessage("data:image/png;base64,AAAA"),
      ...answered("a picture"),
      userText("and plainly?"),
      ...answered("plainly"),
      compactionBegin({ reason: "manual", mode: "summarize", context: 900, turns: 2 }),
      userText("COMPACT NOW"),
      requestBegin(),
      assistantText("[summary]s[/summary]"),
      requestEnd("completed"),
      compactionEnd({ reason: "manual", mode: "summarize", status: "completed" }),
    ]);
    await writeTraceFile(root, P, A, "2026-07-21", S, 2, [
      meta(),
      userText("[context_summary]\ns\n[/context_summary]"),
      userText("one more"),
      ...answered("done"),
    ]);
  });
  afterAll(async () => {
    harness.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("a window over the whole history holds three Tasks: the image rides with its prompt, the compaction opens none", async () => {
    const all = await svc.readMessagesPage(P, A, S, { kind: "tail", limit: 20 });
    expect(all.before).toBeUndefined();
    expect(prompts(all.messages)).toEqual(["look at this", "and plainly?", "one more"]);
    expect(all.units).toBe(3);
  });

  it("each window says how many Tasks it holds, and asking for that many gives the same window", async () => {
    const tail = await svc.readMessagesPage(P, A, S, { kind: "tail", limit: 2 });
    expect(tail.units).toBe(2);
    expect(prompts(tail.messages)).toEqual(["and plainly?", "one more"]);
    const older = await svc.readMessagesPage(P, A, S, {
      kind: "before",
      cursor: decodeCursor(tail.before!)!,
      limit: 20,
    });
    expect(older.units).toBe(1);
    expect(older.before).toBeUndefined();
    // `units` is in the currency `limit` is asked in: that many from the same cursor is the same window.
    const again = await svc.readMessagesPage(P, A, S, {
      kind: "before",
      cursor: decodeCursor(tail.before!)!,
      limit: older.units,
    });
    expect(again.messages).toEqual(older.messages);
  });

  it("a budget that cuts the window to its newest Task says one", async () => {
    const cut = await svc.readMessagesPage(P, A, S, { kind: "tail", limit: 20, budget: 1 });
    expect(prompts(cut.messages)).toEqual(["one more"]);
    expect(cut.units).toBe(1);
  });
});
