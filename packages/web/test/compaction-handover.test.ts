/**
 * A compaction's hand-over, as the chat draws it from the Trace: the records through the stream
 * model (lib/amsp/stream-model.ts) into the transcript's item dispatch
 * (features/chat/message-item.tsx) and the compaction row's hand-over section
 * (features/chat/compaction-handover.tsx).
 *
 * - A compaction with no model switch that completed without a full summary settles to 压缩完毕
 *   with the degraded mark. Its folded hand-over section gives the mark's reason, the Trace file
 *   its hand-off note names, and that note, its tags stripped. A compaction that wrote a full
 *   summary keeps the summary as its result and has no hand-over.
 *
 * - A switch whose current model could not be reached settles to 压缩完毕 with the degraded mark,
 *   which says no summary was asked for and that the next context opens with the hand-over. The
 *   row folds a body that gives that reason, the Trace file, and the note the next context opens
 *   with, its tags stripped. The divider below it still names both models and says it was handed
 *   over by Trace, with nothing to hover.
 * - A switch whose compaction gave no summary keeps a single row, the compaction's own: its mark
 *   and its hand-over section both give the compaction's cause.
 * - A switch that summarized is unchanged: a plain 压缩完毕 row, and a divider that names both
 *   models and no hand-over. All of it in both languages.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assistantText,
  compactionBegin,
  compactionEnd,
  requestBegin,
  requestEnd,
  sessionMeta,
  sessionUpdate,
  taskBegin,
  taskEnd,
  toolListReady,
  userText,
} from "@prismshadow/amsp";
import type { AmspRecord } from "@prismshadow/amsp";
import {
  buildContextSummaryText,
  buildModelSwitchMessage,
  markerBlock,
  MARKER_TAGS,
} from "@prismshadow/amsp/markers";
import { defaultSystemConfig } from "@prismshadow/penguin-core";
import { CompactionHandoverBody } from "../src/features/chat/compaction-handover";
import { MessageItem } from "../src/features/chat/message-item";
import type { StreamRenderContext } from "../src/features/chat/message-stream";
import { compactionResultVisible } from "../src/lib/amsp/compaction-summary";
import {
  createStreamModel,
  finalizeHistory,
  pushMessages,
  type ChatItem,
  type CompactionItem,
} from "../src/lib/amsp/stream-model";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { LocaleProvider } from "../src/state/locale";
import { stubLocalStorage } from "./helpers/storage";

const A = { provider: "deepseek", modelId: "deepseek-v4-flash" };
const B = { provider: "deepseek", modelId: "deepseek-flash" };
const TRACE = "/data/agents/a1/traces/2026-11-26/s1_20261126T080000Z_001.jsonl";
const REFUSAL = "400 prompt is too long: 140000 tokens > 131072 maximum";

const metaOn = (model: typeof A): AmspRecord =>
  sessionMeta({
    session_id: "s1",
    provider: model.provider,
    model_id: model.modelId,
    model_context_window: 131072,
    system_prompt: "",
    agent_state: "/a",
    workspace: "/w",
    source: "user",
  });

/** The note a switch away from A opens the next context with when it cannot summarize. */
const handoff = (): AmspRecord =>
  userText(
    buildModelSwitchMessage({
      sessionId: "s1",
      tracePath: TRACE,
      workspace: "/w",
      prevProvider: A.provider,
      prevModelId: A.modelId,
    }),
  );

/** A Session on A that answered once. */
const answered = (): AmspRecord[] => [
  metaOn(A),
  taskBegin(),
  userText("fix the three links in the draft"),
  requestBegin(),
  assistantText("two fixed, one left"),
  requestEnd("completed"),
  taskEnd(),
];

/** The records after it, then the next file's head on B, for each way the switch can go. */
const SWITCHES = {
  // A is gone from the configuration: no compaction request, no compaction pair.
  unreachable: [sessionUpdate({ provider: B.provider, model_id: B.modelId })],
  // A was asked and refused: the compaction completes with the error pair.
  refused: [
    compactionBegin({ reason: "manual", mode: "summarize", context: 120_000, turns: 1 }),
    compactionEnd({
      reason: "manual",
      mode: "summarize",
      status: "completed",
      attempt: 1,
      errorCode: "rejected",
      errorMessage: REFUSAL,
    }),
    sessionUpdate({ provider: B.provider, model_id: B.modelId }),
  ],
  summarized: [
    compactionBegin({ reason: "manual", mode: "summarize", context: 20_000, turns: 1 }),
    compactionEnd({ reason: "manual", mode: "summarize", status: "completed", attempt: 1 }),
    sessionUpdate({ provider: B.provider, model_id: B.modelId }),
  ],
} as const;

