/**
 * state/company.tsx with state/proposals-retry.ts: a failed read of the open organization's proposals is read again on its
 * own, backing off, until one answers — the index behind every roadmap row's pill must not stay
 * empty for as long as the event that would re-read it is not arriving. A retry stops when the
 * organization is left or the plugin goes, and a read that starts for another reason replaces
 * the one waiting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProposalItem } from "@prismshadow/penguin-server/api";

const listOrgProposals = vi.fn<(projectId: string, orgId: string) => Promise<unknown>>();
vi.mock("../src/api/endpoints", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/api/endpoints")>()),
  listOrgProposals: (projectId: string, orgId: string) => listOrgProposals(projectId, orgId),
}));

const { createCompanyStore } = await import("../src/state/company");
const { PROPOSALS_RETRY_MAX_MS, PROPOSALS_RETRY_MIN_MS } =
  await import("../src/state/proposals-retry");

const item = { number: 105, title: "Right column", status: "ready", unread: 0 } as ProposalItem;
const down = () => Promise.reject(new Error("no socket handshake in 10000 ms"));

/** A store with the plugin installed and organization `acme` of Project `p1` open. */
const open = () => {
  const store = createCompanyStore();
  store.setState({ proposalsEnabled: true });
  store.getState().setCurrentOrg("p1/acme");
  return store;
};

/** Lets the pending read settle. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  listOrgProposals.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a failed proposals read", () => {
  it("is read again, backing off, until the list answers", async () => {
    listOrgProposals
      .mockImplementationOnce(down)
      .mockImplementationOnce(down)
      .mockResolvedValue({ proposals: [item] });
    const store = open();
    await store.getState().reloadProposals("p1", "acme");
    expect(store.getState().proposals).toBeNull();
    expect(store.getState().proposalsError).not.toBeNull();
    expect(listOrgProposals).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(PROPOSALS_RETRY_MIN_MS - 1);
    expect(listOrgProposals).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(listOrgProposals).toHaveBeenCalledTimes(2);
    expect(store.getState().proposals).toBeNull();

    // The second wait is twice the first.
    await vi.advanceTimersByTimeAsync(PROPOSALS_RETRY_MIN_MS * 2 - 1);
    expect(listOrgProposals).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(listOrgProposals).toHaveBeenCalledTimes(3);
    expect(store.getState().proposals).toEqual([item]);
    expect(store.getState().proposalsError).toBeNull();

    // An answer ends the retries.
    await vi.advanceTimersByTimeAsync(PROPOSALS_RETRY_MAX_MS * 4);
    expect(listOrgProposals).toHaveBeenCalledTimes(3);
  });

  it("never waits longer than the ceiling between two reads", async () => {
    listOrgProposals.mockImplementation(down);
    const store = open();
    await store.getState().reloadProposals("p1", "acme");
    for (let at = 0; at < 8; at += 1) await vi.advanceTimersByTimeAsync(PROPOSALS_RETRY_MAX_MS);
    const before = listOrgProposals.mock.calls.length;
    await vi.advanceTimersByTimeAsync(PROPOSALS_RETRY_MAX_MS);
    expect(listOrgProposals.mock.calls.length).toBe(before + 1);
  });

  it("is not read again once the organization is left", async () => {
    listOrgProposals.mockImplementation(down);
    const store = open();
    await store.getState().reloadProposals("p1", "acme");
    store.getState().setCurrentOrg("p1/other");
    await vi.advanceTimersByTimeAsync(PROPOSALS_RETRY_MAX_MS * 4);
    expect(listOrgProposals).toHaveBeenCalledTimes(1);
  });

  it("is not read again once the plugin's page is gone", async () => {
    listOrgProposals.mockImplementation(down);
    const store = open();
    await store.getState().reloadProposals("p1", "acme");
    store.getState().setProposalsEnabled(false);
    await vi.advanceTimersByTimeAsync(PROPOSALS_RETRY_MAX_MS * 4);
    expect(listOrgProposals).toHaveBeenCalledTimes(1);
  });

  it("gives way to a read that starts for another reason: one retry at a time, never two", async () => {
    listOrgProposals.mockImplementation(down);
    const store = open();
    await store.getState().reloadProposals("p1", "acme");
    // An event (or a machine coming back) reads again before the retry is due.
    await store.getState().reloadProposals("p1", "acme");
    expect(listOrgProposals).toHaveBeenCalledTimes(2);
    // Two failures in a row: the next wait is the doubled one, and only one read is waiting.
    await vi.advanceTimersByTimeAsync(PROPOSALS_RETRY_MIN_MS * 2);
    expect(listOrgProposals).toHaveBeenCalledTimes(3);
    await settle();
    expect(listOrgProposals).toHaveBeenCalledTimes(3);
  });
});
