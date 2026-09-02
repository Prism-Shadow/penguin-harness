/**
 * The company sidebar's session shaping (features/company/org-sessions.ts) and the
 * development sidebar's organization folder split (session-grouping's partitionOrgSessions):
 * desk rows titled by employee name in name order, ticket folders only for tickets that hold
 * a session, the running mark, the glyph a row draws, and the split of a group's active
 * conversations into the organization's and the user's own.
 */
import { describe, expect, it } from "vitest";
import type { OrgSessionsResponse } from "@prismshadow/penguin-server/api";
import {
  deskRows,
  orgRowActivity,
  orgSessionGroup,
  ticketFolders,
} from "../src/features/company/org-sessions";
import { partitionOrgSessions } from "../src/lib/session-grouping";

const res: OrgSessionsResponse = {
  desks: [
    { agentId: "pm", name: "Product", sessionId: "s-pm", status: "idle", workspace: "/w" },
    {
      agentId: "ceo",
      name: "Alice",
      sessionId: "s-ceo",
      status: "running",
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
        { sessionId: "s-t1", agentId: "pm", status: "compacting" },
        { sessionId: "s-t2", agentId: "ceo", status: "idle", title: "Write docs" },
      ],
    },
    { ticketId: "2026-09-empty", title: "Nothing yet", status: "proposed", sessions: [] },
  ],
};

describe("deskRows", () => {
  it("titles rows by employee name and sorts them by name", () => {
    expect(deskRows(res.desks)).toEqual([
      {
        sessionId: "s-ceo",
        agentId: "ceo",
        title: "Alice",
        status: "running",
        lastActiveAt: "2026-09-02T00:00:00Z",
      },
      { sessionId: "s-pm", agentId: "pm", title: "Product", status: "idle", lastActiveAt: null },
    ]);
  });
});

describe("ticketFolders and orgSessionGroup", () => {
  it("keeps only tickets holding a session and marks a folder running when any session is live", () => {
    const folders = ticketFolders(res.tickets);
    expect(folders.map((f) => f.ticketId)).toEqual(["2026-09-docs"]);
    expect(folders[0]!.running).toBe(true);
    expect(folders[0]!.sessions).toHaveLength(2);
  });

  it("counts desk rows plus ticket session rows for the group header", () => {
    expect(orgSessionGroup(res).count).toBe(4);
    expect(orgSessionGroup({ desks: [], tickets: [] }).count).toBe(0);
  });
});

describe("orgRowActivity", () => {
  it("draws the live states and nothing when settled", () => {
    expect(orgRowActivity("running")).toBe("running");
    expect(orgRowActivity("compacting")).toBe("compacting");
    expect(orgRowActivity("idle")).toBeNull();
  });
});

describe("partitionOrgSessions", () => {
  const rows = [
    { sessionId: "a" },
    { sessionId: "s-ceo" },
    { sessionId: "b" },
    { sessionId: "s-t1" },
  ];

  it("moves the organization's rows into their own list, keeping order on both sides", () => {
    expect(partitionOrgSessions(rows, new Set(["s-ceo", "s-t1", "unknown"]))).toEqual({
      active: [{ sessionId: "a" }, { sessionId: "b" }],
      organization: [{ sessionId: "s-ceo" }, { sessionId: "s-t1" }],
    });
  });

  it("an empty id set leaves every row where it was", () => {
    expect(partitionOrgSessions(rows, new Set())).toEqual({ active: rows, organization: [] });
  });
});
