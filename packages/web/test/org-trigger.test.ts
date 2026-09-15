/**
 * The `[org_trigger]` banner's summary (features/chat/org-trigger.ts): built from core's
 * own marker so the two cannot drift — the kind, the identifying subject per kind, the
 * employee's id in front of its parenthesis, the fire time and the budget line; plus the
 * parse chain's place for it in user-message-body (a trigger is never the user's own text).
 */
import { describe, expect, it } from "vitest";
import { buildOrgTriggerMessage } from "@prismshadow/penguin-core/markers";
import {
  orgTriggerAgentId,
  parseOrgTriggerMessage,
  summarizeOrgTrigger,
} from "../src/features/chat/org-trigger";
import { parseUserMessageBody } from "../src/features/chat/user-message-body";

describe("summarizeOrgTrigger", () => {
  it("names the event and its fire time for a calendar trigger", () => {
    const text = buildOrgTriggerMessage(
      {
        org: "acme",
        employee: "pm (Product manager, reports to ceo)",
        kind: "event",
        event: "daily_standup",
        firedAt: "2026-09-02T01:00:00Z",
        budget: "$1.20 / $50",
      },
      "Check the board.",
    );
    const parsed = parseOrgTriggerMessage(text);
    expect(parsed).not.toBeNull();
    expect(summarizeOrgTrigger(parsed!.origin)).toEqual({
      org: "acme",
      kind: "event",
      agentId: "pm",
      subject: "daily_standup",
      change: null,
      firedAt: "2026-09-02T01:00:00Z",
      budget: "$1.20 / $50",
    });
    expect(parsed!.rest).toBe("Check the board.");
  });

  it("names the message for a mention, the ticket and change for a notice, the ticket for work, nothing for init", () => {
    const summary = (origin: Parameters<typeof buildOrgTriggerMessage>[0]) =>
      summarizeOrgTrigger(parseOrgTriggerMessage(buildOrgTriggerMessage(origin, ""))!.origin);
    expect(
      summary({ org: "o", employee: "ceo", kind: "mention", message: "m-1 from user:alice" }),
    ).toMatchObject({
      subject: "m-1 from user:alice",
      change: null,
      firedAt: null,
    });
    expect(
      summary({
        org: "o",
        employee: "ceo",
        kind: "ticket_notice",
        ticket: "2026-09-docs",
        change: "assigned",
      }),
    ).toMatchObject({ subject: "2026-09-docs", change: "assigned" });
    expect(
      summary({
        org: "o",
        employee: "ceo",
        kind: "ticket_work",
        ticket: "2026-09-docs",
        change: "done",
      }),
    ).toMatchObject({
      subject: "2026-09-docs",
      change: null,
    });
    expect(summary({ org: "o", employee: "ceo", kind: "init" })).toMatchObject({
      subject: null,
      budget: null,
    });
  });

  it("reads the agent id off the employee line with or without its parenthesis", () => {
    expect(orgTriggerAgentId("ceo")).toBe("ceo");
    expect(orgTriggerAgentId("pm (Product manager, reports to ceo)")).toBe("pm");
  });
});

describe("parseUserMessageBody with an organization trigger", () => {
  it("strips the block, keeps the body and flags the message as a trigger", () => {
    const text = buildOrgTriggerMessage(
      { org: "o", employee: "ceo", kind: "init" },
      "Confirm the mission.",
    );
    expect(parseUserMessageBody(text)).toEqual({
      body: "Confirm the mission.",
      scheduled: false,
      orgTrigger: true,
    });
  });

  it("leaves an ordinary message untouched", () => {
    expect(parseUserMessageBody("hello")).toEqual({ body: "hello", scheduled: false });
  });
});
