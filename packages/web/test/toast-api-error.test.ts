/**
 * An action's failure said in a toast (lib/toast-api-error.ts): the words are `apiErrorText`'s
 * whatever the error, and 「[报告问题]」 comes with them only for a defect.
 *
 * - Given the server's converged 500 or an exception the app did not expect, the toast carries a
 *   report that names the page it happened on.
 * - Given a validation error, a refused permission or the network gone, the toast carries none:
 *   it reads exactly as before.
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
import { toastApiError } from "../src/lib/toast-api-error";

const shown = () => toastStore.getState().items;

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

describe("an action's failure in a toast", () => {
  it.each<[string, unknown]>([
    ["the server's converged 500", new ApiError(500, "internal", "Internal server error.")],
    ["an exception the app did not expect", new TypeError("models is not iterable")],
  ])("offers a report for %s, naming the page it happened on", (_, err) => {
    toastApiError(err);
    const [toast] = shown();
    expect(toast?.text).toBe(apiErrorText(err));
    expect(toast?.report).toBeDefined();
    const report = typeof toast!.report === "function" ? toast!.report() : toast!.report!;
    expect(buildReport(report, UNKNOWN_ENVIRONMENT).markdown).toContain("- Page: /models");
  });

  it.each<[string, unknown]>([
    ["a validation error", new ApiError(400, "validation_failed", "name is required")],
    ["a refused permission", new ApiError(403, "forbidden", "Not allowed")],
    ["the network gone", new ApiError(0, "network_error", "Network error")],
  ])("offers none for %s, and reads as it always did", (_, err) => {
    toastApiError(err);
    expect(shown()).toEqual([{ id: expect.any(Number), kind: "error", text: apiErrorText(err) }]);
  });
});
