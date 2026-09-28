import { describe, expect, it } from "vitest";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { sessionHref, settledActivityRuns, withoutActivityRuns } from "../src/lib/activity-sessions";

const s = (sessionId: string, status: string, activityId?: string) =>
  ({ sessionId, status, ...(activityId ? { activityId } : {}) }) as unknown as SessionInfo;

describe("activity sessions", () => {
  it("drops activity-run sessions from the global list", () => {
    expect(withoutActivityRuns([s("a", "idle"), s("b", "idle", "act")]).map((x) => x.sessionId)).toEqual(["a"]);
  });
  it("opens an activity run at its activity, anything else in chat", () => {
    expect(sessionHref({ sessionId: "b", activityId: "act 1" })).toBe("/activities/act%201");
    expect(sessionHref({ sessionId: "a/1" })).toBe("/chat/a%2F1");
  });
  it("notices an activity run finishing, not an ordinary session", () => {
    const before = new Map([["a", "running"], ["b", "running"]]);
    expect(settledActivityRuns(before, [s("a", "idle"), s("b", "running", "act")])).toBe(false);
    expect(settledActivityRuns(before, [s("a", "running"), s("b", "idle", "act")])).toBe(true);
  });
});
