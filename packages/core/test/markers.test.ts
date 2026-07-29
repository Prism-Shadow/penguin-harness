/**
 * Message-marker module tests (packages/core/src/omnimessage/markers): the canonical
 * `[tag]…[/tag]` producers, their inverse parsers, and the compatibility rule that every
 * parser also accepts the legacy `<tag>…</tag>` form (markers persist in Traces and in each
 * agent's stored compaction prompt) while producers only ever emit the square form.
 *
 * Behavior covered here used to live next to each call site — engine (`extractSummary`),
 * omnimessage (`userSteeringText`), web (`skill-use` / `agent-handoff`) — and moved with the
 * consolidation; the host-side tests keep covering the rendering/wiring around them.
 */
import { describe, expect, it } from "vitest";
import {
  MARKER_TAGS,
  TITLE_NOISE_TAGS,
  buildContextSummaryText,
  buildHandoffMessage,
  buildModelSwitchMessage,
  buildScheduledMessage,
  buildSkillsMessage,
  buildTurnAbortedBlock,
  buildTurnRetriedBlock,
  dualFormPatterns,
  extractSummary,
  markerBlock,
  matchDualForm,
  parseHandoffMessage,
  parseModelSwitchMessage,
  parseScheduledMessage,
  parseSkillsMessage,
  parseUserSteeringText,
  startsWithMarker,
  stripConversationMarkers,
  stripMarkerBlocks,
  transcribeToolCall,
  transcribeUserInput,
  unwrapSyntheticBlock,
  userSteeringText,
} from "../src/omnimessage/markers/index.js";

describe("marker block primitives", () => {
  it("builds the canonical paired form and matches both forms, square first", () => {
    expect(markerBlock("demo", "body")).toBe("[demo]\nbody\n[/demo]");
    const patterns = dualFormPatterns("demo", "([\\s\\S]*?)");
    expect(matchDualForm(patterns, "[demo]a[/demo]")?.[1]).toBe("a");
    expect(matchDualForm(patterns, "<demo>b</demo>")?.[1]).toBe("b");
    // A message carrying both resolves to the current form.
    expect(matchDualForm(patterns, "<demo>old</demo> [demo]new[/demo]")?.[1]).toBe("new");
    expect(matchDualForm(patterns, "no markers here")).toBeNull();
  });

  it("stripMarkerBlocks removes both forms plus stray tags, leaving ordinary text alone", () => {
    expect(stripMarkerBlocks("a[demo]x[/demo]b", "demo")).toBe("ab");
    expect(stripMarkerBlocks("a<demo>x</demo>b", "demo")).toBe("ab");
    expect(stripMarkerBlocks("a[/demo]b[demo]c", "demo")).toBe("abc");
    expect(stripMarkerBlocks("check the [config] section", "demo")).toBe(
      "check the [config] section",
    );
  });

  it("startsWithMarker detects a leading marker in either form only at the start", () => {
    expect(startsWithMarker("[context_summary]\nx", MARKER_TAGS.contextSummary)).toBe(true);
    expect(startsWithMarker("<context_summary>\nx", MARKER_TAGS.contextSummary)).toBe(true);
    expect(startsWithMarker("hi [context_summary]", MARKER_TAGS.contextSummary)).toBe(false);
  });

  it("the title-noise list is the message-prefix markers only (engine blocks are never title material)", () => {
    expect(TITLE_NOISE_TAGS).toEqual([
      MARKER_TAGS.useSkills,
      MARKER_TAGS.handoffFrom,
      MARKER_TAGS.scheduledTask,
      MARKER_TAGS.modelSwitchFrom,
      MARKER_TAGS.goal,
    ]);
  });
});

describe("stripConversationMarkers (whole-message title cleaning)", () => {
  it("removes machine marker blocks, keeps the human body", () => {
    // The skill-invocation block that wraps a first user message must not reach the title.
    expect(
      stripConversationMarkers(
        "[use_skills]\nskills: penguin-sdk, web-design\n[/use_skills]\nBuild a RAG app",
      ),
    ).toBe("Build a RAG app");
    // Handoff and scheduled-task markers are stripped too; ordinary bracketed text stays.
    expect(
      stripConversationMarkers("[handoff_from]data_analyst[/handoff_from]continue the analysis"),
    ).toBe("continue the analysis");
    // The /model switch origin block (the new session's first message) must not leak into the title either.
    expect(
      stripConversationMarkers(
        "[model_switch_from]\nsession: session-01\ntrace: /t/x_001.jsonl\n[/model_switch_from]\ncontinue this task",
      ),
    ).toBe("continue this task");
    expect(stripConversationMarkers("render a <div> element")).toBe("render a <div> element");
    expect(stripConversationMarkers("check the [config] section")).toBe(
      "check the [config] section",
    );
  });

  it("the old angle-bracket marker form is still stripped (material from old Traces)", () => {
    expect(
      stripConversationMarkers(
        "<use_skills>\nskills: web-design\n</use_skills>\nBuild a landing page",
      ),
    ).toBe("Build a landing page");
    expect(
      stripConversationMarkers("<handoff_from>data_analyst</handoff_from>continue the analysis"),
    ).toBe("continue the analysis");
    expect(
      stripConversationMarkers(
        "<model_switch_from>session: s1</model_switch_from>continue this task",
      ),
    ).toBe("continue this task");
  });
});

