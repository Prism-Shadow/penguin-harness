/**
 * The pull-request status a `pr` material carries: which URLs are looked up, how GitHub's
 * answer maps to the four states, how the reader answers from the store at once and refreshes
 * in the background through the Forge, and how the default runner starts a process. No test
 * reaches GitHub or needs a logged-in `gh`: the reader gets a fake forge, and the runner's own
 * tests start node in place of `gh`.
 */
import { describe, expect, it } from "vitest";
import {
  PrStatusReader,
  STATUS_TTL_MS,
  ghRunner,
  parsePullUrl,
  statusOf,
} from "../src/pr-status.js";
import { GithubForge, SqliteGraphStore, SqliteProposalStore } from "../src/index.js";
import { FakeForge, cr } from "./graph-fakes.js";

describe("parsePullUrl", () => {
  it("names the pull request of a GitHub URL, /pull or /pulls, with or without a tail", () => {
    expect(parsePullUrl("https://github.com/Prism-Shadow/penguin-harness/pull/825")).toEqual({
      owner: "Prism-Shadow",
      repo: "penguin-harness",
      number: 825,
    });
    expect(parsePullUrl("https://github.com/o/r/pulls/7/")).toEqual({
      owner: "o",
      repo: "r",
      number: 7,
    });
    expect(parsePullUrl("https://www.github.com/o/r.git/pull/7#discussion_r1")).toEqual({
      owner: "o",
      repo: "r",
      number: 7,
    });
  });

  it("is null for anything else: an issue, a repository, another host", () => {
    expect(parsePullUrl("https://github.com/o/r/issues/7")).toBeNull();
    expect(parsePullUrl("https://github.com/o/r")).toBeNull();
    expect(parsePullUrl("https://gitlab.com/o/r/-/merge_requests/7")).toBeNull();
    expect(parsePullUrl("2026-09-23-fix-it")).toBeNull();
  });
});

describe("statusOf", () => {
  it("reads merged before closed before draft before open", () => {
    expect(statusOf({ merged: true, state: "closed" })).toBe("merged");
    expect(statusOf({ merged_at: "2026-09-23T00:00:00Z", state: "closed" })).toBe("merged");
    expect(statusOf({ state: "closed", draft: true })).toBe("closed");
    expect(statusOf({ state: "open", draft: true })).toBe("draft");
    expect(statusOf({ state: "open", draft: false, merged_at: null })).toBe("open");
  });
});

