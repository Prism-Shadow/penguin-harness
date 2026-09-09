/**
 * The company sidebar's two session groups (features/company/org-sessions.ts) and the
 * development list's organization filter (session-grouping): a desk row per employee in chart
 * order whether or not a desk exists, the session list's live status winning over both
 * snapshots, ticket sessions newest first under the ticket that names them, the glyph a row
 * draws, the split of a loaded list into the user's own rows and the organizations', and the
 * totals corrected by what that split hid.
 */
import { describe, expect, it } from "vitest";
import type {
  OrgChartResponse,
  OrgSessionsResponse,
  SessionCategoryCounts,
  SessionInfo,
  SessionStatus,
} from "@prismshadow/penguin-server/api";
import { deskRows, orgRowActivity, ticketSessionRows } from "../src/features/company/org-sessions";
import {
  countsWithoutOrgSessions,
  isOrgSession,
  splitDevelopmentList,
  withoutOrgSessions,
} from "../src/lib/session-grouping";

const liveStatuses = (entries: Record<string, SessionStatus>): ReadonlyMap<string, SessionStatus> =>
  new Map(Object.entries(entries));

const employee = (
  agentId: string,
  name: string,
  extra: Partial<OrgChartResponse["employees"][number]> = {},
): OrgChartResponse["employees"][number] => ({
  agentId,
  name,
  title: "Engineer",
  reportsTo: agentId === "ceo" ? null : "ceo",
  workspace: ".",
  state: "idle",
  spend: { own: 0, cumulative: 0 },
  ...extra,
});

const chart: OrgChartResponse = {
  ceoAgentId: "ceo",
  employees: [
    employee("ceo", "Alice", {
      title: "CEO",
      state: "running",
      desk: { sessionId: "s-ceo", workspace: "/w", openedAt: "2026-09-02T00:00:00Z" },
    }),
    employee("pm", "Product"),
    employee("dev", "Dana"),
  ],
};

const sessions: OrgSessionsResponse = {
  desks: [
    { agentId: "pm", name: "Product", sessionId: "s-pm", status: "compacting", workspace: "/w" },
    {
      agentId: "ceo",
      name: "Alice",
      sessionId: "s-ceo",
      status: "idle",
      workspace: "/w",
      lastActiveAt: "2026-09-02T00:00:00Z",
    },
  ],
  tickets: [
    {
      ticketId: "2026-09-docs",
      title: "Docs",
      status: "in_progress",
      sessions: [
        {
          sessionId: "s-t1",
          agentId: "pm",
          status: "running",
          lastActiveAt: "2026-09-03T08:00:00Z",
        },
        { sessionId: "s-t2", agentId: "ceo", status: "idle", title: "Write docs" },
      ],
    },
    {
      ticketId: "2026-09-site",
      title: "Site",
      status: "in_progress",
      sessions: [
        {
          sessionId: "s-t3",
          agentId: "dev",
          status: "idle",
          title: "Build the site",
          lastActiveAt: "2026-09-03T09:00:00Z",
        },
      ],
    },
    { ticketId: "2026-09-empty", title: "Nothing yet", status: "proposed", sessions: [] },
  ],
};

