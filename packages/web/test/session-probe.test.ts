/**
 * The session probe (`probeSession`): the one question a window asks when it suspects it is
 * no longer signed in — after its stream dies, or when it comes back to the foreground.
 *
 * What it must get right is the asymmetry: a 401 signs the window out through the api
 * client's global handler, and every other failure leaves the user exactly where they are,
 * because an offline laptop is not a revoked session. Plus the cheapness the callers rely
 * on — a burst of focus and stream-error events costs one request.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { setUnauthorizedHandler } from "../src/api/client";
import { probeSession } from "../src/api/session-probe";

/** Counts the global sign-out the api client fires on a 401. */
function countSignOuts(): { readonly count: number } {
  const seen = { count: 0 };
  setUnauthorizedHandler(() => {
    seen.count += 1;
  });
  return seen;
}

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("probeSession", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
  });

  it("signs the window out when the server answers 401", async () => {
    vi.stubGlobal("fetch", async () => json({ error: { code: "unauthorized" } }, 401));
    const signOuts = countSignOuts();

    await probeSession();

    expect(signOuts.count).toBe(1);
  });

  it("says nothing when the session is still good", async () => {
    vi.stubGlobal("fetch", async () => json({ user: { userId: "admin" } }, 200));
    const signOuts = countSignOuts();

    await probeSession();

    expect(signOuts.count).toBe(0);
  });

  it("never signs the window out over an unreachable or broken server", async () => {
    const signOuts = countSignOuts();

    vi.stubGlobal("fetch", async () => {
      throw new Error("connection refused");
    });
    await expect(probeSession()).resolves.toBeUndefined();

    vi.stubGlobal("fetch", async () => json({ error: { code: "internal" } }, 500));
    await expect(probeSession()).resolves.toBeUndefined();

    expect(signOuts.count).toBe(0);
  });

  it("collapses a burst into a single request, and asks again once it has settled", async () => {
    let calls = 0;
    let answer: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      answer = resolve;
    });
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      await pending;
      return json({ user: { userId: "admin" } }, 200);
    });

    const first = probeSession();
    const second = probeSession();
    expect(calls).toBe(1);

    answer();
    await Promise.all([first, second]);
    expect(calls).toBe(1);

    await probeSession();
    expect(calls).toBe(2);
  });
});
