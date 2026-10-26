/**
 * Following a delete's background removal on a progress card
 * (src/features/agents/agent-deletion-progress.ts), against the real endpoints and the UI
 * package's real card store, with the package's one fetch fake.
 *
 * - Given a removal that takes a while, the card follows the server's readings — a count with no
 *   bar yet, then removed out of total — and finishes when the server says done; the reads go to
 *   the server the Agent lived on.
 * - Given a deletion the server no longer knows (404), the card finishes: the Agent is gone.
 * - Given a removal that stops short, the card stays, failed, at the last reading.
 * - When the user closes the card, the reads stop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDeletionInfo } from "@prismshadow/penguin-server/api";
import { closeProgress, PROGRESS_REVEAL_MS, progressStore } from "@prismshadow/penguin-ui";
import {
  DELETION_POLL_MS,
  followAgentDeletion,
} from "../src/features/agents/agent-deletion-progress";
import { apiError, json, stubFetch } from "./helpers/fetch";

const START: AgentDeletionInfo = {
  deletionId: "writer-1761465600000",
  agentId: "writer",
  phase: "counting",
  total: 0,
  removed: 0,
};

const card = () => progressStore.getState().items[0];

/** Answers each read with the next reading, then keeps answering the last one. */
function readings(...list: AgentDeletionInfo[]) {
  let i = 0;
  return stubFetch(() => json({ deletion: list[Math.min(i++, list.length - 1)] }));
}

beforeEach(() => {
  vi.useFakeTimers();
  progressStore.setState({ items: [] });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  progressStore.setState({ items: [] });
});

describe("following an agent's removal", () => {
  it("follows the readings to the end, from the server the agent lived on", async () => {
    const fetch = readings(
      { ...START, total: 3000 },
      { ...START, phase: "removing", total: 9000, removed: 1200 },
      { ...START, phase: "done", total: 9000, removed: 9000 },
    );
    const done = followAgentDeletion({
      projectId: "p",
      machineId: "m1",
      name: "Writer",
      deletion: START,
    });

    await vi.advanceTimersByTimeAsync(PROGRESS_REVEAL_MS);
    expect(card()).toMatchObject({ shown: true, state: "running" });
    // Still counting: no amount yet, so the bar has no value.
    expect(card()?.value).toBeUndefined();
    await vi.advanceTimersByTimeAsync(DELETION_POLL_MS);
    expect(card()).toMatchObject({ state: "running", value: 1200, max: 9000 });
    await vi.advanceTimersByTimeAsync(DELETION_POLL_MS);
    await done;
    expect(card()?.state).toBe("done");
    expect(fetch.requests.map((r) => [r.machine, r.path])).toEqual(
      fetch.requests.map(() => ["m1", "/api/projects/p/agent-deletions/writer-1761465600000"]),
    );
  });

  it("finishes when the server no longer knows the deletion", async () => {
    let reads = 0;
    stubFetch(() =>
      reads++ === 0
        ? json({ deletion: { ...START, phase: "removing", total: 9000, removed: 10 } })
        : apiError(404, "agent_deletion_not_found"),
    );
    const done = followAgentDeletion({
      projectId: "p",
      machineId: null,
      name: "Writer",
      deletion: START,
    });
    await vi.advanceTimersByTimeAsync(PROGRESS_REVEAL_MS);
    expect(card()).toMatchObject({ shown: true, state: "running" });
    await vi.advanceTimersByTimeAsync(DELETION_POLL_MS);
    await done;
    expect(card()?.state).toBe("done");
  });

  it("stays, failed, when the removal stops short", async () => {
    readings({ ...START, phase: "failed", total: 9000, removed: 8999, error: "EBUSY: unlink" });
    const done = followAgentDeletion({
      projectId: "p",
      machineId: null,
      name: "Writer",
      deletion: START,
    });
    await vi.advanceTimersByTimeAsync(DELETION_POLL_MS);
    await done;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(card()).toMatchObject({ state: "failed", value: 8999, max: 9000, shown: true });
  });

  it("stops reading once the user closes the card", async () => {
    const fetch = readings({ ...START, phase: "removing", total: 9000, removed: 10 });
    const done = followAgentDeletion({
      projectId: "p",
      machineId: null,
      name: "Writer",
      deletion: START,
    });
    await vi.advanceTimersByTimeAsync(PROGRESS_REVEAL_MS);
    const reads = fetch.requests.length;
    expect(reads).toBeGreaterThan(0);
    closeProgress(card()!.id);
    await vi.advanceTimersByTimeAsync(DELETION_POLL_MS * 4);
    await done;
    expect(fetch.requests.length).toBeLessThanOrEqual(reads + 1);
  });
});
