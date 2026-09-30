/**
 * The company sidebar's 工位 group (features/company/org-sessions.ts) and the development
 * list's organization filter (session-grouping): a desk row per employee in chart order
 * whether or not a desk exists, the session list's live status winning over both snapshots,
 * the messaging mark read from the sessions route and patched by a bind or an unbind,
 * the titles the route gives the ticket sessions the Temporary group lists, the glyph a row
 * draws, an employee's own state read from every Session the organization
 * attributes to it — its ticket sessions included, though no list shows them as a group —
 * and the render-time guard that keeps an organization's row out of the development list when
 * one still reaches it (the server leaves them out of the list's own fetches; see
 * sessions-own-rows.test.ts).
 */
import { describe, expect, it } from "vitest";
import type {
  OrgChartResponse,
  OrgSessionsResponse,
  SessionStatus,
} from "@prismshadow/penguin-server/api";
import {
  deskRows,
  liveEmployeeStates,
  orgRowActivity,
  ticketSessionTitles,
  withDeskMessagingChannel,
} from "../src/features/company/org-sessions";
import { isOrgSession, withoutOrgSessions } from "../src/lib/session-grouping";

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

describe("the desk row's messaging mark", () => {
  const bound: OrgSessionsResponse = {
    ...sessions,
    desks: sessions.desks.map((d) =>
      d.agentId === "ceo" ? { ...d, messagingChannel: "telegram" as const } : d,
    ),
  };

  // The development list never holds a desk, so the sessions route is the only place the
  // binding is read from — with or without a chart.
  it("carries the sessions route's channel onto the desk it names, and nothing onto the rest", () => {
    const rows = deskRows(chart, bound);
    expect(rows[0]).toMatchObject({ agentId: "ceo", messagingChannel: "telegram" });
    expect(rows[1]).not.toHaveProperty("messagingChannel");
    expect(rows[2]).not.toHaveProperty("messagingChannel");
    expect(deskRows(null, bound).find((d) => d.agentId === "ceo")).toMatchObject({
      messagingChannel: "telegram",
    });
    // A desk only the chart names yet has no sessions-route row to be marked by.
    expect(deskRows(chart, { desks: [], tickets: [] })[0]).not.toHaveProperty("messagingChannel");
  });

  it("follows a bind, a switch of channel and an unbind written into the loaded answer", () => {
    const pm = (r: OrgSessionsResponse) => r.desks.find((d) => d.sessionId === "s-pm");
    const onPm = withDeskMessagingChannel(bound, "s-pm", "feishu");
    expect(pm(onPm)?.messagingChannel).toBe("feishu");
    expect(deskRows(chart, onPm)[1]).toMatchObject({ agentId: "pm", messagingChannel: "feishu" });
    // The input is left as it was: the store's previous copy is never written into.
    expect(pm(bound)).not.toHaveProperty("messagingChannel");

    expect(pm(withDeskMessagingChannel(onPm, "s-pm", "qq"))?.messagingChannel).toBe("qq");
    const off = withDeskMessagingChannel(onPm, "s-pm", null);
    expect(pm(off)).not.toHaveProperty("messagingChannel");
    expect(deskRows(chart, off)[1]).not.toHaveProperty("messagingChannel");
    // The other desk and the tickets ride through untouched.
    expect(off.desks.find((d) => d.agentId === "ceo")?.messagingChannel).toBe("telegram");
    expect(off.tickets).toBe(bound.tickets);
  });

  it("hands back the same answer when no desk is that Session or the mark already says so", () => {
    // A ticket session is not a desk: the sidebar draws no mark for it.
    expect(withDeskMessagingChannel(bound, "s-t1", "telegram")).toBe(bound);
    expect(withDeskMessagingChannel(bound, "s-ceo", "telegram")).toBe(bound);
    expect(withDeskMessagingChannel(bound, "s-pm", null)).toBe(bound);
  });
});

describe("ticketSessionTitles", () => {
  it("names the ticket sessions the route gave a title, across every ticket", () => {
    const titles = ticketSessionTitles(sessions);
    expect(titles.get("s-t2")).toBe("Write docs");
    expect(titles.get("s-t3")).toBe("Build the site");
    // Untitled yet, and a desk: neither is named, so the Temporary row keeps its own title.
    expect(titles.has("s-t1")).toBe(false);
    expect(titles.has("s-ceo")).toBe(false);
  });

  it("names nothing while the route has not been read", () => {
    expect(ticketSessionTitles(undefined).size).toBe(0);
  });
});