describe("deskRows", () => {
  it("keeps chart order and lists an employee whose desk was never opened", () => {
    expect(deskRows(chart, sessions)).toEqual([
      { agentId: "ceo", name: "Alice", jobTitle: "CEO", sessionId: "s-ceo", status: "idle" },
      {
        agentId: "pm",
        name: "Product",
        jobTitle: "Engineer",
        sessionId: "s-pm",
        status: "compacting",
      },
      { agentId: "dev", name: "Dana", jobTitle: "Engineer", sessionId: null, status: "idle" },
    ]);
  });

  it("falls back to the chart's own running state for a desk the sessions route has not listed", () => {
    const rows = deskRows(chart, { desks: [], tickets: [] });
    expect(rows[0]).toMatchObject({ agentId: "ceo", sessionId: "s-ceo", status: "running" });
    expect(rows[2]).toMatchObject({ agentId: "dev", sessionId: null, status: "idle" });
  });

  it("stands in with the sessions route while no chart has been read", () => {
    expect(deskRows(null, sessions).map((d) => d.agentId)).toEqual(["pm", "ceo"]);
    expect(deskRows(null, undefined)).toEqual([]);
  });

  // The snapshots only move on an organization event, and a run ending publishes none: a desk
  // that stopped would sit on "running" until an unrelated event happened to arrive.
  it("takes the session list's live status over both snapshots", () => {
    const live = liveStatuses({ "s-ceo": "running", "s-pm": "idle" });
    expect(deskRows(chart, sessions, live).map((d) => [d.agentId, d.status])).toEqual([
      ["ceo", "running"],
      ["pm", "idle"],
      // No desk session, so nothing live to read: the chart's own state stands.
      ["dev", "idle"],
    ]);
    // The chart's desk id counts too, even before the sessions route has listed it.
    expect(
      deskRows(chart, { desks: [], tickets: [] }, liveStatuses({ "s-ceo": "idle" }))[0],
    ).toMatchObject({ agentId: "ceo", status: "idle" });
    // And without a chart, the sessions route's own rows take it as well.
    expect(deskRows(null, sessions, liveStatuses({ "s-pm": "running" }))[0]).toMatchObject({
      agentId: "pm",
      status: "running",
    });
  });

  it("falls back to the snapshot for a desk the session list has not loaded", () => {
    expect(deskRows(chart, sessions, liveStatuses({})).map((d) => d.status)).toEqual([
      "idle",
      "compacting",
      "idle",
    ]);
  });
});

describe("ticketSessionRows", () => {
  it("flattens every ticket's sessions newest first, carrying the ticket as the subtitle", () => {
    expect(ticketSessionRows(sessions).map((r) => [r.sessionId, r.ticketTitle])).toEqual([
      ["s-t3", "Site"],
      ["s-t1", "Docs"],
      ["s-t2", "Docs"],
    ]);
    expect(ticketSessionRows(sessions)[2]).toMatchObject({ title: "Write docs", agentId: "ceo" });
    expect(ticketSessionRows(undefined)).toEqual([]);
  });

  it("takes the session list's live status over the snapshot's", () => {
    const rows = ticketSessionRows(sessions, liveStatuses({ "s-t1": "idle", "s-t2": "running" }));
    expect(rows.map((r) => [r.sessionId, r.status])).toEqual([
      // Not loaded by the session list, so the snapshot's status stands.
      ["s-t3", "idle"],
      ["s-t1", "idle"],
      ["s-t2", "running"],
    ]);
  });
});

describe("orgRowActivity", () => {
  it("draws the live states and nothing when settled", () => {
    expect(orgRowActivity("running")).toBe("running");
    expect(orgRowActivity("compacting")).toBe("compacting");
    expect(orgRowActivity("idle")).toBeNull();
  });
});

describe("isOrgSession", () => {
  it("reads either mark, and an empty orgId as no organization", () => {
    expect(isOrgSession({ orgId: "acme" })).toBe(true);
    // The durable stamp still answers once the organization is deleted and `orgId` is gone.
    expect(isOrgSession({ client: "org" })).toBe(true);
    expect(isOrgSession({})).toBe(false);
    expect(isOrgSession({ orgId: "" })).toBe(false);
    expect(isOrgSession({ orgId: "", client: "web" })).toBe(false);
  });
});

