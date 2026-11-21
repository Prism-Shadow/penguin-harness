/**
 * A caught error as an inline surface says it (lib/failure.tsx): its words, and its report when
 * it is a failure.
 *
 * - Given a Files panel failure whose message names a file in the Workspace, the report holds
 *   `<workspace>` in place of the Workspace's path, in the report and in the link alike.
 * - Given a refusal, there is no report to open: the words stand alone.
 */
import { afterEach, describe, expect, it } from "vitest";
import { UNKNOWN_ENVIRONMENT, buildReport, setReportRoute } from "@prismshadow/penguin-ui";
import { ApiError } from "../src/api/client";
import { failureOf } from "../src/lib/failure";

afterEach(() => setReportRoute(null));

describe("a caught failure's report", () => {
  it("holds <workspace> in place of the Workspace's path", () => {
    setReportRoute(() => "/chat/:sessionId");
    const err = new ApiError(
      500,
      "internal",
      "EACCES: permission denied, open '/srv/work/acme/notes.md'",
    );
    const failure = failureOf(err, { privatePaths: ["/srv/work/acme"] });
    expect(failure.report).not.toBeNull();
    const report = typeof failure.report === "function" ? failure.report() : failure.report!;
    const built = buildReport(report, UNKNOWN_ENVIRONMENT);
    expect(built.markdown).toContain("'<workspace>/notes.md'");
    for (const shared of [built.markdown, decodeURIComponent(built.issueUrl)]) {
      expect(shared).not.toContain("/srv/work/acme");
    }
  });

  it("offers none for a refusal", () => {
    const failure = failureOf(new ApiError(404, "path_not_found", "No such file"), {
      privatePaths: ["/srv/work/acme"],
    });
    expect(failure.report).toBeNull();
  });
});
