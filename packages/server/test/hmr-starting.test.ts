/**
 * The answer before the App exists. The entry binds the port first, so this is what every
 * client gets during startup — and the one thing it must not do is strand a browser on a
 * page that never asks again (the desktop shell's window did exactly that).
 */
import { describe, expect, it } from "vitest";
import { startingResponse } from "../src/hmr/starting.js";

const ask = (accept?: string) =>
  startingResponse(
    new Request("http://localhost/", { headers: accept === undefined ? {} : { accept } }),
  );

describe("the starting response", () => {
  it("tells a browser to come back, so a window opened during startup lands on the App", async () => {
    const res = ask("text/html,application/xhtml+xml");
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain('http-equiv="refresh"');
    expect(body).toContain("penguin-server is starting");
  });

  it("stays a plain line for everything else, and asks every client to retry", async () => {
    for (const res of [ask(), ask("application/json")]) {
      expect(res.status).toBe(503);
      expect(res.headers.get("content-type")).toContain("text/plain");
      expect(res.headers.get("retry-after")).toBe("1");
      // Never cached: the next request has to reach the App, not this answer.
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.text()).toBe("penguin-server is starting");
    }
  });
});
