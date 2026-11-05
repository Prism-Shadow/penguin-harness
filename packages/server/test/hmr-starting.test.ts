/**
 * What answers when there is no App: the entry's window before one exists, and the seam
 * finding no generation current. The seam's own case is pinned in hmr-http-seam.test.ts.
 */
import { describe, expect, it } from "vitest";
import { noPlatformResponse, startingResponse } from "../src/hmr/starting.js";

describe("the answers with no App behind them", () => {
  it("asks for a retry while starting, because that window ends by itself", async () => {
    const res = startingResponse();
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("1");
    // Never cached: the next request has to reach the App, not this answer.
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("penguin-server is starting");
  });

  it("names the fault and promises no retry when no platform is running", async () => {
    const res = noPlatformResponse("the packaged platform failed to boot");
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBeNull();
    expect(await res.text()).toContain("the packaged platform failed to boot");
  });
});