describe("engine blocks ([turn_aborted] / [turn_retried] / [context_summary] / [summary])", () => {
  it("wraps a compaction summary as the new context's first input", () => {
    expect(buildContextSummaryText("the gist")).toBe(
      "[context_summary]\nthe gist\n[/context_summary]",
    );
  });

  it("extractSummary accepts the current [summary] form, the legacy <summary> form, and tagless output", () => {
    // The legacy angle form must stay accepted indefinitely: compaction.prompt is persisted in
    // existing agents' system_config.yaml, so old agents keep instructing <summary> tags.
    expect(extractSummary("preamble [summary]new form[/summary] postscript")).toBe("new form");
    expect(extractSummary("preamble <summary>old form</summary> postscript")).toBe("old form");
    expect(extractSummary("  tagless output used verbatim  ")).toBe("tagless output used verbatim");
    // The current form wins when both appear (a model echoing the instruction).
    expect(extractSummary("[summary]a[/summary] <summary>b</summary>")).toBe("a");
  });

  it("turn blocks round-trip through unwrapSyntheticBlock, both forms, single-level", () => {
    const lines = [transcribeUserInput("go"), transcribeToolCall("read_file", "t1", "{}")];
    const aborted = buildTurnAbortedBlock(lines);
    expect(aborted.startsWith("[turn_aborted]\n")).toBe(true);
    expect(aborted).toContain('  [tool_call name="read_file" id="t1"]{}[/tool_call]');
    expect(unwrapSyntheticBlock(aborted)).toBe(lines.join("\n"));
    expect(unwrapSyntheticBlock(buildTurnRetriedBlock(["  [text]x[/text]"]))).toBe(
      "  [text]x[/text]",
    );
    // Legacy form (a Trace written before the format change) still unwraps.
    expect(unwrapSyntheticBlock("<turn_aborted>\n  <text>x</text>\n</turn_aborted>")).toBe(
      "  <text>x</text>",
    );
    // Mismatched tags and ordinary text are not blocks.
    expect(unwrapSyntheticBlock("[turn_aborted]\nx\n[/turn_retried]")).toBeNull();
    expect(unwrapSyntheticBlock("just a message")).toBeNull();
  });
});

describe("[user_steering] messages", () => {
  it("round-trips: a wrapped steering message parses back to the inner text (multiline kept)", () => {
    expect(userSteeringText("switch branch")).toBe(
      "[user_steering]\nswitch branch\n[/user_steering]",
    );
    expect(parseUserSteeringText(userSteeringText("switch branch"))).toBe("switch branch");
    expect(parseUserSteeringText(userSteeringText("line1\nline2"))).toBe("line1\nline2");
  });

  it("normal user text is left alone (including text merely mentioning the marker)", () => {
    expect(parseUserSteeringText("fix the bug")).toBeNull();
    expect(parseUserSteeringText("what does [user_steering] mean?")).toBeNull();
    // A block not spanning the whole message is not a steering message.
    expect(parseUserSteeringText("hi\n[user_steering]\nx\n[/user_steering]")).toBeNull();
    expect(parseUserSteeringText("")).toBeNull();
  });

  it("tolerates trailing whitespace after the closing tag", () => {
    expect(parseUserSteeringText("[user_steering]\nok\n[/user_steering]\n")).toBe("ok");
  });
});