describe("splitDevelopmentList", () => {
  const rows = [
    { sessionId: "a" },
    { sessionId: "s-ceo", orgId: "acme" },
    { sessionId: "b", client: "web" },
    { sessionId: "s-t1", orgId: "acme" },
    // Its organization is gone, so nothing resolves an orgId for it any more.
    { sessionId: "s-orphan", client: "org" },
  ];

  it("moves the organizations' rows into their own list, keeping order on both sides", () => {
    expect(splitDevelopmentList(rows)).toEqual({
      own: [{ sessionId: "a" }, { sessionId: "b", client: "web" }],
      organization: [
        { sessionId: "s-ceo", orgId: "acme" },
        { sessionId: "s-t1", orgId: "acme" },
        { sessionId: "s-orphan", client: "org" },
      ],
    });
  });

  it("treats an empty orgId as no organization", () => {
    expect(withoutOrgSessions([{ sessionId: "a", orgId: "" }, { sessionId: "b" }])).toEqual([
      { sessionId: "a", orgId: "" },
      { sessionId: "b" },
    ]);
  });

  it("hides the organizations' rows whatever the company-mode switches say", () => {
    // There is no switch to pass any more: this list is the user's own conversations, and a
    // Session the scheduler drives is not one whether or not company mode is on screen.
    expect(withoutOrgSessions(rows).map((s) => s.sessionId)).toEqual(["a", "b"]);
  });
});

describe("countsWithoutOrgSessions", () => {
  const row = (over: Partial<SessionInfo>): SessionInfo =>
    ({
      sessionId: "s",
      projectId: "p",
      agentId: "ceo",
      provider: "custom",
      modelId: "m",
      workspace: "/org",
      approvalMode: "allow-all",
      createdAt: "2026-09-02T00:00:00Z",
      lastActiveAt: "2026-09-02T00:00:00Z",
      status: "idle",
      pendingApprovalCount: 0,
      pendingFollowUpCount: 0,
      hasTrace: true,
      archived: false,
      ...over,
    }) as SessionInfo;
  const counts = new Map<string, SessionCategoryCounts>([
    ["ceo", { active: 3, subagent: 0, schedule: 0, archived: 1 }],
    ["other", { active: 2, subagent: 0, schedule: 0, archived: 0 }],
  ]);
  const workspaceCounts = new Map<string, Readonly<Record<string, SessionCategoryCounts>>>([
    ["ceo", { "/org": { active: 3, subagent: 0, schedule: 0, archived: 1 } }],
    ["other", { "/w": { active: 2, subagent: 0, schedule: 0, archived: 0 } }],
  ]);

  it("subtracts each hidden row from its Agent's totals and from its Workspace's share", () => {
    const out = countsWithoutOrgSessions(counts, workspaceCounts, [
      row({ sessionId: "s-desk", orgId: "acme" }),
      row({ sessionId: "s-old", orgId: "acme", archived: true }),
    ]);
    expect(out.byAgent.get("ceo")).toEqual({ active: 2, subagent: 0, schedule: 0, archived: 0 });
    expect(out.byWorkspace.get("ceo")?.["/org"]).toEqual({
      active: 2,
      subagent: 0,
      schedule: 0,
      archived: 0,
    });
    // Another Agent's totals are untouched, and the store's own maps are never written into.
    expect(out.byAgent.get("other")).toEqual({ active: 2, subagent: 0, schedule: 0, archived: 0 });
    expect(counts.get("ceo")).toEqual({ active: 3, subagent: 0, schedule: 0, archived: 1 });
  });

  it("gives the maps straight back when nothing is hidden, and never counts below zero", () => {
    expect(countsWithoutOrgSessions(counts, workspaceCounts, []).byAgent).toBe(counts);
    const out = countsWithoutOrgSessions(counts, workspaceCounts, [
      row({ agentId: "other", workspace: "/w", orgId: "acme" }),
      row({ agentId: "other", workspace: "/w", orgId: "acme" }),
      row({ agentId: "other", workspace: "/w", orgId: "acme" }),
    ]);
    expect(out.byAgent.get("other")?.active).toBe(0);
    expect(out.byWorkspace.get("other")?.["/w"]?.active).toBe(0);
  });
});