/** The Trace of the whole switch, read back as the chat rebuilds it. */
function transcript(way: keyof typeof SWITCHES): ChatItem[] {
  const opening =
    way === "summarized"
      ? userText(buildContextSummaryText("the draft's path and the link still broken", TRACE))
      : handoff();
  const model = createStreamModel();
  pushMessages(model, [...answered(), ...SWITCHES[way], metaOn(B), toolListReady([]), opening]);
  finalizeHistory(model);
  return model.items;
}

const UNUSABLE = "the response contained no usable summary";

/** The hand-off note a compaction with no summary opens the next context with: core's default template, filled. */
const HANDOFF_NOTE = buildContextSummaryText(
  defaultSystemConfig()
    .compaction!.handoff_note!.replace("{{ERROR}}", `[request_error] malformed: ${UNUSABLE}`)
    .replace("{{USER_MESSAGES}}", "- fix the three links in the draft")
    .replace("{{LAST_TURN}}", "two fixed, one left")
    .replace("{{TRACE_PATH}}", TRACE),
);

/** A Session on A that answered once, compacted on its own, and went on in the next file. */
function compactedTranscript(way: "degraded" | "summarized"): ChatItem[] {
  const span =
    way === "degraded"
      ? [
          compactionEnd({
            reason: "manual",
            mode: "summarize",
            status: "completed",
            attempt: 3,
            errorCode: "malformed",
            errorMessage: UNUSABLE,
          }),
        ]
      : [
          requestBegin(),
          assistantText(markerBlock(MARKER_TAGS.summary, "the draft's path and the link left")),
          requestEnd("completed"),
          compactionEnd({ reason: "manual", mode: "summarize", status: "completed", attempt: 1 }),
        ];
  const opening =
    way === "degraded"
      ? HANDOFF_NOTE
      : buildContextSummaryText("the draft's path and the link left", TRACE);
  const model = createStreamModel();
  pushMessages(model, [
    ...answered(),
    compactionBegin({ reason: "manual", mode: "summarize", context: 60_000, turns: 1 }),
    ...span,
    taskBegin(),
    metaOn(A),
    toolListReady([]),
    userText(opening),
    userText("now the last link"),
    requestBegin(),
    assistantText("fixed"),
    requestEnd("completed"),
    taskEnd(),
  ]);
  finalizeHistory(model);
  return model.items;
}

const ctx: StreamRenderContext = {
  pendingApprovals: new Map(),
  onApprove: async () => {},
  origin: [],
  taskRunning: false,
};

const draw = (item: ChatItem): string =>
  renderToStaticMarkup(
    createElement(LocaleProvider, null, createElement(MessageItem, { item, ctx })),
  );

/** The switch's two rows, in transcript order. */
function switchRows(items: ChatItem[]): { row: CompactionItem; divider: ChatItem } {
  const rows = items.filter((i): i is CompactionItem => i.kind === "compaction");
  expect(rows).toHaveLength(1);
  const at = items.indexOf(rows[0]!);
  const divider = items[at + 1]!;
  expect(divider.kind).toBe("model_change");
  return { row: rows[0]!, divider };
}

