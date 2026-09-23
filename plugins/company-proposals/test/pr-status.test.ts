/**
 * The GitHub pull-request status a `pr` material carries: which URLs are looked up, how
 * GitHub's answer maps to the four states, and what the reader does with its cache, its
 * token and a failure.
 */
import { describe, expect, it } from "vitest";
import { PrStatusReader, STATUS_TTL_MS, parsePullUrl, statusOf } from "../src/pr-status.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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

  function reader(opts: {
    answers: Array<() => Response | Promise<Response>>;
    token?: string | null;
    now?: () => number;
  }) {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const lines: string[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        headers: Object.fromEntries(Object.entries(init?.headers ?? {})),
      });
      const next = opts.answers.shift();
      if (next === undefined) throw new Error("no answer left");
      return next();
    }) as unknown as typeof fetch;
    const r = new PrStatusReader({
      fetch: fetchImpl,
      token: () => opts.token ?? null,
      log: (l) => lines.push(l),
      ...(opts.now !== undefined ? { now: opts.now } : {}),
    });
    return { r, calls, lines };
  }

  it("asks GitHub's API for the pull request, with the token when there is one", async () => {
    const { r, calls } = reader({
      answers: [() => jsonResponse({ state: "open", draft: true })],
      token: "ghp_x",
    });
    const read = await r.read(URL);
    expect(read?.status).toBe("draft");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.github.com/repos/o/r/pulls/7");
    expect(calls[0]!.headers.authorization).toBe("Bearer ghp_x");
    expect(calls[0]!.headers.accept).toBe("application/vnd.github+json");
  });

  it("sends no authorization without a token", async () => {
    const { r, calls } = reader({ answers: [() => jsonResponse({ state: "open" })] });
    expect((await r.read(URL))?.status).toBe("open");
    expect(calls[0]!.headers.authorization).toBeUndefined();
  });

  it("keeps an answer for a minute, then asks again", async () => {
    let t = 1_000_000;
    const { r, calls } = reader({
      answers: [
        () => jsonResponse({ state: "open" }),
        () => jsonResponse({ merged: true, state: "closed" }),
      ],
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
    const { r, calls } = reader({ answers: [() => jsonResponse({ state: "closed" })] });
    const [a, b] = await Promise.all([r.read(URL), r.read(URL)]);
    expect(a?.status).toBe("closed");
    expect(b?.status).toBe("closed");
    expect(calls).toHaveLength(1);
  });

  it("answers nothing on a failure, logs it once, and does not ask again within the minute", async () => {
    const { r, calls, lines } = reader({
      answers: [
        () => jsonResponse({ message: "Not Found" }, 404),
        () => jsonResponse({ state: "open" }),
      ],
    });
    expect(await r.read(URL)).toBeNull();
    expect(await r.read(URL)).toBeNull();
    expect(calls).toHaveLength(1);
    expect(lines.filter((l) => l.includes("PR status not read for o/r#7"))).toHaveLength(1);
    const thrown = reader({ answers: [() => Promise.reject(new Error("ECONNRESET"))] });
    expect(await thrown.r.read(URL)).toBeNull();
    expect(thrown.lines[0]).toContain("ECONNRESET");
  });

  it("does not look up a URL that names no pull request", async () => {
    const { r, calls } = reader({ answers: [] });
    expect(await r.read("https://github.com/o/r/issues/7")).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
