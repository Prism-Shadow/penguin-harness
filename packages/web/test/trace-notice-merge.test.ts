/**
 * Trace page round merging for background completion notices (trace-file-view helpers):
 * a round whose first main-stream user message is a `[background_task_done]` harness
 * notice re-targets onto the previous round; chained notices collapse onto the same
 * target; unclassifiable rounds (notice beyond the loaded page) keep their own card.
 * Plus the timeline user-mark extraction's sender split.
 */
import { describe, expect, it } from "vitest";
import {
  assistantText,
  buildBackgroundTaskDoneMessage,
  userText,
} from "@prismshadow/penguin-core/omnimessage";
import type { OmniMessage } from "@prismshadow/penguin-core/omnimessage";
import type { TraceTaskStats } from "@prismshadow/penguin-server/api";
import { noticeTaskRemap, userMarksOf } from "../src/features/traces/trace-file-view";

function task(taskIndex: number, messageFrom: number, messageTo: number): TraceTaskStats {
  return {
    taskIndex,
    messageFrom,
    messageTo,
    startTs: "2026-08-21T00:00:00.000Z",
    endTs: "2026-08-21T00:00:01.000Z",
    tokens: { cacheRead: 1, cacheWrite: 1, output: 1 },
    llmMs: 10,
  };
}

const NOTICE = buildBackgroundTaskDoneMessage(
  { kind: "command", id: "proc-11aa22bb", status: "completed", detail: "exit code 0" },
  "done",
);

describe("noticeTaskRemap", () => {
  it("re-targets a notice round onto the previous round; chains collapse onto the same target", () => {
    const tasks = [task(0, 0, 2), task(1, 3, 5), task(2, 6, 8)];
    // Three rounds of [user, reply, reply]: round 0 is a real prompt, rounds 1 and 2 open
    // with completion notices.
    const events: OmniMessage[] = [
      userText("start a build"),
      assistantText("launching"),
      assistantText("started"),
      userText(NOTICE),
      assistantText("ack 1"),
      assistantText("…"),
      userText(NOTICE),
      assistantText("ack 2"),
      assistantText("…"),
    ];
    const remap = noticeTaskRemap(tasks, events, 0);
    expect(remap.get(1)).toBe(0);
    expect(remap.get(2)).toBe(0);
    expect(remap.has(0)).toBe(false);
  });

  it("keeps a round standalone when its first user message is not a notice or is beyond the page", () => {
    const tasks = [task(0, 0, 1), task(1, 2, 3)];
    const remap = noticeTaskRemap(
      tasks,
      [userText("a"), assistantText("r"), userText("b"), assistantText("r")],
      0,
    );
    expect(remap.size).toBe(0);
    // The loaded page starts past both rounds' user messages: unclassifiable → no merge.
    expect(noticeTaskRemap(tasks, [assistantText("tail")], 3).size).toBe(0);
  });
});

describe("userMarksOf", () => {
  it("splits human messages from sender-marked injections", () => {
    const human = userText("hello");
    const harness = userText(NOTICE, "harness");
    const marks = userMarksOf([human, harness]);
    expect(marks).toEqual([
      { ts: human.timestamp, machine: false },
      { ts: harness.timestamp, machine: true },
    ]);
  });
});
