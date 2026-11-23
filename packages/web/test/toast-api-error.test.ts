/**
 * A failure said in a toast (lib/toast-api-error.ts): the words are `apiErrorText`'s whatever the
 * error, and 「[报告问题]」 comes with them for every failure and never for a refusal.
 *
 * - Given the server's converged 500, a machine out of reach (a 5xx the server named), a plugin
 *   install that failed (a failure reported through a 4xx), the network gone, or an exception the
 *   app did not expect, the toast carries a report that names the page it happened on.
 * - Given a validation error, a wrong password, a refused permission or a name already taken, the
 *   toast carries none: it reads exactly as before.
 * - Given a model test the provider failed (a result, not a caught error), the toast carries a
 *   report holding the provider's own words.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildReport,
  setReportRoute,
  toastStore,
  UNKNOWN_ENVIRONMENT,
} from "@prismshadow/penguin-ui";
import { ApiError } from "../src/api/client";
import { apiErrorText } from "../src/lib/api-error";
import { toldFailure } from "../src/lib/failure";
import { toastApiError, toastFailure } from "../src/lib/toast-api-error";

const shown = () => toastStore.getState().items;

/** The report the one toast on screen offers, as it would be shared. */
const sharedReport = () => {
  const [toast] = shown();
  expect(toast?.report).toBeDefined();
  const report = typeof toast!.report === "function" ? toast!.report() : toast!.report!;
  return buildReport(report, UNKNOWN_ENVIRONMENT).markdown;
};

beforeEach(() => {
  vi.useFakeTimers();
  toastStore.setState({ items: [] });
  setReportRoute(() => "/models");
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  toastStore.setState({ items: [] });
  setReportRoute(null);
});

describe("a failure in a toast", () => {
  it.each<[string, unknown]>([
    ["the server's converged 500", new ApiError(500, "internal", "Internal server error.")],
    [
      "a machine out of reach",
      new ApiError(502, "machine_unanswered", "The machine did not answer."),
    ],
    ["a plugin install that failed", new ApiError(400, "plugin_install_failed", "npm exited 1")],
    ["the network gone", new ApiError(0, "network_error", "Network error")],
    ["an exception the app did not expect", new TypeError("models is not iterable")],
  ])("offers a report for %s, naming the page it happened on", (_, err) => {
    toastApiError(err);
    expect(shown()[0]?.text).toBe(apiErrorText(err));
    expect(sharedReport()).toContain("- Page: /models");
  });

  it.each<[string, unknown]>([
    ["a validation error", new ApiError(400, "invalid_title", "title is required")],
    ["a wrong password", new ApiError(401, "invalid_credentials", "Wrong password")],
    ["a refused permission", new ApiError(403, "admin_required", "Admins only")],
    ["a name already taken", new ApiError(409, "agent_exists", "An agent named so exists")],
  ])("offers none for %s, and reads as it always did", (_, err) => {
    toastApiError(err);
    expect(shown()).toEqual([{ id: expect.any(Number), kind: "error", text: apiErrorText(err) }]);
  });

  it("offers a report holding the provider's words for a model test that failed", () => {
    toastFailure(
      toldFailure("Test failed: 401 Incorrect API key", {
        what: "a model test failed",
        facts: [["Model", "openai/gpt-5"]],
        detail: "401 Incorrect API key provided",
      }),
    );
    expect(shown()[0]?.text).toBe("Test failed: 401 Incorrect API key");
    const report = sharedReport();
    expect(report).toContain("- What happened: a model test failed");
    expect(report).toContain("401 Incorrect API key provided");
  });
});
