/**
 * The activity mark a Session row wears (lib/session-activity.ts) and the words the app gives
 * it.
 *
 * - A live run (compaction included) shows whatever the read state, even before its Trace
 *   exists.
 * - A settled Session is marked only while its last reply is unread; once read, or if it
 *   never ran, nothing is drawn.
 * - The background count is zero without the field and the sum of both counts with it.
 * - Each state has a label of its own, since the glyph carries no text.
 */
import { describe, expect, it } from "vitest";
import {
  sessionActivity,
  sessionActivityLabel,
  sessionBackgroundTasks,
} from "../src/lib/session-activity";
import type { SessionActivity } from "../src/lib/session-activity";

type Activity = Exclude<SessionActivity, null>;
const ACTIVITIES: readonly Activity[] = ["running", "compacting", "completedUnread"];

describe("sessionActivity", () => {
  it("reports a live run whatever the read state, compaction included", () => {
    expect(sessionActivity("running", true, false)).toBe("running");
    expect(sessionActivity("running", true, true)).toBe("running");
    expect(sessionActivity("compacting", true, false)).toBe("compacting");
    expect(sessionActivity("compacting", true, true)).toBe("compacting");
  });

  it("marks a settled Session only while its last reply is unread", () => {
    expect(sessionActivity("idle", true, true)).toBe("completedUnread");
    // Read: the marker is removed, not muted. Nothing left to act on, nothing shown.
    expect(sessionActivity("idle", true, false)).toBeNull();
  });

  it("shows nothing for a Session that has never run", () => {
    expect(sessionActivity("idle", false, false)).toBeNull();
    // hasTrace is still load-bearing even though read and never-ran look identical: a Session
    // created after this browser first saw the Project has no read marker of its own, so it
    // falls back to the baseline and its creation time reads as UNREAD. Without the guard every
    // brand-new conversation would wear the "go look" dot before it had ever run.
    expect(sessionActivity("idle", false, true)).toBeNull();
  });

  it("still reports a live run started before its Trace was recorded", () => {
    expect(sessionActivity("running", false, false)).toBe("running");
    expect(sessionActivity("compacting", false, false)).toBe("compacting");
  });
});

describe("sessionBackgroundTasks", () => {
  it("is zero without the field and the sum of both counts with it", () => {
    // The server omits the field at zero, so absence is the common case, not an error.
    expect(sessionBackgroundTasks({})).toBe(0);
    expect(sessionBackgroundTasks({ backgroundTasks: { processes: 2, subagents: 0 } })).toBe(2);
    expect(sessionBackgroundTasks({ backgroundTasks: { processes: 1, subagents: 3 } })).toBe(4);
  });
});

describe("sessionActivityLabel", () => {
  it("labels each state distinctly, since the glyph carries no text", () => {
    const labels = ACTIVITIES.map(sessionActivityLabel);
    expect(labels.every((label) => label.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(ACTIVITIES.length);
  });
});