describe("PrStatusReader", () => {
  const URL = "https://github.com/o/r/pull/7";

  function reader(opts: { now?: () => number } = {}) {
    const lines: string[] = [];
    const forge = new FakeForge([cr("o/r", 7, { head: "a".repeat(40), branch: "x", draft: true })]);
    const store = new SqliteGraphStore(SqliteProposalStore.open(":memory:").db);
    const r = new PrStatusReader({
      forge,
      log: (l) => lines.push(l),
      ...(opts.now !== undefined ? { now: opts.now } : {}),
    });
    return { r, forge, store, lines };
  }

  it("answers at once from the table, and reads what is missing in the background, by owner, repo and number", async () => {
    const { r, forge, store } = reader();
    const first = r.read("acme", store, ["https://www.github.com/o/r.git/pull/7#discussion_r1"]);
    // Nothing cached yet: no status, and the read did not wait for the forge.
    expect(first.statuses.size).toBe(0);
    await first.refreshed;
    expect(forge.queries).toEqual([{ repo: "o/r", numbers: [7] }]);
    const second = r.read("acme", store, [URL]);
    expect(second.statuses.get(URL)?.status).toBe("draft");
    await second.refreshed;
    expect(forge.queries).toHaveLength(1);
  });

  it("keeps an answer for five minutes, then reads it again", async () => {
    let now = 0;
    const { r, forge, store } = reader({ now: () => now });
    await r.read("acme", store, [URL]).refreshed;
    now = STATUS_TTL_MS - 1;
    await r.read("acme", store, [URL]).refreshed;
    expect(forge.queries).toHaveLength(1);
    now = STATUS_TTL_MS;
    const stale = r.read("acme", store, [URL]);
    // The stale answer is still what the read gets while the new one is fetched.
    expect(stale.statuses.get(URL)?.status).toBe("draft");
    await stale.refreshed;
    expect(forge.queries).toHaveLength(2);
  });

  it("reads several PRs of one repository in one batch, one batch per organization at a time", async () => {
    const { r, forge, store } = reader();
    forge.pulls.push(cr("o/r", 8, { head: "b".repeat(40), branch: "y", state: "merged" }));
    const a = r.read("acme", store, [URL, "https://github.com/o/r/pull/8"]);
    const b = r.read("acme", store, [URL]);
    await Promise.all([a.refreshed, b.refreshed]);
    expect(forge.queries).toEqual([{ repo: "o/r", numbers: [7, 8] }]);
    expect(
      r
        .read("acme", store, ["https://github.com/o/r/pull/8"])
        .statuses.get("https://github.com/o/r/pull/8")?.status,
    ).toBe("merged");
  });

  it("keeps a failure as long as an answer and logs it, the last status standing", async () => {
    let now = 0;
    const { r, forge, store, lines } = reader({ now: () => now });
    await r.read("acme", store, [URL]).refreshed;
    now = STATUS_TTL_MS;
    forge.failWith = "HTTP 502";
    await r.read("acme", store, [URL]).refreshed;
    expect(lines).toEqual(["[company-proposals] PR status not read for o/r: HTTP 502"]);
    const after = r.read("acme", store, [URL]);
    expect(after.statuses.get(URL)?.status).toBe("draft");
    await after.refreshed;
    expect(forge.queries).toHaveLength(2);
  });

  it("does not look up a URL that names no pull request", async () => {
    const { r, forge, store } = reader();
    await r.read("acme", store, ["https://github.com/o/r/issues/7", "x"]).refreshed;
    expect(forge.queries).toEqual([]);
  });

  it("landing asks the forge past the cache, lands only a merge into the default branch, and writes back", async () => {
    const { r, forge, store } = reader();
    await r.read("acme", store, [URL]).refreshed;
    forge.pulls = [
      cr("o/r", 7, { head: "a".repeat(40), branch: "x", state: "merged", base: "dev" }),
    ];
    expect(await r.landing(store, URL)).toMatchObject({
      status: "merged",
      base: "dev",
      defaultBranch: "main",
      landed: false,
    });
    forge.pulls = [
      cr("o/r", 7, { head: "a".repeat(40), branch: "x", state: "merged", base: "main" }),
    ];
    expect(await r.landing(store, URL)).toMatchObject({ status: "merged", landed: true });
    // The fresh answer is what the page reads next.
    expect(r.read("acme", store, [URL]).statuses.get(URL)?.status).toBe("merged");
    forge.failWith = "HTTP 502";
    expect(await r.landing(store, URL)).toBeNull();
    expect(await r.landing(store, "https://example.com/x")).toBeNull();
  });
});

describe("ghRunner", () => {
  // node stands in for gh: the runner starts whatever command it was made with.
  const node = ghRunner(process.execPath);
  const limits = { timeoutMs: 5_000, maxBytes: 1024 * 1024 };

  it("answers the command's stdout", async () => {
    const out = await node(
      ["-e", "process.stdout.write(JSON.stringify({ state: 'open' }))"],
      limits,
    );
    expect(JSON.parse(out)).toEqual({ state: "open" });
  });

  it("rejects with the reason when the command is missing, fails or runs too long", async () => {
    await expect(ghRunner("penguin-no-such-gh")(["api", "x"], limits)).rejects.toThrow(
      "penguin-no-such-gh not found",
    );
    await expect(
      node(
        [
          "-e",
          "process.stderr.write('warming up\\nHTTP 403: API rate limit exceeded\\n'); process.exit(1)",
        ],
        limits,
      ),
    ).rejects.toThrow(/^HTTP 403: API rate limit exceeded$/);
    await expect(
      node(["-e", "setTimeout(() => {}, 10_000)"], { ...limits, timeoutMs: 200 }),
    ).rejects.toThrow("timed out after 200 ms");
    await expect(
      node(["-e", "process.stdout.write('x'.repeat(4096))"], { ...limits, maxBytes: 1024 }),
    ).rejects.toThrow("wrote more than 1024 bytes");
  });

  it("leaves a forge without gh failing with the reason", async () => {
    const forge = new GithubForge(ghRunner("penguin-no-such-gh"));
    await expect(forge.listChangeRequests({ repo: "o/r", numbers: [7] })).rejects.toThrow(
      "penguin-no-such-gh not found",
    );
    expect(await forge.isMerged("https://github.com/o/r/pull/7")).toBeNull();
  });
});
