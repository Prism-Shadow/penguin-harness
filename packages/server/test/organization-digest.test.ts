/**
 * The "Since your last sweep" section: the queued ticket changes as the employee reads them
 * at the end of its next calendar event. Pure input, pure output — the delivery rule itself
 * (nothing is sent when a ticket changes) is exercised in `organization-runtime.test.ts`.
 */
import { describe, expect, it } from "vitest";
import type { OrgTicketChange } from "../src/api/types.js";
import type { OrgDeskNoticeRow } from "../src/db/repos/organizations.js";
import type { TicketDoc } from "../src/organization/files.js";
import { deskDigest } from "../src/runtime/organization/digest.js";
import type { DigestTicket } from "../src/runtime/organization/digest.js";

let seq = 0;

function row(agentId: string, ticketId: string, change: OrgTicketChange): OrgDeskNoticeRow {
  seq += 1;
  return {
    seq,
    projectId: "p1",
    orgId: "acme",
    agentId,
    ticketId,
    change,
    at: "2026-09-08T01:00:00Z",
  };
}

function ticket(ticketId: string, title: string, doc: Partial<TicketDoc> = {}): DigestTicket {
  return {
    ticketId,
    doc: {
      title,
      status: "in_progress",
      initiator: "user:alice",
      notify: [],
      priority: "P1",
      sessions: [],
      goal: "",
      acceptanceCriteria: "",
      progress: [],
      result: "",
      extraHeaders: [],
      extraSections: [],
      ...doc,
    },
  };
}

describe("deskDigest", () => {
  it("says nothing when nothing is queued", () => {
    expect(deskDigest([], [ticket("2026-09-08-site", "Launch the marketing site")])).toBe("");
  });

  it("lists one line per change in queue order, with the reason or blocker the ticket carries", () => {
    const tickets = [
      ticket("2026-09-08-site-launch", "Launch the marketing site"),
      ticket("2026-09-08-domain", "Register the domain", {
        blocked: "waiting for the board",
        blockedBy: "user:alice",
      }),
      ticket("2026-09-08-backend-api", "Backend API", {
        blocked: "waiting for the domain",
        blockedBy: "2026-09-08-domain",
      }),
      ticket("2026-09-07-copy", "Site copy", { status: "done" }),
      ticket("2026-09-07-logo", "Logo", { status: "rejected", result: "off-brand" }),
    ];
    const rows = [
      row("acme_dev", "2026-09-08-site-launch", "assigned"),
      row("acme_dev", "2026-09-08-domain", "blocked"),
      row("acme_dev", "2026-09-08-backend-api", "blocker_closed"),
      row("acme_dev", "2026-09-07-copy", "done"),
      row("acme_dev", "2026-09-07-logo", "rejected"),
    ];
    expect(deskDigest(rows, tickets)).toBe(
      [
        "## Since your last sweep",
        "- 2026-09-08-site-launch (Launch the marketing site): assigned to you",
        '- 2026-09-08-domain (Register the domain): blocked — "waiting for the board" (by user:alice)',
        "- 2026-09-08-backend-api (Backend API): blocker closed (2026-09-08-domain) — verify, then `penguin org ticket unblock 2026-09-08-backend-api`",
        "- 2026-09-07-copy (Site copy): done",
        '- 2026-09-07-logo (Logo): rejected — "off-brand"',
        "",
        'Decide on each: start a ticket session (`penguin org ticket start <id> -m "…"`), verify and unblock, or leave it — do not do the work at your desk.',
      ].join("\n"),
    );
  });

  it("names a ticket whose file is gone, and asks for no command on it", () => {
    const rows = [
      row("acme_dev", "2026-09-01-deleted", "assigned"),
      row("acme_dev", "2026-09-01-also-gone", "blocker_closed"),
    ];
    const lines = deskDigest(rows, []).split("\n");
    expect(lines[1]).toBe("- 2026-09-01-deleted (ticket removed): assigned to you");
    expect(lines[2]).toBe("- 2026-09-01-also-gone (ticket removed): blocker closed");
  });

  it("takes one line of a long reason, capped, so a list item stays a list item", () => {
    const reason = `${"a".repeat(200)}\nthe second line`;
    const rows = [row("acme_dev", "2026-09-01-long", "rejected")];
    const line = deskDigest(rows, [
      ticket("2026-09-01-long", "Long", { status: "rejected", result: reason }),
    ]).split("\n")[1]!;
    expect(line).toBe(`- 2026-09-01-long (Long): rejected — "${"a".repeat(119)}…"`);
    expect(line).not.toContain("the second line");
  });
});
