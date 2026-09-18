/**
 * state/company.tsx unit tests: the company store's routing of the scheduler's events (the
 * per-channel counters of the open organization and the totals the sidebar badges read, the
 * version bump each family causes, and what a local read mark clears), the open ticket every
 * company surface shares (the back stack a parent or a child pushes, and what closes it), what
 * it forgets when the organization list comes back without the organization it is aimed at,
 * a desk's messaging mark written into the loaded sessions route by a bind or an unbind, and the
 * user-channel forwarding in state/sessions.tsx's applyUserEvent — a company event reaches
 * every subscriber, a work run refreshes the session list of the Project it belongs to, and a
 * resync re-reads the company snapshots.
 */
import { describe, expect, it, vi } from "vitest";
import type {
  CompanyServerEvent,
  OrgChannelItem,
  OrgChannelMessage,
  OrgSessionsResponse,
  OrganizationSummary,
} from "@prismshadow/penguin-server/api";
import {
  createCompanyStore,
  isCompanyEvent,
  subscribeCompanyEvents,
  subscribeCompanyResync,
} from "../src/state/company";
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

/** One organization as the list carries it; only the two ids matter to the checks below. */
const summary = (projectId: string, orgId: string): OrganizationSummary => ({
  projectId,
  orgId,
  name: orgId,
  mission: "",
  status: "active",
  employeeCount: 0,
  runningCount: 0,
  pausedCount: 0,
  openTickets: 0,
  blockedTickets: 0,
  createdBy: "user:alice",
  spend: { period: "2026-09", cost: 0 },
});

describe("forgetting an organization the list no longer holds", () => {
  it("drops the open organization and the remembered one, and the channels read for it", () => {
    const store = createCompanyStore();
    store.setState({
      organizations: [summary("p1", "other")],
      orgsLoaded: true,
      orgsPartial: false,
      currentOrgKey: "p1/acme",
      lastOrgKey: "p1/acme",
      channels: [channel({ unread: 3 })],
      channelUnread: 3,
    });
    store.getState().forgetMissingOrganizations();
    expect(store.getState().currentOrgKey).toBeNull();
    expect(store.getState().lastOrgKey).toBeNull();
    // The listing belonged to the organization that is gone: a retry would only 404.
    expect(store.getState().channels).toBeNull();
    expect(store.getState().channelUnread).toBe(0);
  });

  it("keeps both when the organization is still listed", () => {
    const store = createCompanyStore();
    store.setState({
      organizations: [summary("p1", "acme"), summary("p2", "other")],
      orgsLoaded: true,
      orgsPartial: false,
      currentOrgKey: "p1/acme",
      lastOrgKey: "p1/acme",
      channels: [channel()],
    });
    store.getState().forgetMissingOrganizations();
    expect(store.getState().currentOrgKey).toBe("p1/acme");
    expect(store.getState().lastOrgKey).toBe("p1/acme");
    expect(store.getState().channels).not.toBeNull();
  });

  it("forgets the remembered organization on its own, with none open", () => {
    const store = createCompanyStore();
    store.setState({
      organizations: [],
      orgsLoaded: true,
      orgsPartial: false,
      currentOrgKey: null,
      lastOrgKey: "p1/acme",
    });
    store.getState().forgetMissingOrganizations();
    expect(store.getState().lastOrgKey).toBeNull();
  });

  it("waits for a settled and complete list — neither a first load nor a failed Project is a deletion", () => {
    for (const settling of [
      { orgsLoaded: false, orgsPartial: false },
      { orgsLoaded: true, orgsPartial: true },
    ]) {
      const store = createCompanyStore();
      store.setState({
        organizations: [],
        ...settling,
        currentOrgKey: "p1/acme",
        lastOrgKey: "p1/acme",
      });
      store.getState().forgetMissingOrganizations();
      expect(store.getState().currentOrgKey).toBe("p1/acme");
      expect(store.getState().lastOrgKey).toBe("p1/acme");
    }
  });
});

