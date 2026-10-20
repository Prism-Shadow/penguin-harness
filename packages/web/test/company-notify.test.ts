/**
 * Company push types (lib/company-notify.ts): the per-group preference store (defaults,
 * merge, corruption fallback), event → group mapping, notification content, and the
 * delivery gate matrix. The hook itself (state/use-company-notifications.ts) is wiring
 * over these units, covered by the true-machine probe instead.
 */
import { describe, expect, it } from "vitest";
import type { CompanyServerEvent, OrgTriggerKind } from "@prismshadow/penguin-server/api";
import {
  COMPANY_NOTIFY_GROUPS,
  NOTIFY_GROUP_DEFAULTS,
  describeCompanyEvent,
  groupOfCompanyEvent,
  readNotifyGroups,
  shouldNotifyCompanyEvent,
  writeNotifyGroups,
} from "../src/lib/company-notify";
import type { CompanyNotifyGate, CompanyNotifyGroup } from "../src/lib/company-notify";

function storageOf(initial?: Record<string, string>): {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
} {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

const ALL_ON: Record<CompanyNotifyGroup, boolean> = {
  mention: true,
  channel: true,
  ticket: true,
  run: true,
  budget: true,
};

const GATE: CompanyNotifyGate = {
  masterOn: true,
  groups: ALL_ON,
  permission: "granted",
  hidden: true,
  focused: false,
  self: false,
};

function channelEvent(over: Record<string, unknown> = {}): CompanyServerEvent {
  return {
    type: "org_channel",
    projectId: "p",
    orgId: "acme",
    channelId: "ch_site",
    message: {
      id: "m1",
      time: "2026-10-20T00:00:00.000Z",
      sender: "user:alice",
      hop: 0,
      text: "hello",
      mentions: [],
    },
    ...over,
  } as CompanyServerEvent;
}

describe("notify groups store", () => {
  it("starts at quiet defaults: mentions and budget on, streams off", () => {
    expect(NOTIFY_GROUP_DEFAULTS).toEqual({
      mention: true,
      channel: false,
      ticket: false,
      run: false,
      budget: true,
    });
    expect(readNotifyGroups(storageOf())).toEqual(NOTIFY_GROUP_DEFAULTS);
  });

  it("merges patches and keeps unknown keys out", () => {
    const storage = storageOf();
    writeNotifyGroups({ channel: true }, storage);
    expect(readNotifyGroups(storage)).toEqual({ ...NOTIFY_GROUP_DEFAULTS, channel: true });
    writeNotifyGroups({ mention: false }, storage);
    expect(readNotifyGroups(storage)).toEqual({
      ...NOTIFY_GROUP_DEFAULTS,
      channel: true,
      mention: false,
    });
  });

  it("falls back per key on corrupt, foreign or mistyped storage", () => {
    expect(readNotifyGroups(storageOf({ "penguin.notifications.groups": "nope{" }))).toEqual(
      NOTIFY_GROUP_DEFAULTS,
    );
    expect(readNotifyGroups(storageOf({ "penguin.notifications.groups": "[1]" }))).toEqual(
      NOTIFY_GROUP_DEFAULTS,
    );
    expect(
      readNotifyGroups(
        storageOf({
          "penguin.notifications.groups": JSON.stringify({
            mention: false,
            channel: "yes",
            future: true,
          }),
        }),
      ),
    ).toEqual({ ...NOTIFY_GROUP_DEFAULTS, mention: false });
  });

  it("covers every group exactly once", () => {
    expect([...COMPANY_NOTIFY_GROUPS].sort()).toEqual(Object.keys(NOTIFY_GROUP_DEFAULTS).sort());
  });
});

describe("groupOfCompanyEvent", () => {
  it("calls an addressed message a mention, any other message a channel event", () => {
    const addressed = channelEvent({
      message: {
        id: "m1",
        time: "2026-10-20T00:00:00.000Z",
        sender: "user:alice",
        hop: 0,
        text: "hi",
        mentions: ["user:bob", "agent:ceo"],
      },
    });
    expect(groupOfCompanyEvent(addressed, "bob")).toBe("mention");
    expect(groupOfCompanyEvent(addressed, "alice")).toBe("channel");
    expect(groupOfCompanyEvent(addressed, null)).toBe("channel");
    expect(groupOfCompanyEvent(channelEvent(), "bob")).toBe("channel");
  });

  it("maps ticket, run and budget families straight through", () => {
    expect(
      groupOfCompanyEvent(
        { type: "org_ticket", projectId: "p", orgId: "a", ticketId: "t", change: "created" },
        "bob",
      ),
    ).toBe("ticket");
    expect(
      groupOfCompanyEvent(
        {
          type: "org_run",
          projectId: "p",
          orgId: "a",
          agentId: "e",
          sessionId: "s",
          kind: "event",
        },
        "bob",
      ),
    ).toBe("run");
    expect(
      groupOfCompanyEvent(
        {
          type: "org_budget",
          projectId: "p",
          orgId: "a",
          agentId: "e",
          state: "warned",
          ratio: 0.9,
        },
        "bob",
      ),
    ).toBe("budget");
  });
});

describe("describeCompanyEvent", () => {
  it("names the channel, the sender and the snippet, and lands on the channel", () => {
    const content = describeCompanyEvent(
      channelEvent({
        message: {
          id: "m1",
          time: "2026-10-20T00:00:00.000Z",
          sender: "agent:ceo",
          hop: 0,
          text: "ship  it\nnow",
          mentions: ["user:bob"],
        },
      }),
      "mention",
    );
    expect(content.tag).toBe("penguin-mention-acme-ch_site");
    expect(content.path).toBe("/org/p/acme/channels/ch_site");
    expect(content.body).toContain("ceo");
    expect(content.body).toContain("ship it now");
  });

  it("falls back gracefully on empty text, unknown changes and unknown kinds", () => {
    const empty = describeCompanyEvent(
      channelEvent({
        message: {
          id: "m1",
          time: "2026-10-20T00:00:00.000Z",
          sender: "user:alice",
          hop: 0,
          text: "   ",
          mentions: [],
        },
      }),
      "channel",
    );
    expect(empty.body).toBe("alice");
    const ticket = describeCompanyEvent(
      { type: "org_ticket", projectId: "p", orgId: "a", ticketId: "t-1", change: "future-change" },
      "ticket",
    );
    expect(ticket.body).toBe("future-change");
    expect(ticket.path).toContain("tickets");
    const run = describeCompanyEvent(
      {
        type: "org_run",
        projectId: "p",
        orgId: "a",
        agentId: "e",
        sessionId: "s",
        kind: "future-kind" as OrgTriggerKind,
      },
      "run",
    );
    expect(run.body).toBe("future-kind");
    const budget = describeCompanyEvent(
      { type: "org_budget", projectId: "p", orgId: "a", agentId: "e", state: "paused", ratio: 1.2 },
      "budget",
    );
    expect(budget.body).toContain("120%");
    expect(budget.path).toContain("finance");
  });
});

describe("shouldNotifyCompanyEvent", () => {
  it("needs a group, the master, the group, permission and a backgrounded window", () => {
    expect(shouldNotifyCompanyEvent("mention", GATE)).toBe(true);
    expect(shouldNotifyCompanyEvent(null, GATE)).toBe(false);
    expect(shouldNotifyCompanyEvent("mention", { ...GATE, masterOn: false })).toBe(false);
    expect(
      shouldNotifyCompanyEvent("mention", { ...GATE, groups: { ...ALL_ON, mention: false } }),
    ).toBe(false);
    expect(shouldNotifyCompanyEvent("mention", { ...GATE, permission: "denied" })).toBe(false);
    expect(shouldNotifyCompanyEvent("mention", { ...GATE, permission: "default" })).toBe(false);
    expect(shouldNotifyCompanyEvent("mention", { ...GATE, permission: "unsupported" })).toBe(false);
  });

  it("never notifies the author, and never interrupts a focused window", () => {
    expect(shouldNotifyCompanyEvent("mention", { ...GATE, self: true })).toBe(false);
    expect(shouldNotifyCompanyEvent("mention", { ...GATE, hidden: false, focused: true })).toBe(
      false,
    );
    // Hidden wins over a stale focus flag; an unfocused-but-visible window still notifies.
    expect(shouldNotifyCompanyEvent("mention", { ...GATE, hidden: true, focused: true })).toBe(
      true,
    );
    expect(shouldNotifyCompanyEvent("mention", { ...GATE, hidden: false, focused: false })).toBe(
      true,
    );
  });
});
