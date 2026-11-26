/**
 * A machine's server that is still starting, waited out — over the wire, against the answers its
 * process's entry really gives (hmr/starting.ts), read by the client every job asks through.
 *
 * Scenarios:
 * - Given a server that answers it is starting and then answers, the question gets the answer.
 * - Given a server still starting when the budget is spent, the question ends with that answer.
 * - Given work that is cut while it waits, the wait ends at once.
 * - Given a server with no platform, the question is not asked again.
 * - Given an answer that is not a 200, its reason is the error envelope's message, else its first
 *   line — never a page of markup, and never longer than a line a job's log can hold.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { machineApi } from "../src/machines/machine-api.js";
import { waitingOutStarting } from "../src/machines/starting-wait.js";
import { answeredWhenAsked } from "../src/machines/answer-reason.js";
import { noPlatformResponse, startingResponse } from "../src/hmr/starting.js";

/** A machine's server whose process answers `entry` to the first `times` requests, then its App. */
async function farServer(entry: () => Response, times: number) {
  let left = times;
  const answered: string[] = [];
  const server = http.createServer((_req, res) => {
    const unavailable = left > 0 ? entry() : null;
    if (unavailable === null) {
      answered.push("the App");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ version: "9.9.9" }));
      return;
    }
    left -= 1;
    answered.push("its entry");
    res.writeHead(unavailable.status, Object.fromEntries(unavailable.headers));
    void unavailable.text().then((text) => res.end(text));
  });
  const port = await new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
  );
  servers.push(server);
  return { port, answered };
}

const servers: http.Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

const apiTo = (port: number, opts: Parameters<typeof waitingOutStarting>[1] = {}) =>
  waitingOutStarting(machineApi(new http.Agent(), port, "penguin_session=x"), opts);

describe("a machine's server that is still starting", () => {
  it("is asked again after the wait it asks for, and its App's answer is the outcome", async () => {
    const far = await farServer(startingResponse, 1);

    const answer = await apiTo(far.port).request("GET", "/api/version");

    expect(answer.status).toBe(200);
    expect(far.answered).toEqual(["its entry", "the App"]);
  });

  it("is given up on when the budget is spent, with the answer it last gave", async () => {
    const far = await farServer(startingResponse, Number.POSITIVE_INFINITY);
    const began = Date.now();

    const answer = await apiTo(far.port, { budgetMs: 1_500 }).request("GET", "/api/version");

    expect(Date.now() - began).toBeLessThan(3_000);
    expect(answeredWhenAsked(answer, "its version")).toBe(
      "it answered 503 when asked its version: penguin-server is starting",
    );
  });

  it("stops being waited for once the work that asked is cut", async () => {
    const far = await farServer(startingResponse, Number.POSITIVE_INFINITY);
    const cut = new AbortController();
    setTimeout(() => cut.abort(), 200);
    const began = Date.now();

    await apiTo(far.port, { signal: cut.signal }).request("GET", "/api/version");

    expect(Date.now() - began).toBeLessThan(900);
    expect(far.answered).toEqual(["its entry"]);
  });

  it("is not what a server with no platform is: that one is asked once", async () => {
    const far = await farServer(() => noPlatformResponse("boot failed"), 1);

    const answer = await apiTo(far.port).request("GET", "/api/version");

    expect(answeredWhenAsked(answer, "its version")).toBe(
      "it answered 503 when asked its version: penguin-server has no running platform: boot failed",
    );
    expect(far.answered).toEqual(["its entry"]);
  });
});

describe("the reason an answer gives", () => {
  it("is the error envelope's message, else the body's first line, and never markup or a page of text", () => {
    const envelope = JSON.stringify({ error: { code: "forbidden", message: "Admins only." } });
    expect(answeredWhenAsked({ status: 403, text: envelope }, "its projects")).toBe(
      "it answered 403 when asked its projects: Admins only.",
    );
    expect(answeredWhenAsked({ status: 502, text: "\n  Bad gateway\nupstream down" }, "x")).toBe(
      "it answered 502 when asked x: Bad gateway",
    );
    expect(answeredWhenAsked({ status: 404, text: "<!doctype html><p>no</p>" }, "x")).toBe(
      "it answered 404 when asked x",
    );
    expect(answeredWhenAsked({ status: 500, text: "" }, "x")).toBe("it answered 500 when asked x");
    const long = answeredWhenAsked({ status: 500, text: "y".repeat(500) }, "x");
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBeLessThan(260);
  });
});
