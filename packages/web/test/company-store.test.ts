/**
 * state/company.tsx unit tests: the company store's routing of the scheduler's events (the
 * per-channel counters of the open organization and the totals the sidebar badges read, the
 * version bump each family causes, and what a local read mark clears) and the user-channel
 * forwarding in state/sessions.tsx's applyUserEvent — a company event reaches every
 * subscriber, and a work run refreshes the session list of the Project it belongs to.
 */
import { describe, expect, it, vi } from "vitest";
import type {
  CompanyServerEvent,
  OrgChannelItem,
  OrgChannelMessage,
} from "@prismshadow/penguin-server/api";
import { createCompanyStore, isCompanyEvent, subscribeCompanyEvents } from "../src/state/company";
import { applyUserEvent, createSessionsStore } from "../src/state/sessions";

const message = (over: Partial<OrgChannelMessage> = {}): OrgChannelMessage => ({
  id: "m-1",
  time: "2026-09-02T00:00:00Z",
  sender: "agent:ceo",
  hop: 0,
  text: "hello",
  mentions: [],
  ...over,
});

const posted = (
  over: Partial<OrgChannelMessage> = {},
  channelId = "default_channel",
): CompanyServerEvent => ({
  type: "org_channel",
  projectId: "p1",
  orgId: "acme",
  channelId,
  message: message(over),
});

const channel = (over: Partial<OrgChannelItem> = {}): OrgChannelItem => ({
  channelId: "default_channel",
  name: "All hands",
  purpose: "",
  everyone: true,
  archived: false,
  createdBy: "system",
  createdAt: "2026-09-02T00:00:00Z",
  memberCount: 2,
  isMember: true,
  unread: 0,
  mentionsMe: 0,
  lastMessageAt: null,
  ...over,
});

describe("isCompanyEvent", () => {
  it("recognizes the four organization families and nothing else", () => {
    expect(
      isCompanyEvent({
        type: "org_run",
        projectId: "p",
        orgId: "o",
        agentId: "a",
        sessionId: "s",
        kind: "event",
      }),
    ).toBe(true);
    expect(isCompanyEvent(posted())).toBe(true);
    expect(
      isCompanyEvent({
        type: "org_ticket",
        projectId: "p",
        orgId: "o",
        ticketId: "t",
        change: "moved",
      }),
    ).toBe(true);
    expect(
      isCompanyEvent({
        type: "org_budget",
        projectId: "p",
        orgId: "o",
        agentId: "a",
        state: "warned",
        ratio: 0.8,
      }),
    ).toBe(true);
    expect(isCompanyEvent({ type: "hello" })).toBe(false);
    expect(isCompanyEvent({ type: "web_updated", rev: "1" })).toBe(false);
  });
});

