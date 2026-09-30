/**
 * The GitHub pull-request status a `pr` material carries: which URLs are looked up, how
 * GitHub's answer maps to the four states, what the reader asks `gh` and does with its
 * cache and a failure, and how the default runner starts a process. No test reaches
 * GitHub or needs a logged-in `gh`: the reader gets a scripted runner, and the runner's
 * own tests start node in place of `gh`.
 */
import { describe, expect, it } from "vitest";
import {
  PrStatusReader,
  STATUS_TTL_MS,
  ghRunner,
  parsePullUrl,
  statusOf,
  type RunGh,
} from "../src/pr-status.js";

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

  function reader(opts: { answers: Array<() => string | Promise<string>>; now?: () => number }) {
    const calls: Array<{ args: string[]; limits: { timeoutMs: number; maxBytes: number } }> = [];
    const lines: string[] = [];
    const gh: RunGh = async (args, limits) => {
      calls.push({ args: [...args], limits });
      const next = opts.answers.shift();
      if (next === undefined) throw new Error("no answer left");
      return next();
    };
    const r = new PrStatusReader({
      gh,
      log: (l) => lines.push(l),
      ...(opts.now !== undefined ? { now: opts.now } : {}),
    });
    return { r, calls, lines };
  }
  const json = (body: unknown) => () => JSON.stringify(body);

  it("asks gh for the pull request by its owner, repo and number, never the URL", async () => {
    const { r, calls } = reader({ answers: [json({ state: "open", draft: true })] });
    const read = await r.read("https://www.github.com/o/r.git/pull/7#discussion_r1");
    expect(read?.status).toBe("draft");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual(["api", "repos/o/r/pulls/7"]);
    expect(calls[0]!.limits.timeoutMs).toBeGreaterThan(0);
    expect(calls[0]!.limits.maxBytes).toBeGreaterThan(0);
  });

  it("keeps an answer for a minute, then asks again", async () => {
    let t = 1_000_000;
    const { r, calls } = reader({
      answers: [json({ state: "open" }), json({ merged: true, state: "closed" })],
      now: () => t,
    });
    expect((await r.read(URL))?.status).toBe("open");
    t += STATUS_TTL_MS - 1;
    expect((await r.read(URL))?.status).toBe("open");
    expect(calls).toHaveLength(1);
    t += 2;
    expect((await r.read(URL))?.status).toBe("merged");
    expect(calls).toHaveLength(2);
  });

  it("shares one request between concurrent reads", async () => {
    const { r, calls } = reader({ answers: [json({ state: "closed" })] });
    const [a, b] = await Promise.all([r.read(URL), r.read(URL)]);
    expect(a?.status).toBe("closed");
    expect(b?.status).toBe("closed");
    expect(calls).toHaveLength(1);
  });

  it("answers nothing on a failure, logs it once, and does not ask again within the minute", async () => {
    const { r, calls, lines } = reader({
      answers: [
        () => Promise.reject(new Error("gh: API rate limit exceeded (HTTP 403)")),
        json({ state: "open" }),
      ],
    });
    expect(await r.read(URL)).toBeNull();
    expect(await r.read(URL)).toBeNull();
    expect(calls).toHaveLength(1);
    const logged = lines.filter((l) => l.includes("PR status not read for o/r#7"));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("HTTP 403");
    const garbled = reader({ answers: [() => "not json"] });
    expect(await garbled.r.read(URL)).toBeNull();
    expect(garbled.lines).toHaveLength(1);
  });

  it("does not hand gh a name GitHub would not accept", async () => {
    const { r, calls, lines } = reader({ answers: [json({ state: "open" })] });
    expect(await r.read("https://github.com/../r/pull/7")).toBeNull();
    expect(calls).toHaveLength(0);
    expect(lines[0]).toContain("not a GitHub repository name");
  });

  it("does not look up a URL that names no pull request", async () => {
    const { r, calls } = reader({ answers: [] });
    expect(await r.read("https://github.com/o/r/issues/7")).toBeNull();
    expect(await r.landing("https://github.com/o/r/issues/7")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("landing asks GitHub past the cache, and lands only a merge into the default branch", async () => {
    const pull = (merged: boolean, base: string) =>
      json({
        state: merged ? "closed" : "open",
        merged,
        base: { ref: base, repo: { default_branch: "main" } },
      });
    const { r, calls } = reader({
      answers: [
        json({ state: "open" }),
        pull(true, "dev"),
        pull(true, "main"),
        () => Promise.reject(new Error("gh: HTTP 502")),
      ],
    });
    expect((await r.read(URL))?.status).toBe("open");
    expect(await r.landing(URL)).toMatchObject({
      status: "merged",
      base: "dev",
      defaultBranch: "main",
      landed: false,
    });
    expect(await r.landing(URL)).toMatchObject({ status: "merged", base: "main", landed: true });
    // The fresh answer is what the page reads next, within the minute.
    expect((await r.read(URL))?.status).toBe("merged");
    expect(calls).toHaveLength(3);
    expect(await r.landing(URL)).toBeNull();
    expect(calls).toHaveLength(4);
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

  it("leaves a reader without gh with no status and one log line", async () => {
    const lines: string[] = [];
    const r = new PrStatusReader({ gh: ghRunner("penguin-no-such-gh"), log: (l) => lines.push(l) });
    expect(await r.read("https://github.com/o/r/pull/7")).toBeNull();
    expect(lines).toEqual([
      "[company-proposals] PR status not read for o/r#7: penguin-no-such-gh not found",
    ]);
  });
});
