/**
 * The session probe (`probeSession`): the one question a window asks when it suspects it is
 * no longer signed in — after its stream dies, or when it comes back to the foreground.
 *
 * - A 401 signs the window out through the api client's global handler.
 * - A good session says nothing.
 * - An unreachable or broken server never signs the window out: an offline laptop is not a
 *   revoked session.
 * - A burst of probes costs one request, and a probe after it settles asks again.
 */
import { afterEach, describe, expect, it } from "vitest";
import { setUnauthorizedHandler } from "../src/api/client";
import { probeSession } from "../src/api/session-probe";
import { apiError, json, stubFetch } from "./helpers/fetch";

/** Counts the global sign-out the api client fires on a 401. */
function countSignOuts(): { readonly count: number } {
  const seen = { count: 0 };
  setUnauthorizedHandler(() => {
    seen.count += 1;
  });
  return seen;
}

describe("probeSession", () => {
  afterEach(() => {
    setUnauthorizedHandler(null);
  });

  it("signs the window out when the server answers 401", async () => {
    stubFetch(() => apiError(401, "unauthorized"));
    const signOuts = countSignOuts();

    await probeSession();

    expect(signOuts.count).toBe(1);
  });

  it("says nothing when the session is still good", async () => {
    stubFetch(() => json({ user: { userId: "admin" } }));
    const signOuts = countSignOuts();

    await probeSession();

    expect(signOuts.count).toBe(0);
  });

  it("never signs the window out over an unreachable or broken server", async () => {
    const signOuts = countSignOuts();

    const fetch = stubFetch(() => {
      throw new TypeError("connection refused");
    });
    await expect(probeSession()).resolves.toBeUndefined();

    fetch.answer(() => apiError(500, "internal"));
    await expect(probeSession()).resolves.toBeUndefined();

    expect(signOuts.count).toBe(0);
  });

  it("collapses a burst into a single request, and asks again once it has settled", async () => {
    let answer: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const fetch = stubFetch(async () => {
      await pending;
      return json({ user: { userId: "admin" } });
    });

    const first = probeSession();
    const second = probeSession();
    expect(fetch.requests).toHaveLength(1);

    answer();
    await Promise.all([first, second]);
    expect(fetch.requests).toHaveLength(1);

    await probeSession();
    expect(fetch.requests).toHaveLength(2);
  });
});
