import { describe, expect, it } from "vitest";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import {
  groupActivityRuns,
  groupActivityRunsByProduct,
  isActivityRunWorkspace,
  withoutActivityRunWorkspaces,
  latestOwnConversation,
  sessionHref,
  settledActivityRuns,
  shouldPollSummaries,
  shouldReloadList,
  startedUnlistedRuns,
  withoutActivityRuns,
} from "../src/lib/activity-sessions";

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
  it("notices a run starting that the list holds no row for", () => {
    const listed = [s("a", "idle")];
    // A listed session going live is the settle signal's business, not this one's.
    expect(startedUnlistedRuns(new Map(), new Map([["a", "running"]]), listed)).toBe(false);
    expect(startedUnlistedRuns(new Map(), new Map([["x", "running"]]), listed)).toBe(true);
    // Only the start: a repeat of the same live status is not a new run.
    expect(startedUnlistedRuns(new Map([["x", "running"]]), new Map([["x", "running"]]), listed)).toBe(false);
    expect(startedUnlistedRuns(new Map(), new Map([["x", "idle"]]), listed)).toBe(false);
  });
  it("reloads the list only on a genuine return from an activity", () => {
    // First mount of the list: no previous activity to have come back from.
    expect(shouldReloadList(undefined, undefined)).toBe(false);
    // Still inside an activity, or moving between activities: not a return to the list.
    expect(shouldReloadList(undefined, "act")).toBe(false);
    expect(shouldReloadList("act", "act2")).toBe(false);
    // Came back from an activity to the list.
    expect(shouldReloadList("act", undefined)).toBe(true);
  });
  it("auto-opens the newest own conversation, never an activity run or an organization's session", () => {
    const row = (sessionId: string, lastActiveAt: string, extra: Partial<SessionInfo> = {}) =>
      ({ sessionId, lastActiveAt, status: "idle", ...extra }) as unknown as SessionInfo;
    const own = row("own", "2026-09-01T00:00:00.000Z");
    const run = row("run", "2026-09-03T00:00:00.000Z", { activityId: "act" });
    const desk = row("desk", "2026-09-02T00:00:00.000Z", { orgId: "acme" });
    expect(latestOwnConversation([run, desk, own])?.sessionId).toBe("own");
    expect(latestOwnConversation([run, desk])).toBeNull();
  });
  it("polls the home list only while it is shown and some run is in flight", () => {
    const running = { status: { kind: "running" as const, runKind: "spec" as const } };
    const built = { status: { kind: "built" as const } };
    expect(shouldPollSummaries(undefined, { a: built, b: running } as never)).toBe(true);
    expect(shouldPollSummaries(undefined, { a: built } as never)).toBe(false);
    expect(shouldPollSummaries(undefined, {})).toBe(false);
    // Inside an activity the list is not shown: no poll, running or not.
    expect(shouldPollSummaries("a", { b: running } as never)).toBe(false);
  });

  it("groups loaded activity runs under their activity, most recent first", () => {
    const run = (sessionId: string, activityId: string | undefined, lastActiveAt: string, extra = {}) =>
      ({ sessionId, lastActiveAt, archived: false, ...(activityId ? { activityId } : {}), ...extra }) as unknown as SessionInfo;
    const groups = groupActivityRuns(
      [
        run("chat", undefined, "2026-09-29T10:00:00Z"),
        run("a1", "act-a", "2026-09-29T08:00:00Z"),
        run("b1", "act-b", "2026-09-29T09:00:00Z"),
        run("a2", "act-a", "2026-09-29T07:00:00Z"),
        run("a3", "act-a", "2026-09-29T11:00:00Z", { archived: true }),
        run("o1", "act-b", "2026-09-29T12:00:00Z", { orgId: "org" }),
      ],
      new Map([["act-a", "Letter hunt"]]),
    );
    expect(groups.map((g) => [g.activityId, g.name, g.sessions.map((x) => x.sessionId)])).toEqual([
      ["act-b", null, ["b1"]],
      ["act-a", "Letter hunt", ["a1", "a2"]],
    ]);
  });

  it("recognises a run's own workspace, on either path separator", () => {
    expect(isActivityRunWorkspace("C:\\Users\\me\\.penguin\\dev-data\\activity-runs\\run_ae24c2f2")).toBe(true);
    expect(isActivityRunWorkspace("/home/me/.penguin/activity-runs/run_1/")).toBe(true);
    expect(isActivityRunWorkspace("/home/me/code/activity-runs")).toBe(false);
    expect(isActivityRunWorkspace("/home/me/activity-runs/run_1/src")).toBe(false);
  });
  it("drops run workspaces from the per-workspace tallies", () => {
    const tallies = new Map([["agent", { "/w/app": 3, "/h/activity-runs/run_1": 1 }]]);
    expect(withoutActivityRunWorkspaces(tallies)).toEqual(new Map([["agent", { "/w/app": 3 }]]));
  });

  it("groups activity runs by product code, unidentified activities last", () => {
    const run = (sessionId: string, activityId: string, lastActiveAt: string) =>
      ({ sessionId, activityId, lastActiveAt, archived: false }) as unknown as SessionInfo;
    const products = groupActivityRunsByProduct(
      [
        run("x1", "act-x", "2026-09-29T12:00:00Z"),
        run("a1", "act-a", "2026-09-29T08:00:00Z"),
        run("b1", "act-b", "2026-09-29T11:00:00Z"),
        run("c1", "act-c", "2026-09-29T10:00:00Z"),
      ],
      new Map([
        ["act-a", { name: "Letter hunt", productCode: "ABC" }],
        ["act-b", { name: "Rhymes", productCode: "XYZ" }],
        ["act-c", { name: "Sounds", productCode: "ABC" }],
      ]),
    );
    expect(
      products.map((p) => [p.productCode, p.activities.map((g) => [g.activityId, g.name])]),
    ).toEqual([
      ["XYZ", [["act-b", "Rhymes"]]],
      ["ABC", [["act-c", "Sounds"], ["act-a", "Letter hunt"]]],
      [null, [["act-x", null]]],
    ]);
  });
});
