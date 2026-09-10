/**
 * Structured `system` lines: each builder returns the English sentence and its structured
 * twin together, and a message line carries the notice through the file and back. A line
 * written before the field existed still parses, and a kind this build does not know is
 * carried as written rather than rejected.
 */
import { describe, expect, it } from "vitest";
import { parseChannelMessageLine, serializeChannelMessageLine } from "../src/organization/files.js";
import {
  budgetPaused,
  budgetWarned,
  channelArchiveChanged,
  channelCreated,
  channelMemberAdded,
  channelMemberRemoved,
  employeeJoined,
  employeeLeft,
  systemMessage,
  ticketState,
} from "../src/runtime/organization/notices.js";

const ID = "msg-2026-09-01-10-00-00-0000000a";

describe("organization system notices", () => {
  it("builds the sentence and the structure from the same facts", () => {
    expect(employeeJoined("agent:acme_hr", "HR", "agent:acme_ceo")).toEqual({
      text: "agent:acme_hr joined as HR, reporting to agent:acme_ceo.",
      notice: {
        kind: "employee_joined",
        params: { agent: "agent:acme_hr", title: "HR", reportsTo: "agent:acme_ceo" },
      },
    });
    expect(employeeLeft("agent:acme_hr", "agent:acme_ceo").notice.kind).toBe("employee_left");
    expect(channelCreated("user:alice").notice).toEqual({
      kind: "channel_created",
      params: { by: "user:alice" },
    });
    expect(channelArchiveChanged("user:alice", true).notice.kind).toBe("channel_archived");
    expect(channelArchiveChanged("user:alice", false).notice.kind).toBe("channel_unarchived");
  });

  it("distinguishes joining from being invited, and leaving from being removed", () => {
    expect(channelMemberAdded("user:alice", "user:alice")).toEqual({
      text: "user:alice joined the channel.",
      notice: { kind: "channel_joined", params: { principal: "user:alice" } },
    });
    expect(channelMemberAdded("user:alice", "agent:acme_hr")).toEqual({
      text: "user:alice invited agent:acme_hr to the channel.",
      notice: {
        kind: "channel_invited",
        params: { by: "user:alice", principal: "agent:acme_hr" },
      },
    });
    expect(channelMemberRemoved("agent:acme_hr", "agent:acme_hr").notice.kind).toBe("channel_left");
    expect(channelMemberRemoved("user:alice", "agent:acme_hr").notice.kind).toBe("channel_removed");
  });

  it("carries the budget figures as the sentence prints them", () => {
    const facts = { agent: "agent:acme_hr", period: "2026-09", percent: 85, cost: 8.5, budget: 10 };
    expect(budgetWarned(facts)).toEqual({
      text: "Budget warning: agent:acme_hr has used 85% of its 2026-09 budget (8.50 / 10.00 USD).",
      notice: {
        kind: "budget_warned",
        params: {
          agent: "agent:acme_hr",
          period: "2026-09",
          percent: "85",
          cost: "8.50",
          budget: "10.00",
        },
      },
    });
    expect(budgetPaused(facts).text).toContain("Budget pause: agent:acme_hr reached 85%");
    expect(budgetPaused(facts).notice.kind).toBe("budget_paused");
  });

  it("writes a ticket's closing line with or without mentions", () => {
    expect(ticketState("ticket_done", "2026-09-01-site", "Site", [])).toEqual({
      text: "Ticket 2026-09-01-site (Site) is now done",
      notice: { kind: "ticket_done", params: { ticket: "2026-09-01-site", title: "Site" } },
    });
    expect(ticketState("ticket_rejected", "2026-09-01-site", "Site", ["user:alice"]).text).toBe(
      "Ticket 2026-09-01-site (Site) is now rejected: @user:alice",
    );
    expect(ticketState("ticket_blocked", "2026-09-01-site", "Site", []).notice.kind).toBe(
      "ticket_blocked",
    );
  });

  it("round-trips a notice through a message line", () => {
    const msg = {
      id: ID,
      time: "2026-09-01T10:00:00.000Z",
      ...systemMessage(employeeJoined("agent:acme_hr", "HR", "agent:acme_ceo")),
      refs: { ticket: "2026-09-01-site" },
    };
    const parsed = parseChannelMessageLine(serializeChannelMessageLine(msg));
    expect(parsed).toEqual({ ok: true, value: msg });
  });

  it("parses a line written before the field existed, and keeps a kind it does not know", () => {
    const base = {
      id: ID,
      time: "2026-09-01T10:00:00.000Z",
      sender: "system",
      hop: 0,
      text: "agent:acme_hr joined as HR, reporting to agent:acme_ceo.",
      mentions: [],
    };
    const old = parseChannelMessageLine(JSON.stringify(base));
    expect(old).toEqual({ ok: true, value: base });
    // A newer server's kind still parses; the client falls back to `text` for it.
    const future = parseChannelMessageLine(
      JSON.stringify({ ...base, notice: { kind: "office_moved", params: { to: "Berlin" } } }),
    );
    expect(future).toMatchObject({
      ok: true,
      value: { notice: { kind: "office_moved", params: { to: "Berlin" } } },
    });
    // Params default to none, and a malformed notice is a malformed line.
    expect(parseChannelMessageLine(JSON.stringify({ ...base, notice: { kind: "x" } }))).toEqual({
      ok: true,
      value: { ...base, notice: { kind: "x", params: {} } },
    });
    for (const notice of [
      { params: {} },
      { kind: "", params: {} },
      { kind: "x", params: [] },
      "x",
    ]) {
      expect(parseChannelMessageLine(JSON.stringify({ ...base, notice }))).toMatchObject({
        ok: false,
      });
    }
    expect(
      parseChannelMessageLine(JSON.stringify({ ...base, notice: { kind: "x", params: { n: 1 } } })),
    ).toMatchObject({ ok: false });
  });
});