describe("company store event routing", () => {
  it("counts unread and @me per channel of the open organization only, never the user's own", () => {
    const store = createCompanyStore();
    store.getState().applyCompanyEvent(posted(), "alice");
    // Nothing is open yet: no counter moves, the message version does.
    expect(store.getState().channelUnread).toBe(0);
    expect(store.getState().versions.messages).toBe(1);

    store.setState({
      currentOrgKey: "p1/acme",
      channels: [channel(), channel({ channelId: "site", name: "Site", everyone: false })],
      channelUnread: 0,
      channelMentions: 0,
    });
    store.getState().applyCompanyEvent(posted({ id: "m-2" }), "alice");
    store.getState().applyCompanyEvent(posted({ id: "m-3", mentions: ["user:alice"] }), "alice");
    // `all` is not a personal mention: the server's listing counts only `user:<id>`, and the
    // optimistic bump has to agree with it or the badge jumps on the next refresh.
    store.getState().applyCompanyEvent(posted({ id: "m-4", mentions: ["all"] }), "alice");
    store
      .getState()
      .applyCompanyEvent(posted({ id: "m-5", sender: "user:alice", mentions: ["all"] }), "alice");
    store.getState().applyCompanyEvent(posted({ id: "m-6" }, "site"), "alice");
    expect(store.getState().channels?.map((c) => c.unread)).toEqual([3, 1]);
    expect(store.getState().channelUnread).toBe(4);
    expect(store.getState().channelMentions).toBe(1);

    // Another organization's message moves the version, not this organization's counters.
    store.getState().applyCompanyEvent({ ...posted({ id: "m-7" }), orgId: "other" }, "alice");
    expect(store.getState().channelUnread).toBe(4);
    expect(store.getState().versions.messages).toBe(7);

    // Reading one channel clears that channel alone.
    store.getState().markChannelRead("default_channel");
    expect(store.getState().channelUnread).toBe(1);
    expect(store.getState().channelMentions).toBe(0);
  });

  it("leaves a channel the user is not in — and one it does not know — out of the badge", () => {
    const store = createCompanyStore();
    store.setState({
      currentOrgKey: "p1/acme",
      channels: [channel({ channelId: "site", name: "Site", everyone: false, isMember: false })],
    });
    store.getState().applyCompanyEvent(posted({ id: "m-2" }, "site"), "alice");
    store.getState().applyCompanyEvent(posted({ id: "m-3" }, "unknown_channel"), "alice");
    expect(store.getState().channels?.[0]?.unread).toBe(0);
    expect(store.getState().channelUnread).toBe(0);
    // Both messages still moved the version, which is what re-reads the listing.
    expect(store.getState().versions.messages).toBe(2);
  });

  it("drops the open organization's channels and roster when another one is opened", () => {
    const store = createCompanyStore();
    store.setState({
      currentOrgKey: "p1/acme",
      channels: [channel({ unread: 3 })],
      channelUnread: 3,
      orgChart: { ceoAgentId: "ceo", employees: [] },
      orgChartError: "boom",
    });
    store.getState().setCurrentOrg("p1/other");
    expect(store.getState().channels).toBeNull();
    expect(store.getState().channelUnread).toBe(0);
    // The 工位 group's roster belongs to the organization it was read for.
    expect(store.getState().orgChart).toBeNull();
    expect(store.getState().orgChartError).toBeNull();
  });

  it("bumps the version of each family, and the organization list for the ones that change a summary", () => {
    const store = createCompanyStore();
    store.getState().applyCompanyEvent(
      {
        type: "org_run",
        projectId: "p",
        orgId: "o",
        agentId: "a",
        sessionId: "s",
        kind: "event",
      },
      null,
    );
    store
      .getState()
      .applyCompanyEvent(
        { type: "org_ticket", projectId: "p", orgId: "o", ticketId: "t", change: "moved" },
        null,
      );
    store
      .getState()
      .applyCompanyEvent(
        { type: "org_budget", projectId: "p", orgId: "o", agentId: "a", state: "paused", ratio: 1 },
        null,
      );
    expect(store.getState().versions).toEqual({
      orgs: 3,
      messages: 0,
      tickets: 1,
      runs: 1,
      budget: 1,
    });
  });
});

describe("applyUserEvent forwarding", () => {
  it("publishes a company event to every subscriber and refreshes the list on a work run of the current Project", () => {
    const sessions = createSessionsStore();
    const reload = vi.fn(() => Promise.resolve());
    sessions.setState({ projectId: "p1", reload });
    const seen: CompanyServerEvent[] = [];
    const stop = subscribeCompanyEvents((ev) => seen.push(ev));
    try {
      const run: CompanyServerEvent = {
        type: "org_run",
        projectId: "p1",
        orgId: "acme",
        agentId: "ceo",
        sessionId: "s",
        kind: "init",
      };
      applyUserEvent(sessions, run, () => undefined);
      applyUserEvent(sessions, { ...run, projectId: "p2" }, () => undefined);
      applyUserEvent(sessions, posted(), () => undefined);
      expect(seen.map((e) => e.type)).toEqual(["org_run", "org_run", "org_channel"]);
      // Only the run of the current Project refreshes; a channel message changes no session row.
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });
});