describe("a desk's messaging binding changed here", () => {
  const desks = (agentId: string, sessionId: string): OrgSessionsResponse => ({
    desks: [{ agentId, name: agentId, sessionId, status: "idle", workspace: "/w" }],
    tickets: [],
  });

  it("marks the desk in whichever organization holds it, and clears the mark on unbind", () => {
    const store = createCompanyStore();
    const other = desks("beta_ceo", "s-beta");
    store.setState({
      orgSessions: new Map([
        ["p1/acme", desks("acme_ceo", "s-acme")],
        ["p1/beta", other],
      ]),
    });
    store.getState().setDeskMessagingChannel("s-acme", "telegram");
    expect(store.getState().orgSessions.get("p1/acme")?.desks[0]?.messagingChannel).toBe(
      "telegram",
    );
    // The organization that does not hold the desk keeps its very answer.
    expect(store.getState().orgSessions.get("p1/beta")).toBe(other);

    store.getState().setDeskMessagingChannel("s-acme", null);
    expect(store.getState().orgSessions.get("p1/acme")?.desks[0]).not.toHaveProperty(
      "messagingChannel",
    );
  });

  it("sets nothing when no loaded desk is that Session", () => {
    const store = createCompanyStore();
    store.setState({ orgSessions: new Map([["p1/acme", desks("acme_ceo", "s-acme")]]) });
    const before = store.getState().orgSessions;
    store.getState().setDeskMessagingChannel("s-elsewhere", "qq");
    expect(store.getState().orgSessions).toBe(before);
  });
});

describe("the ticket dialog the whole shell shares", () => {
  const open = (store: ReturnType<typeof createCompanyStore>) => store.getState().ticketDialog;

  it("opens a ticket, stacks the ones followed from it, and walks back through them", () => {
    const store = createCompanyStore();
    store.getState().openTicket("p1", "acme", "t-1");
    expect(open(store)).toEqual({ projectId: "p1", orgId: "acme", ticketId: "t-1" });
    expect(store.getState().ticketStack).toEqual([]);

    // A child followed from inside the dialog leaves its parent on the stack.
    store.getState().openTicket("p1", "acme", "t-2");
    store.getState().openTicket("p1", "acme", "t-3");
    expect(open(store)?.ticketId).toBe("t-3");
    expect(store.getState().ticketStack).toEqual(["t-1", "t-2"]);

    store.getState().backTicket();
    expect(open(store)?.ticketId).toBe("t-2");
    expect(store.getState().ticketStack).toEqual(["t-1"]);
    store.getState().backTicket();
    expect(open(store)?.ticketId).toBe("t-1");
    expect(store.getState().ticketStack).toEqual([]);
    // Nothing left to go back to: the dialog stays on the ticket it is showing.
    store.getState().backTicket();
    expect(open(store)?.ticketId).toBe("t-1");
  });

  it("re-opening the ticket already shown changes nothing", () => {
    const store = createCompanyStore();
    store.getState().openTicket("p1", "acme", "t-1");
    store.getState().openTicket("p1", "acme", "t-2");
    // What the board does when it writes the open ticket back into its own query.
    store.getState().openTicket("p1", "acme", "t-2");
    expect(store.getState().ticketStack).toEqual(["t-1"]);
  });

  it("starts a fresh stack in another organization, and closing drops both", () => {
    const store = createCompanyStore();
    store.getState().openTicket("p1", "acme", "t-1");
    store.getState().openTicket("p1", "acme", "t-2");
    store.getState().openTicket("p1", "other", "t-9");
    expect(open(store)).toEqual({ projectId: "p1", orgId: "other", ticketId: "t-9" });
    expect(store.getState().ticketStack).toEqual([]);

    store.getState().closeTicket();
    expect(open(store)).toBeNull();
    expect(store.getState().ticketStack).toEqual([]);
  });

  it("closes with the organization the reader leaves", () => {
    const store = createCompanyStore();
    store.setState({ currentOrgKey: "p1/acme" });
    store.getState().openTicket("p1", "acme", "t-1");
    store.getState().openTicket("p1", "acme", "t-2");
    store.getState().setCurrentOrg("p1/other");
    expect(open(store)).toBeNull();
    expect(store.getState().ticketStack).toEqual([]);
  });

  it("a local ticket write bumps the versions the surfaces listing tickets watch", () => {
    const store = createCompanyStore();
    const before = store.getState().versions;
    store.getState().ticketsChanged();
    const after = store.getState().versions;
    expect(after.tickets).toBe(before.tickets + 1);
    expect(after.orgs).toBe(before.orgs + 1);
    expect(after.messages).toBe(before.messages);
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

  it("a resync has the company store re-read the snapshots its surfaces now fall back to", () => {
    const sessions = createSessionsStore();
    sessions.setState({ projectId: "p1", reload: vi.fn(() => Promise.resolve()) });
    const company = createCompanyStore();
    const stop = subscribeCompanyResync(() => company.getState().resync());
    try {
      applyUserEvent(sessions, { type: "resync_required" }, () => undefined);
      // `runs` re-reads the sessions route; `orgs` the organization list and the open chart.
      expect(company.getState().versions).toEqual({
        orgs: 1,
        messages: 0,
        tickets: 0,
        runs: 1,
        budget: 0,
      });
    } finally {
      stop();
    }
  });
});
