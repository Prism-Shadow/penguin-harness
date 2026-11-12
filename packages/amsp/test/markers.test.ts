/**
 * Message-marker module tests (packages/amsp/src/markers, which core re-exports):
 * the canonical `[tag]…[/tag]` producers, their inverse parsers, and the compatibility rule that every
 * parser also accepts the legacy `<tag>…</tag>` form (markers persist in Traces and in each
 * agent's stored compaction prompt) while producers only ever emit the square form.
 *
 * Behavior covered here used to live next to each call site — engine (`extractSummary`),
 * the records module (`userSteeringText`), web (`skill-use` / `agent-handoff`) — and moved with the
 * consolidation; the host-side tests keep covering the rendering/wiring around them.
 */
import { describe, expect, it } from "vitest";
import {
  MARKER_TAGS,
  SALVAGE_MIN_CHARS,
  buildContextHandoffText,
  buildContextSummaryText,
  buildHandoffMessage,
  buildModelSwitchMessage,
  buildOrgTriggerMessage,
  buildScheduledMessage,
  buildSkillsMessage,
  buildTurnAbortedBlock,
  buildTurnRetriedBlock,
  stripRequestErrorLines,
  transcribeRequestError,
  dualFormPatterns,
  extractSummary,
  markerBlock,
  matchDualForm,
  parseHandoffMessage,
  parseModelSwitchMessage,
  parseOrgTriggerMessage,
  parseScheduledMessage,
  parseSkillsMessage,
  parseUserSteeringText,
  salvageableSummary,
  startsWithMarker,
  stripConversationMarkers,
  summaryInTags,
  traceQueryGuidance,
  stripMarkerBlocks,
  transcribeText,
  transcribeToolCall,
  transcribeToolCallOutput,
  transcribeUserInput,
  unwrapSyntheticBlock,
  userSteeringText,
} from "../src/markers/index.js";

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

  // The trailer a compacted context's Trace file earns: its path once, then how to query it
  // precisely — line numbers first with a match-only search worded for the Session's shell,
  // then read_file offset/limit on those lines; never the whole file.
  it.each([
    [
      "bash",
      ["`rg -n -o '<pattern>' <file>` (or `grep -n -o`)", `'"role":"user","text"'`],
      ["Select-String"],
    ],
    ["zsh", ["`rg -n -o '<pattern>' <file>`"], ["Select-String"]],
    [
      "pwsh",
      [
        "`(Select-String -Path <file> -SimpleMatch -Pattern '<pattern>').LineNumber`",
        `'"name":"exec_command","arguments"'`,
      ],
      ["rg -n"],
    ],
    ["powershell", ["(Select-String -Path <file> -SimpleMatch"], ["rg -n"]],
    [
      "cmd",
      [
        "`powershell -NoProfile -Command \"(Select-String -Path '<file>' -Pattern '<pattern>').LineNumber\"`",
        "'role.:.user.,.text'",
      ],
      ["rg -n", '"role":"user"'],
    ],
    [
      undefined,
      [
        "`rg -n -o '<pattern>' <file>`",
        "in a POSIX shell",
        "-SimpleMatch -Pattern '<pattern>').LineNumber` in PowerShell",
      ],
      [],
    ],
  ] as const)(
    "a summary's trailer names its Trace file and words the search for the %s shell",
    (shell, present, absent) => {
      const tracePath = "/data/p/agents/a/traces/2026-11-04/session-x_002.jsonl";
      const text = buildContextSummaryText("the gist", {
        tracePath,
        ...(shell !== undefined ? { shell } : {}),
      });
      const lines = text.split("\n");
      expect(lines.slice(0, 3)).toEqual(["[context_summary]", "the gist", ""]);
      expect(lines.at(-1)).toBe("[/context_summary]");
      // About three lines of trailer, the path once.
      const trailer = lines.slice(3, -1);
      expect(trailer).toHaveLength(3);
      expect(text.split(tracePath)).toHaveLength(2);
      expect(trailer[0]).toContain(tracePath);
      expect(trailer[1]).toContain("never read or cat a whole file");
      expect(trailer[2]).toContain("read_file offset/limit");
      expect(trailer[2]).toContain("read_file caps each line");
      for (const fragment of present) expect(trailer[1]).toContain(fragment);
      for (const fragment of absent) expect(text).not.toContain(fragment);
      // Still a summary block to every reader that recognizes one by its prefix.
      expect(startsWithMarker(text, MARKER_TAGS.contextSummary)).toBe(true);
    },
  );

  it("extractSummary accepts the current [summary] form, the legacy <summary> form, and tagless output", () => {
    // The legacy angle form must stay accepted indefinitely: compaction.prompt is persisted in
    // existing agents' system_config.yaml, so old agents keep instructing <summary> tags.
    expect(extractSummary("preamble [summary]new form[/summary] postscript")).toBe("new form");
    expect(extractSummary("preamble <summary>old form</summary> postscript")).toBe("old form");
    expect(extractSummary("  tagless output used verbatim  ")).toBe("tagless output used verbatim");
    // The current form wins when both appear (a model echoing the instruction).
    expect(extractSummary("[summary]a[/summary] <summary>b</summary>")).toBe("a");
  });

  it("extractSummary rescues content the model wrote outside the tags (issue #170)", () => {
    // deepseek-v4-flash writes the tags as a "title" and the body after the closing tag.
    expect(extractSummary("[summary]\n[/summary]\nThe actual summary body.")).toBe(
      "The actual summary body.",
    );
    expect(extractSummary("[summary]\n[summary][/summary]\nBody after a doubled open tag.")).toBe(
      "Body after a doubled open tag.",
    );
    // A stray opening tag inside the pair doesn't hide the text that follows it.
    expect(extractSummary("[summary]\n[summary]\nBody inside.[/summary]")).toBe("Body inside.");
    // An empty current-form pair doesn't shadow a non-empty legacy pair.
    expect(extractSummary("[summary][/summary]<summary>legacy body</summary>")).toBe("legacy body");
    // Genuinely empty output still extracts to "" — the engine treats that as a failed attempt.
    expect(extractSummary("[summary][/summary]")).toBe("");
    expect(extractSummary("[summary]\n[/summary]")).toBe("");
  });

  it("summaryInTags reads square and legacy angle tags, closed and open", () => {
    expect(summaryInTags("preamble [summary]\nthe gist\n[/summary] postscript")).toEqual({
      text: "the gist",
      closed: true,
    });
    expect(summaryInTags("<summary>old form</summary>")).toEqual({
      text: "old form",
      closed: true,
    });
    // A reply cut off before its close tag keeps what it wrote, in either form.
    expect(summaryInTags("[summary]\n## Request\nShip the fix")).toEqual({
      text: "## Request\nShip the fix",
      closed: false,
    });
    expect(summaryInTags("<summary>## Request\nhalf")).toEqual({
      text: "## Request\nhalf",
      closed: false,
    });
    // A stray open tag inside does not end up in the text.
    expect(summaryInTags("[summary]\n[summary]\nBody inside.[/summary]")?.text).toBe(
      "Body inside.",
    );
    // The current form wins when both appear, as everywhere else.
    expect(summaryInTags("<summary>b</summary> [summary]a[/summary]")?.text).toBe("a");
    // Text outside any tag is no summary in tags: a preamble before tool calls reads as nothing.
    expect(summaryInTags("Writing the plan first.")).toBeNull();
    expect(summaryInTags("[summary]\n[/summary]")).toEqual({ text: "", closed: true });
  });

  it("salvageableSummary keeps a summary cut off once it reaches the floor, and nothing shorter", () => {
    const body = "x".repeat(SALVAGE_MIN_CHARS);
    expect(salvageableSummary(`[summary]\n${body}`)).toBe(body);
    expect(salvageableSummary(`[summary]\n${body.slice(1)}`)).toBe("");
    // A closed summary long enough counts too; text with no summary tag never does.
    expect(salvageableSummary(`[summary]${body}[/summary]`)).toBe(body);
    expect(salvageableSummary(body + body)).toBe("");
  });

  it("a salvaged summary is marked as cut off, with the compaction's calls and the notice before the trailer", () => {
    const tracePath = "/data/p/agents/a/traces/2026-11-11/session-x_003.jsonl";
    const callLines = [
      transcribeToolCall("write_file", "h1", '{"file_path":"/s/handoff/plan.md"}'),
      transcribeToolCallOutput("h1", "completed", 'Created "/s/handoff/plan.md" (5 lines).'),
    ];
    const text = buildContextSummaryText(
      "## Request\nShip it",
      { tracePath, shell: "bash" },
      { cutOff: true, callLines, notice: "the previous configuration is still in force." },
    );
    const lines = text.split("\n");
    expect(lines.slice(0, 4)).toEqual(["[context_summary]", "## Request", "Ship it", ""]);
    expect(lines[4]).toContain("cut off before its end");
    expect(lines[4]).toContain("transcript below");
    expect(lines[5]).toContain('a hand-off file exists only if its call shows status="completed"');
    expect(lines.slice(6, 8)).toEqual(callLines);
    expect(lines[8]).toBe("Harness notice: the previous configuration is still in force.");
    expect(lines[9]).toContain(tracePath);
    expect(lines.at(-1)).toBe("[/context_summary]");
    expect(text.split(tracePath)).toHaveLength(2);
  });

  it("extras without a Trace path follow the summary alone; with no extras the block is unchanged", () => {
    const bare = buildContextSummaryText("the gist");
    expect(buildContextSummaryText("the gist", undefined, {})).toBe(bare);
    expect(buildContextSummaryText("the gist", undefined, { callLines: [], notice: "" })).toBe(
      bare,
    );
    const transcript = { tracePath: "/t/session-x_001.jsonl" };
    expect(buildContextSummaryText("the gist", transcript, {})).toBe(
      buildContextSummaryText("the gist", transcript),
    );

    const cut = buildContextSummaryText("the gist", undefined, { cutOff: true }).split("\n");
    expect(cut.slice(0, 3)).toEqual(["[context_summary]", "the gist", ""]);
    expect(cut[3]).toContain("cut off before its end");
    // No transcript exists to read the missing tail from, so none is pointed at.
    expect(cut[3]).not.toContain("transcript");
    expect(cut[4]).toBe("[/context_summary]");
  });

  it("the hand-off note explains itself, quotes its sections in order, leaves out empty ones and ends with the Trace pointer", () => {
    const tracePath = "/data/p/agents/a/traces/2026-11-11/session-x_002.jsonl";
    const userLines = [transcribeUserInput("first ask"), transcribeUserInput("then this")];
    const turnLines = [
      transcribeText("Running the tests."),
      transcribeToolCall("exec_command", "c9", '{"cmd":"pnpm test"}'),
      transcribeToolCallOutput("c9", "completed", "12 passed"),
    ];
    const note = buildContextHandoffText(
      { userLines, turnLines, refusalLines: [], callLines: [] },
      { tracePath, shell: "bash" },
    );
    // Recognized as a summary block by every reader that knows one by its prefix.
    expect(startsWithMarker(note, MARKER_TAGS.contextSummary)).toBe(true);
    const parts = note.split("\n\n");
    expect(parts[0]).toMatch(/^\[context_summary\]\nNo summary of the earlier conversation/);
    expect(parts[0]).toContain("its transcript is the file named below");
    expect(parts[1]!.split("\n")).toEqual([
      "User messages of the compacted context, oldest first:",
      ...userLines,
    ]);
    expect(parts[2]!.split("\n")).toEqual([
      "The last completed turn before the compaction:",
      ...turnLines,
    ]);
    // No refusal and no compaction call section: nothing was refused, and the compaction made
    // no call.
    expect(note).not.toContain("refused by the provider");
    expect(note).not.toContain("Tool calls made during this compaction");
    expect(parts[3]).toContain(tracePath);
    expect(parts[3]).toContain("rg -n -o");
    expect(parts).toHaveLength(4);
    expect(note.endsWith("\n[/context_summary]")).toBe(true);
  });

  it("the hand-off note says why the context was closed when the provider refused, between the last turn and the compaction's calls", () => {
    const turnLines = [transcribeText("Reading the log.")];
    const refusalLines = [transcribeRequestError("rejected", "prompt is too long")];
    const callLines = [transcribeToolCall("write_file", "w1", "{}")];
    const note = buildContextHandoffText(
      { userLines: [], turnLines, refusalLines, callLines },
      { tracePath: "/t/session-x_002.jsonl" },
    );
    const parts = note.split("\n\n");
    expect(parts[1]!.split("\n")).toEqual([
      "The last completed turn before the compaction:",
      ...turnLines,
    ]);
    const [heading, ...quoted] = parts[2]!.split("\n");
    expect(heading).toMatch(/^The request after that turn was refused by the provider/);
    expect(quoted).toEqual(['  [request_error code="rejected"]prompt is too long[/request_error]']);
    expect(parts[3]!.startsWith("Tool calls made during this compaction")).toBe(true);
  });

  it("the hand-off note without a Trace path says no transcript is recorded and names no file", () => {
    const note = buildContextHandoffText({
      userLines: [],
      turnLines: [],
      refusalLines: [],
      callLines: [],
    });
    const lines = note.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("no transcript of it is recorded");
    expect(lines[1]).toContain("Carry on with the task from where it stopped.");
    expect(lines[1]).not.toContain("file named below");
    expect(lines[1]).toContain("Consent does not carry over");
    expect(note).not.toContain("JSONL");
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

  it("request_error lines: the failure's code and text as they came, at most one per block", () => {
    expect(transcribeRequestError("network", "502 Bad Gateway")).toBe(
      '  [request_error code="network"]502 Bad Gateway[/request_error]',
    );
    // An idle timeout carries a code and no text.
    expect(transcribeRequestError("timeout", undefined)).toBe(
      '  [request_error code="timeout"][/request_error]',
    );
    // Rebuilding a block drops the old line (a multi-line error included) before the new one.
    const inner = [transcribeText("half"), transcribeRequestError("network", "502\nBad Gateway")];
    expect(stripRequestErrorLines(inner.join("\n"))).toBe(transcribeText("half"));
    expect(stripRequestErrorLines(transcribeRequestError("timeout", undefined))).toBe("");
    expect(stripRequestErrorLines(transcribeText("no error here"))).toBe(
      transcribeText("no error here"),
    );
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

describe("[org_trigger] (company-mode work runs and ticket sessions)", () => {
  it("round-trips every field and keeps the body", () => {
    const origin = {
      org: "acme",
      employee: "acme_hr (HR, reports to acme_ceo)",
      kind: "event" as const,
      event: "daily-standup",
      firedAt: "2026-09-01T09:00:00+08:00",
      budget: "12.40 / 30.00 USD (41%)",
    };
    const text = buildOrgTriggerMessage(origin, "Sweep the board.");
    expect(text.startsWith("[org_trigger]\n")).toBe(true);
    expect(text).toContain("<app_data_dir>/organizations/acme/handbook/README.md");
    expect(parseOrgTriggerMessage(text)).toEqual({ origin, rest: "Sweep the board." });
  });

  it("carries the channel a mention was posted in, and the one to answer in", () => {
    const origin = {
      org: "acme",
      employee: "acme_dev (Developer, reports to acme_ceo)",
      kind: "mention" as const,
      message: "msg-2026-09-03-01-00-00-00000000 from user:alice",
      channel: "site",
    };
    const text = buildOrgTriggerMessage(origin, "> the message");
    expect(text).toContain("\nchannel: site\n");
    expect(parseOrgTriggerMessage(text)).toEqual({ origin, rest: "> the message" });
    // Absent on the kinds that have no channel, and absent from what they parse back to.
    const init = buildOrgTriggerMessage({ org: "acme", employee: "acme_ceo", kind: "init" }, "");
    expect(init).not.toContain("channel:");
    expect(parseOrgTriggerMessage(init)?.origin.channel).toBeUndefined();
  });

  it("returns null for an unknown kind, a missing employee, or plain text", () => {
    const text = buildOrgTriggerMessage({ org: "acme", employee: "acme_ceo", kind: "init" }, "");
    expect(text.endsWith("[/org_trigger]")).toBe(true);
    expect(parseOrgTriggerMessage(text.replace("kind: init", "kind: party"))).toBeNull();
    expect(parseOrgTriggerMessage(text.replace("employee: acme_ceo\n", ""))).toBeNull();
    expect(parseOrgTriggerMessage("hello")).toBeNull();
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
    // How to read the trace file is the summary trailer's wording, shell-worded when known, and
    // the fields still parse around it.
    const posix = buildModelSwitchMessage(origin, { shell: "bash" });
    expect(posix).toContain(traceQueryGuidance("bash"));
    expect(text).toContain(traceQueryGuidance());
    expect(buildContextSummaryText("s", { tracePath: "/t.jsonl", shell: "bash" })).toContain(
      traceQueryGuidance("bash"),
    );
    expect(parseModelSwitchMessage(posix)).toEqual(origin);
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
