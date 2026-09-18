/**
 * The details card's background-process list (src/features/chat/process-list.ts and its use in
 * chat-page.tsx): which entries "clear exited" removes, which failure of a batch of per-entry
 * requests reaches the user, and how a command too long for its row is read whole.
 *
 * The last part is a source scan, as in title-reveal.test.ts: vitest runs node-only here
 * (`environment: "node"`, no jsdom), and a native `title` creeping back onto the command line —
 * two tooltips over each other — is not something a rendered-markup assertion would see.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

describe("the process row's command line", () => {
  const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
  const chatPage = readFileSync(resolve(src, "features/chat/chat-page.tsx"), "utf8");

  it("shows a truncated command whole in the code tooltip, never in a native title", () => {
    expect(chatPage).toContain(
      '<Truncated text={p.cmd} className="font-mono text-xs" codeTooltip />',
    );
    expect(chatPage).not.toContain("title={p.cmd}");
  });

  it("clears exited entries through the same per-entry route a row's Remove uses", () => {
    expect(chatPage).toMatch(
      /runProcessAction\(exitedIds, api\.removeSessionProcess, \[404, 409\]\)/,
    );
    expect(chatPage).toMatch(
      /runProcessAction\(\[processId\], api\.removeSessionProcess, \[404, 409\]\)/,
    );
  });
});
