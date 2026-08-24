/**
 * input-history.ts unit tests: which stream items become recallable entries, and the
 * ↑/↓ navigation state machine the composer drives (start-from-empty, edit-ends-navigation,
 * pin-at-oldest, stash restore past the newest).
 */
import { describe, expect, it } from "vitest";
import type { ChatItem } from "../src/lib/omni/stream-model";
import { buildSkillsMessage } from "../src/features/chat/skill-use";
import { handoffMessage } from "../src/features/chat/agent-handoff";
import {
  buildBackgroundTaskDoneMessage,
  buildScheduledMessage,
} from "@prismshadow/penguin-core/markers";
import {
  buildInputHistory,
  caretOnFirstLine,
  caretOnLastLine,
  historyStepBack,
  historyStepForward,
} from "../src/features/chat/input-history";
import type { HistoryNav } from "../src/features/chat/input-history";

let nextId = 0;
const user = (text: string): ChatItem => ({ kind: "user_text", id: nextId++, text });
const steering = (text: string): ChatItem => ({ kind: "user_steering", id: nextId++, text });
const assistant = (text: string): ChatItem => ({
  kind: "assistant_text",
  id: nextId++,
  text,
  streaming: false,
});

describe("buildInputHistory", () => {
  it("collects typed prompts and steering in order, skipping machine-injected texts", () => {
    const goalRound1 = `[goal]\nround: 1\nobjective: fix it\n[/goal]\nfix the bug`;
    const goalRound2 = `[goal]\nround: 2\nobjective: fix it\n[/goal]\nfix the bug`;
    const items: ChatItem[] = [
      user("first question"),
      assistant("answer"),
      user(handoffMessage({ agentId: "agent-a", sessionId: "session-1", workspace: "/tmp/w" })),
      user(buildScheduledMessage("nightly", "2026-08-01T00:00:00Z", "scheduled prompt")),
      user(goalRound1),
      user(goalRound2),
      steering("please also check the tests"),
      // An idle-launched background completion notice arrives as user_text but is
      // harness-written — recalling it would resend a machine report as user input.
      user(
        buildBackgroundTaskDoneMessage(
          { kind: "command", id: "proc-1", status: "completed", detail: "exit code 0" },
          "Background command finished",
        ),
      ),
      user(buildSkillsMessage(["my-skill"], "with a skill")),
      user("first question"),
    ];
    expect(buildInputHistory(items)).toEqual([
      "first question",
      "fix the bug",
      "please also check the tests",
      "with a skill",
      "first question",
    ]);
  });

  it("collapses consecutive duplicates and drops empty bodies (image-only prompts)", () => {
    const items: ChatItem[] = [user("same"), user("same"), user("  "), user("next")];
    expect(buildInputHistory(items)).toEqual(["same", "next"]);
  });
});

describe("history navigation", () => {
  const history = ["one", "two", "three"];

  it("starts from an empty draft at the newest entry and walks back, pinning at the oldest", () => {
    const s1 = historyStepBack(history, null, "");
    expect(s1?.text).toBe("three");
    const s2 = historyStepBack(history, s1!.nav, "three");
    expect(s2?.text).toBe("two");
    const s3 = historyStepBack(history, s2!.nav, "two");
    expect(s3?.text).toBe("one");
    const s4 = historyStepBack(history, s3!.nav, "one");
    expect(s4?.text).toBe("one"); // pinned: repeated ↑ at the oldest stays put
    expect(s4?.nav?.index).toBe(0);
  });

  it("does not start from a non-empty draft, and stashes/restores the draft across a round trip", () => {
    expect(historyStepBack(history, null, "half-written")).toBeNull();
    const back = historyStepBack(history, null, "  ");
    expect(back?.nav?.stash).toBe("  ");
    const fwd = historyStepForward(history, back!.nav, "three");
    expect(fwd).toEqual({ nav: null, text: "  " }); // past the newest: draft restored, navigation over
  });

  it("hands the keys back once the recalled text was edited", () => {
    const nav: HistoryNav = { index: 2, stash: "", recalled: "three" };
    expect(historyStepBack(history, nav, "three edited")).toBeNull();
    expect(historyStepForward(history, nav, "three edited")).toBeNull();
  });

  it("steps forward through newer entries before restoring the stash", () => {
    const nav: HistoryNav = { index: 0, stash: "draft", recalled: "one" };
    const s1 = historyStepForward(history, nav, "one");
    expect(s1?.text).toBe("two");
    const s2 = historyStepForward(history, s1!.nav, "two");
    expect(s2?.text).toBe("three");
    const s3 = historyStepForward(history, s2!.nav, "three");
    expect(s3).toEqual({ nav: null, text: "draft" });
  });

  it("never steps with an empty history", () => {
    expect(historyStepBack([], null, "")).toBeNull();
  });
});

describe("caret line guards", () => {
  it("first/last line checks follow the newlines around the caret", () => {
    const text = "line1\nline2";
    expect(caretOnFirstLine(text, 3)).toBe(true);
    expect(caretOnFirstLine(text, 8)).toBe(false);
    expect(caretOnLastLine(text, 8)).toBe(true);
    expect(caretOnLastLine(text, 3)).toBe(false);
    expect(caretOnFirstLine("", 0)).toBe(true);
    expect(caretOnLastLine("", 0)).toBe(true);
  });
});
