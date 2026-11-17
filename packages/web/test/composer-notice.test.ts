/**
 * Which attention notice the composer raises above its input (features/chat/composer-notice.ts),
 * fed the way the conversation page feeds it: the Session's items through
 * `refusalHandoffOccurrence`. One slot, one notice at a time.
 *
 * - Given the Session's latest compaction was forced by a refused request, the refusal notice
 *   takes the slot, over a small window too, the same live and rebuilt from history.
 * - Dismissing it puts that occurrence down: the small-window notice comes through, and the next
 *   refusal is raised again; a later compaction that ends otherwise takes it down by itself.
 * - With no refusal, the small-window notice is raised while the window is below the threshold,
 *   until dismissed for that Session and model.
 * - Off session state nothing is raised.
 */
import { describe, expect, it } from "vitest";
import {
  compactionBegin,
  compactionEnd,
  requestBegin,
  requestEnd,
  userText,
} from "@prismshadow/amsp";
import type { AmspRecord } from "@prismshadow/amsp";
import { composerNotice } from "../src/features/chat/composer-notice";
import { refusalHandoffOccurrence } from "../src/lib/amsp/compaction-summary";
import {
  createStreamModel,
  pushMessage,
  pushMessages,
  type StreamModel,
} from "../src/lib/amsp/stream-model";

const MODEL = { provider: "anthropic", modelId: "claude-sonnet-5" };
const REFUSAL = "400 prompt is too long: 16502 tokens > 16384 maximum";

/** Records stamped `sec` seconds into the day, so two refusals are two occurrences. */
const stamped = (sec: number, msg: AmspRecord): AmspRecord => ({
  ...msg,
  timestamp: new Date(Date.UTC(2026, 10, 12, 9, 0, sec)).toISOString(),
});

/** A request the provider refuses as sent, and the hand-off span that answers it. */
const refused = (sec: number): AmspRecord[] =>
  [
    requestBegin(),
    requestEnd("retryable", {
      errorCode: "rejected",
      errorMessage: REFUSAL,
      attempt: 2,
      retryInMs: 0,
    }),
    compactionBegin({ reason: "context", mode: "summarize", context: 16_100, turns: 9 }),
    compactionEnd({
      reason: "context",
      mode: "summarize",
      status: "completed",
      errorCode: "rejected",
      errorMessage: REFUSAL,
    }),
  ].map((msg) => stamped(sec, msg));

/** The notice the composer of Session `s1` raises over `model`, with these settings. */
const noticeFor = (
  model: StreamModel,
  dismissed: Set<string>,
  settings: { contextWindow?: number; compactionLimit?: number } = {},
) =>
  composerNotice({
    sessionId: "s1",
    model: MODEL,
    refusalHandoff: refusalHandoffOccurrence(model.items),
    contextWindow: settings.contextWindow,
    compactionLimit: settings.compactionLimit,
    dismissed,
  });

const SMALL_WINDOW = { contextWindow: 128_000, compactionLimit: 256_000 };

describe("the composer's attention notice", () => {
  it("is the refusal's, over a small window too, the same live and rebuilt from history", () => {
    const live = createStreamModel();
    const records = [stamped(0, userText("fix the links")), ...refused(10)];
    for (const msg of records) pushMessage(live, msg);
    const rebuilt = createStreamModel();
    pushMessages(rebuilt, records);
    for (const m of [live, rebuilt]) {
      expect(noticeFor(m, new Set())).toMatchObject({ kind: "refused" });
      expect(noticeFor(m, new Set(), SMALL_WINDOW)).toMatchObject({ kind: "refused" });
    }
    expect(noticeFor(rebuilt, new Set())).toEqual(noticeFor(live, new Set()));
  });

  it("once dismissed, lets the small-window notice through, and is raised again for the next refusal", () => {
    const m = createStreamModel();
    for (const msg of refused(10)) pushMessage(m, msg);
    const dismissed = new Set<string>();
    dismissed.add(noticeFor(m, dismissed)!.key);
    expect(noticeFor(m, dismissed)).toBeNull();
    expect(noticeFor(m, dismissed, SMALL_WINDOW)).toMatchObject({
      kind: "window",
      window: 128_000,
      threshold: 256_000,
    });
    for (const msg of refused(40)) pushMessage(m, msg);
    expect(noticeFor(m, dismissed)).toMatchObject({ kind: "refused" });
  });

  it("goes away when a later compaction ends any other way", () => {
    const m = createStreamModel();
    for (const msg of refused(10)) pushMessage(m, msg);
    pushMessage(
      m,
      compactionBegin({ reason: "manual", mode: "summarize", context: 900, turns: 9 }),
    );
    pushMessage(m, compactionEnd({ reason: "manual", mode: "summarize", status: "completed" }));
    expect(noticeFor(m, new Set())).toBeNull();
  });

  it("with no refusal, is the small-window notice while the window is below the threshold, until dismissed for that Session and model", () => {
    const m = createStreamModel();
    const roomy = { contextWindow: 1_000_000, compactionLimit: 256_000 };
    expect(noticeFor(m, new Set())).toBeNull();
    expect(noticeFor(m, new Set(), roomy)).toBeNull();
    const dismissed = new Set<string>();
    const raised = noticeFor(m, dismissed, SMALL_WINDOW)!;
    expect(raised).toMatchObject({ kind: "window" });
    dismissed.add(raised.key);
    expect(noticeFor(m, dismissed, SMALL_WINDOW)).toBeNull();
    // Another model in the same Session asks afresh.
    expect(
      composerNotice({
        sessionId: "s1",
        model: { provider: "anthropic", modelId: "claude-haiku-5" },
        refusalHandoff: null,
        ...SMALL_WINDOW,
        dismissed,
      }),
    ).toMatchObject({ kind: "window" });
  });

  it("is never raised off session state", () => {
    const m = createStreamModel();
    for (const msg of refused(10)) pushMessage(m, msg);
    expect(
      composerNotice({
        sessionId: undefined,
        model: MODEL,
        refusalHandoff: refusalHandoffOccurrence(m.items),
        ...SMALL_WINDOW,
        dismissed: new Set(),
      }),
    ).toBeNull();
  });
});
