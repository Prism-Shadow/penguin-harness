/**
 * Signing in on the login page reads GET /api/me before it adopts the user (state/auth.tsx), so
 * the shell never mounts on the flags from before the sign-in. That read can fail, and one
 * failure is unlike the others: a 401 says the session cookie never took — blocked cookies, a
 * cross-site context, a proxy dropping `Set-Cookie` — and api/client.ts has already cleared the
 * user over it. Adopting the login response's user there would put a dead session back in the
 * same continuation, navigate to /chat, let the shell write the work mode back locally, and only
 * bounce to /login on the next request.
 *
 * Tested by value: this package's vitest runs in node with no DOM, so the decision is a pure
 * function and the Provider's catch is the thin caller.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client";
import { loginSessionSurvives } from "../src/state/auth";

describe("a failed read of /api/me right after signing in", () => {
  it("leaves no user to adopt when it came back 401", () => {
    expect(loginSessionSurvives(new ApiError(401, "unauthorized", "Unauthorized"))).toBe(false);
  });

  it("leaves the session standing on every other failure, so the user is still adopted", () => {
    // The statuses api/client.ts can produce here: a network error, a server error, and a 403,
    // which is a refusal of the request rather than of the session.
    expect(loginSessionSurvives(new ApiError(0, "network_error", "Network error"))).toBe(true);
    expect(loginSessionSurvives(new ApiError(500, "http_error", "Server error"))).toBe(true);
    expect(loginSessionSurvives(new ApiError(403, "forbidden", "Forbidden"))).toBe(true);
  });

  it("leaves it standing for a throw that is not an ApiError at all", () => {
    expect(loginSessionSurvives(new TypeError("fetch failed"))).toBe(true);
    expect(loginSessionSurvives({ status: 401 })).toBe(true);
    expect(loginSessionSurvives("unauthorized")).toBe(true);
    expect(loginSessionSurvives(undefined)).toBe(true);
  });
});
