/**
 * state/company.tsx unit tests: the company store's routing of the scheduler's events (the
 * chat counters of the open organization, the version bump each family causes) and the
 * user-channel forwarding in state/sessions.tsx's applyUserEvent — a company event reaches
 * every subscriber, and a work run refreshes the session list of the Project it belongs to.
 */
import { describe, expect, it, vi } from "vitest";
import type { CompanyServerEvent, OrgChatMessage } from "@prismshadow/penguin-server/api";
import { createCompanyStore, isCompanyEvent, subscribeCompanyEvents } from "../src/state/company";
import { applyUserEvent, createSessionsStore } from "../src/state/sessions";

const message = (over: Partial<OrgChatMessage> = {}): OrgChatMessage => ({
  id: "m-1",
  time: "2026-09-02T00:00:00Z",
  sender: "agent:ceo",
  hop: 0,
  text: "hello",
  mentions: [],
  ...over,
});

const chat = (over: Partial<OrgChatMessage> = {}): CompanyServerEvent => ({
  type: "org_chat",
  projectId: "p1",
  orgId: "acme",
  channelId: "all",
  message: message(over),
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
    expect(isCompanyEvent(chat())).toBe(true);
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
  it("counts unread and @me messages of the open organization only, never the user's own", () => {
    const store = createCompanyStore();
    store.getState().applyCompanyEvent(chat(), "alice");
    // Nothing is open yet: no counter moves, the chat version does.
    expect(store.getState().chatUnread).toBe(0);
    expect(store.getState().versions.chat).toBe(1);

    store.setState({ currentOrgKey: "p1/acme" });
    store.getState().applyCompanyEvent(chat({ id: "m-2" }), "alice");
    store.getState().applyCompanyEvent(chat({ id: "m-3", mentions: ["user:alice"] }), "alice");
    store.getState().applyCompanyEvent(chat({ id: "m-4", mentions: ["all"] }), "alice");
    store
      .getState()
      .applyCompanyEvent(chat({ id: "m-5", sender: "user:alice", mentions: ["all"] }), "alice");
    expect(store.getState().chatUnread).toBe(3);
    expect(store.getState().chatMentions).toBe(2);

    // Another organization's chat moves the version, not this organization's counters.
    store.getState().applyCompanyEvent({ ...chat({ id: "m-6" }), orgId: "other" }, "alice");
    expect(store.getState().chatUnread).toBe(3);
    expect(store.getState().versions.chat).toBe(6);

    store.getState().setChatCounters(0, 0);
    expect(store.getState().chatUnread).toBe(0);
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
    expect(store.getState().versions).toEqual({ orgs: 3, chat: 0, tickets: 1, runs: 1, budget: 1 });
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
      applyUserEvent(sessions, chat(), () => undefined);
      expect(seen.map((e) => e.type)).toEqual(["org_run", "org_run", "org_chat"]);
      // Only the run of the current Project refreshes; a chat message changes no session row.
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });
});
