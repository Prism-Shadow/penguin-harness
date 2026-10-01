/**
 * The details card's background-process list (features/chat/process-list.ts).
 *
 * - "Clear exited" picks every exited entry in list order, and never a running one.
 * - Of a batch of per-entry requests, nothing is reported when all succeed or only failed
 *   with the action's own "stale list" statuses; otherwise the first other failure is
 *   reported once, a network failure included.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client";
import { exitedProcessIds, reportableProcessFailure } from "../src/features/chat/process-list";

const row = (processId: string, running: boolean) => ({ processId, running });

const rejected = (reason: unknown): PromiseSettledResult<unknown> => ({
  status: "rejected",
  reason,
});
const fulfilled: PromiseSettledResult<unknown> = { status: "fulfilled", value: undefined };

describe("exitedProcessIds", () => {
  it("picks every exited entry, in list order", () => {
    expect(
      exitedProcessIds([row("p1", false), row("p2", true), row("p3", false), row("p4", true)]),
    ).toEqual(["p1", "p3"]);
  });

  it("never picks a running entry, so a list with nothing exited offers nothing to clear", () => {
    expect(exitedProcessIds([row("p1", true), row("p2", true)])).toEqual([]);
    expect(exitedProcessIds([])).toEqual([]);
  });
});

describe("reportableProcessFailure", () => {
  const REMOVE_STALE = [404, 409];

  it("reports nothing when every request succeeded", () => {
    expect(reportableProcessFailure([fulfilled, fulfilled], REMOVE_STALE)).toBeNull();
  });

  it("swallows the statuses that only mean the list was stale", () => {
    // An entry already gone (404) or one that turned out to be running (409): the refresh
    // after the batch shows the truth, so neither is an error.
    const gone = new ApiError(404, "process_not_found", "gone");
    const running = new ApiError(409, "process_running", "running");
    expect(
      reportableProcessFailure([rejected(gone), fulfilled, rejected(running)], REMOVE_STALE),
    ).toBeNull();
  });

  it("reports the first other failure once, however many requests it failed", () => {
    const denied = new ApiError(401, "unauthorized", "first");
    const deniedAgain = new ApiError(401, "unauthorized", "second");
    const failure = reportableProcessFailure(
      [
        rejected(new ApiError(404, "process_not_found", "gone")),
        rejected(denied),
        rejected(deniedAgain),
      ],
      REMOVE_STALE,
    );
    expect(failure).toEqual({ error: denied });
  });

  it("reports a failure that never reached the server", () => {
    const network = new TypeError("Failed to fetch");
    expect(reportableProcessFailure([rejected(network)], REMOVE_STALE)).toEqual({
      error: network,
    });
  });

  it("judges staleness by the action's own statuses", () => {
    // Stop treats only 404 as stale: a 409 there is a real refusal worth saying.
    const conflict = new ApiError(409, "process_running", "running");
    expect(reportableProcessFailure([rejected(conflict)], [404])).toEqual({ error: conflict });
  });
});
