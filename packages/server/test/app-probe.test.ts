/**
 * App status probe over a fake fetch: any response is running, HEAD failing falls back to
 * GET, both failing is stopped, no URL is unknown; results are cached per URL within the TTL,
 * a forced probe bypasses the cache, and concurrent probes of one URL share a request.
 */
import { describe, expect, it } from "vitest";
import { AppStatusProbe } from "../src/runtime/app-probe.js";

type Script = (url: string, method: string) => Response | Error;

/** A fetch double driven by a script; records every (url, method) it saw. */
function fakeFetch(script: Script): { fetch: typeof globalThis.fetch; calls: string[] } {
  const calls: string[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);
    const out = script(url, method);
    if (out instanceof Error) throw out;
    return out;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const refused = () => new Error("connect ECONNREFUSED");

describe("AppStatusProbe", () => {
  it("any HTTP response is running (a 500 included), refused on both methods is stopped, no url is unknown", async () => {
    const net = fakeFetch((url) =>
      url.startsWith("http://localhost:3000") ? new Response(null, { status: 500 }) : refused(),
    );
    const probe = new AppStatusProbe({ fetch: net.fetch, now: () => 1_000 });
    expect(await probe.status("http://localhost:3000/")).toEqual({
      status: "running",
      checkedAt: new Date(1_000).toISOString(),
    });
    expect(await probe.status("http://localhost:4000/")).toMatchObject({ status: "stopped" });
    expect(await probe.status(undefined)).toEqual({ status: "unknown" });
    expect(net.calls).toEqual([
      "HEAD http://localhost:3000/",
      "HEAD http://localhost:4000/",
      "GET http://localhost:4000/",
    ]);
  });

  it("falls back to GET when only HEAD fails", async () => {
    const net = fakeFetch((_url, method) =>
      method === "HEAD" ? new Error("socket hang up") : new Response("ok"),
    );
    const probe = new AppStatusProbe({ fetch: net.fetch });
    expect((await probe.status("http://localhost:5000/")).status).toBe("running");
    expect(net.calls).toEqual(["HEAD http://localhost:5000/", "GET http://localhost:5000/"]);
  });

  it("serves the cached status within the TTL, re-probes after it or on force, and shares an in-flight probe", async () => {
    let now = 0;
    const net = fakeFetch(() => new Response(null, { status: 204 }));
    const probe = new AppStatusProbe({ fetch: net.fetch, now: () => now, ttlMs: 10_000 });
    const url = "http://localhost:3000/";
    const [a, b] = await Promise.all([probe.status(url), probe.status(url)]);
    expect(a).toEqual(b);
    expect(net.calls).toHaveLength(1);
    now = 9_999;
    await probe.status(url);
    expect(net.calls).toHaveLength(1);
    await probe.status(url, { force: true });
    expect(net.calls).toHaveLength(2);
    now = 25_000;
    expect((await probe.status(url)).checkedAt).toBe(new Date(25_000).toISOString());
    expect(net.calls).toHaveLength(3);
    probe.invalidate(url);
    await probe.status(url);
    expect(net.calls).toHaveLength(4);
  });
});