/** The degraded mark's accessible name, one entry per line (its tooltip says the same); null without one. */
function markLines(html: string): string[] | null {
  const found = /role="img" aria-label="([^"]*)" data-tooltip="([^"]*)"/.exec(html);
  if (found === null) return null;
  expect(found[2]).toBe(found[1]);
  return text(found[1]!).split("\n");
}

/** What the row's hand-over section holds once the reader opens it. */
const openedBody = (row: CompactionItem): string =>
  text(
    renderToStaticMarkup(
      createElement(CompactionHandoverBody, { item: row, handover: row.handover! }),
    ),
  );

/** Static markup's text, entities read back. */
const text = (html: string): string =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");

describe.each([
  ["zh", zh],
  ["en", en],
] as const)("a model switch handed over by Trace (%s)", (lang, dict) => {
  beforeEach(() => {
    stubLocalStorage().setItem("penguin.lang", lang);
    setActiveStrings(dict);
  });
  afterEach(() => setActiveStrings(zh));

  it("when the current model could not be reached, settles to Compacted with the degraded mark, folds the reason, the Trace file and the note, and the divider below still names both models", () => {
    const { row, divider } = switchRows(transcript("unreachable"));
    const html = draw(row);
    expect(html).toContain(dict.chat.compactionDone("summarize"));
    // The row folds: a head that opens, closed.
    expect(html).toContain('aria-expanded="false"');
    const lines = markLines(html)!;
    // No summary was asked for, and the next context opens with the hand-over; nothing to correct.
    expect(lines).toHaveLength(2);
    expect(lines[0]!.toLowerCase()).toBe(dict.chat.compactionHandoverUnasked.toLowerCase());
    expect(lines[1]).toBe(markLines(draw(switchRows(transcript("refused")).row))![1]);

    const body = openedBody(row);
    for (const line of lines) expect(body).toContain(line);
    expect(body).toContain(dict.chat.compactionHandoverTrace(TRACE));
    // The note as the next context opens with it, field lines included, without its tags.
    for (const field of [
      "session: s1",
      `trace: ${TRACE}`,
      "workspace: /w",
      `previous_model: ${A.modelId}`,
      `previous_provider: ${A.provider}`,
    ]) {
      expect(body).toContain(field);
    }
    expect(body).toContain("The user switched models");
    expect(body).not.toContain("model_switch_from");

    const line = draw(divider);
    expect(text(line)).toBe(dict.chat.modelChangedByTrace(A.modelId, B.modelId));
    expect(line).not.toContain("data-tooltip");
  });

  it("when the compaction gave no summary, keeps the compaction's own row, whose mark and hand-over section give its cause", () => {
    const { row, divider } = switchRows(transcript("refused"));
    const html = draw(row);
    expect(html).toContain(dict.chat.compactionDone("summarize"));
    const lines = markLines(html)!;
    // The cause and the provider's own words lead; short of room, the mark says what to correct.
    expect(lines[0]!.endsWith(REFUSAL)).toBe(true);
    expect(lines).toHaveLength(3);
    const body = openedBody(row);
    for (const line of lines) expect(body).toContain(line);
    expect(body).toContain(dict.chat.compactionHandoverTrace(TRACE));
    expect(text(draw(divider))).toBe(dict.chat.modelChangedByTrace(A.modelId, B.modelId));
  });

  it("when the switch summarized, draws the plain Compacted row and a divider with no hand-over", () => {
    const { row, divider } = switchRows(transcript("summarized"));
    expect(row.handover).toBeUndefined();
    const html = draw(row);
    expect(html).toContain(dict.chat.compactionDone("summarize"));
    expect(markLines(html)).toBeNull();
    expect(text(draw(divider))).toBe(dict.chat.modelChanged(A.modelId, B.modelId));
  });
});

describe.each([
  ["zh", zh],
  ["en", en],
] as const)("a compaction with no model switch (%s)", (lang, dict) => {
  beforeEach(() => {
    stubLocalStorage().setItem("penguin.lang", lang);
    setActiveStrings(dict);
  });
  afterEach(() => setActiveStrings(zh));

  /** The transcript's one compaction row. */
  const onlyRow = (items: ChatItem[]): CompactionItem => {
    const rows = items.filter((i): i is CompactionItem => i.kind === "compaction");
    expect(rows).toHaveLength(1);
    expect(items.some((i) => i.kind === "model_change")).toBe(false);
    return rows[0]!;
  };

  it("that got no summary settles to Compacted with the degraded mark and folds the same hand-over section: the reason, the Trace file the note names, and the note", () => {
    const items = compactedTranscript("degraded");
    const row = onlyRow(items);
    // The note is no message of the person's.
    const said = items.flatMap((i) => (i.kind === "user_text" ? [i.text] : []));
    expect(said).toEqual(["fix the three links in the draft", "now the last link"]);
    const html = draw(row);
    expect(html).toContain(dict.chat.compactionDone("summarize"));
    expect(html).toContain('aria-expanded="false"');
    const lines = markLines(html)!;
    expect(lines[0]!.endsWith(UNUSABLE)).toBe(true);
    const body = openedBody(row);
    for (const line of lines) expect(body).toContain(line);
    expect(body).toContain(dict.chat.compactionHandoverTrace(TRACE));
    expect(body).toContain("No summary of the earlier conversation could be written");
    expect(body).toContain("two fixed, one left");
    expect(body).toContain("Carry on with the task from where it stopped.");
    expect(body).not.toContain("context_summary");
  });

  it("that wrote a full summary is unchanged: its result is the summary, with no hand-over and no degraded mark", () => {
    const row = onlyRow(compactedTranscript("summarized"));
    expect(row.handover).toBeUndefined();
    expect(compactionResultVisible(row)).toBe(true);
    const html = draw(row);
    expect(html).toContain(dict.chat.compactionDone("summarize"));
    expect(markLines(html)).toBeNull();
  });
});