describe("orgRowActivity", () => {
  it("draws the live states and nothing when settled", () => {
    expect(orgRowActivity("running")).toBe("running");
    expect(orgRowActivity("compacting")).toBe("compacting");
    expect(orgRowActivity("idle")).toBeNull();
  });
});

describe("liveEmployeeStates", () => {
  it("reads every Session the organization attributes to an employee, live status first", () => {
    // The chart says the CEO is running; the live list has settled its desk and its ticket
    // session, so the employee has stopped.
    const states = liveEmployeeStates(
      chart.employees,
      sessions,
      liveStatuses({ "s-ceo": "idle", "s-t2": "idle", "s-pm": "idle", "s-t1": "idle" }),
    );
    expect([...states]).toEqual([
      ["ceo", "idle"],
      ["pm", "idle"],
      // Its only session (s-t3) is not loaded, so the snapshot's own status stands.
      ["dev", "idle"],
    ]);
  });

  it("is running while any of them is running or compacting", () => {
    // The CEO's desk has settled and one of its ticket sessions has started: it is at work.
    expect(
      liveEmployeeStates(chart.employees, sessions, liveStatuses({ "s-t2": "running" })).get("ceo"),
    ).toBe("running");
    // Compaction is work too, and here it is the desk that is doing it.
    expect(
      liveEmployeeStates(chart.employees, sessions, liveStatuses({ "s-pm": "compacting" })).get(
        "pm",
      ),
    ).toBe("running");
    // The chart's own desk id counts even before the sessions route lists that desk.
    expect(
      liveEmployeeStates(
        chart.employees,
        { desks: [], tickets: [] },
        liveStatuses({ "s-ceo": "running" }),
      ).get("ceo"),
    ).toBe("running");
  });

  it("falls back to the organization's snapshot, and then to the chart's own state", () => {
    // Nothing live at all: the sessions route still says the desk is compacting and one of the
    // ticket sessions is running.
    const states = liveEmployeeStates(chart.employees, sessions);
    expect(states.get("pm")).toBe("running");
    // The CEO's snapshot rows have all settled, so the chart's stale "running" gives way.
    expect(states.get("ceo")).toBe("idle");
    // No sessions listing at all: only the chart's own state is left to go on.
    expect(liveEmployeeStates(chart.employees, undefined).get("dev")).toBe("idle");
    expect(liveEmployeeStates(chart.employees, undefined).get("ceo")).toBe("running");
  });

  it("leaves a budget-paused employee paused, whatever its sessions are doing", () => {
    const paused = [{ agentId: "pm", state: "paused" as const, desk: { sessionId: "s-pm" } }];
    expect(
      liveEmployeeStates(paused, sessions, liveStatuses({ "s-pm": "running" })).get("pm"),
    ).toBe("paused");
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

describe("withoutOrgSessions", () => {
  const rows = [
    { sessionId: "a" },
    { sessionId: "s-ceo", orgId: "acme" },
    { sessionId: "b", client: "web" },
    { sessionId: "s-t1", orgId: "acme" },
    // Its organization is gone, so nothing resolves an orgId for it any more.
    { sessionId: "s-orphan", client: "org" },
  ];

  it("keeps the user's own rows in order and drops the organizations' by either mark", () => {
    expect(withoutOrgSessions(rows)).toEqual([
      { sessionId: "a" },
      { sessionId: "b", client: "web" },
    ]);
  });

  it("treats an empty orgId as no organization", () => {
    expect(withoutOrgSessions([{ sessionId: "a", orgId: "" }, { sessionId: "b" }])).toEqual([
      { sessionId: "a", orgId: "" },
      { sessionId: "b" },
    ]);
  });

  it("hides the organizations' rows whatever the company-mode switches say", () => {
    // There is no switch to pass: this list is the user's own conversations, and a Session
    // the scheduler drives is not one whether or not company mode is on screen.
    expect(withoutOrgSessions(rows).map((s) => s.sessionId)).toEqual(["a", "b"]);
  });
});