describe("origin blocks ([use_skills] / [handoff_from] / [scheduled_task] / [model_switch_from])", () => {
  it("[use_skills]: builds a leading block + body and parses it back; an empty list adds nothing", () => {
    expect(buildSkillsMessage(["penguin-sdk"], "write me a demo")).toBe(
      "[use_skills]\nskills: penguin-sdk\n[/use_skills]\n\nwrite me a demo",
    );
    expect(buildSkillsMessage(["a", "b"], "x")).toBe(
      "[use_skills]\nskills: a, b\n[/use_skills]\n\nx",
    );
    expect(buildSkillsMessage(["solo"], "")).toBe("[use_skills]\nskills: solo\n[/use_skills]");
    expect(buildSkillsMessage([], "hello")).toBe("hello");
    expect(parseSkillsMessage(buildSkillsMessage(["a", "b"], "use them\nline2"))).toEqual({
      skills: ["a", "b"],
      rest: "use them\nline2",
    });
    // Only a block at the very start counts; an empty skills list is not a block.
    expect(parseSkillsMessage(`hi\n${buildSkillsMessage(["a"], "b")}`)).toBeNull();
    expect(parseSkillsMessage("[use_skills]\nskills: , ,\n[/use_skills]")).toBeNull();
    expect(parseSkillsMessage("plain text mentioning [use_skills] only")).toBeNull();
    // Legacy form (old Traces re-rendered).
    expect(
      parseSkillsMessage("<use_skills>\nskills: solo, duo\n</use_skills>\n\nold body"),
    ).toEqual({
      skills: ["solo", "duo"],
      rest: "old body",
    });
  });

  it("[handoff_from]: round-trips the origin; only a whole-message block parses", () => {
    const origin = {
      agentId: "default_agent",
      agentName: "General Agent",
      sessionId: "session-01ABC",
      sessionTitle: "Fix the parser",
      workspace: "/data/ws",
    };
    const text = buildHandoffMessage(origin);
    expect(text.startsWith("[handoff_from]\n")).toBe(true);
    expect(parseHandoffMessage(text)).toEqual(origin);
    // The parenthetical is omitted when the display name equals the id.
    expect(buildHandoffMessage({ agentId: "researcher", agentName: "researcher" })).toContain(
      "agent: researcher\n",
    );
    expect(parseHandoffMessage(`before\n${text}`)).toBeNull();
    expect(parseHandoffMessage("hello")).toBeNull();
    // Legacy form.
    expect(
      parseHandoffMessage(
        "<handoff_from>\nprose line\nagent: default_agent (General Agent)\nworkspace: /data/ws\n</handoff_from>",
      ),
    ).toEqual({ agentId: "default_agent", agentName: "General Agent", workspace: "/data/ws" });
  });

  it("[scheduled_task]: block + prompt body, parsed back with the body as rest", () => {
    const text = buildScheduledMessage("daily_report", "2026-07-16T01:00:00.000Z", "Write it\nnow");
    expect(text.startsWith("[scheduled_task]\n")).toBe(true);
    expect(parseScheduledMessage(text)).toEqual({
      origin: { name: "daily_report", firedAt: "2026-07-16T01:00:00.000Z" },
      rest: "Write it\nnow",
    });
    // A block without a task name isn't an origin block; mid-text blocks don't parse.
    expect(
      parseScheduledMessage(
        "[scheduled_task]\nfired_at: 2026-01-01T00:00:00Z\n[/scheduled_task]\n\np",
      ),
    ).toBeNull();
    expect(parseScheduledMessage(`preamble\n${text}`)).toBeNull();
    // Legacy form.
    expect(
      parseScheduledMessage(
        "<scheduled_task>\nschedule: daily\nfired_at: 2026-01-01T00:00:00Z\n</scheduled_task>\n\nbody",
      ),
    ).toEqual({ origin: { name: "daily", firedAt: "2026-01-01T00:00:00Z" }, rest: "body" });
  });

  it("[model_switch_from]: round-trips the origin, including a parenthesized session title", () => {
    const origin = {
      sessionId: "session-2026-07-24-10-00-00-abcdef01",
      sessionTitle: "Fix (the) parser",
      tracePath: "/data/p/agents/a/traces/2026-07-24/session-x_001.jsonl",
      workspace: "/data/ws",
      prevProvider: "deepseek",
      prevModelId: "deepseek-v4-pro",
    };
    const text = buildModelSwitchMessage(origin);
    expect(text.startsWith("[model_switch_from]\n")).toBe(true);
    expect(parseModelSwitchMessage(text)).toEqual(origin);
    const minimal = buildModelSwitchMessage({ sessionId: "session-01" });
    expect(minimal).not.toContain("trace:");
    expect(parseModelSwitchMessage(minimal)).toEqual({ sessionId: "session-01" });
    // A block without a session line is not an origin block; partial messages don't parse.
    expect(
      parseModelSwitchMessage("[model_switch_from]\ntrace: /t.jsonl\n[/model_switch_from]"),
    ).toBeNull();
    expect(parseModelSwitchMessage(`${text}\nafter`)).toBeNull();
    // Legacy form.
    expect(
      parseModelSwitchMessage(
        "<model_switch_from>\nprose\nsession: session-01 (Fix the parser)\ntrace: /data/t.jsonl\n</model_switch_from>",
      ),
    ).toEqual({
      sessionId: "session-01",
      sessionTitle: "Fix the parser",
      tracePath: "/data/t.jsonl",
    });
  });
});
