/**
 * A run's Session id in the evaluation dialog.
 *
 * - A run recorded as a Harbor trial (`harbor:<trial name>`, as agent-evaluation records a case
 *   it runs through Harbor) shows its id with a button that copies the trial's name, the
 *   directory to look for under the Benchmark's `.jobs/`; a Session id shows alone.
 *
 * vitest runs node-only here, so the cell is rendered to static markup.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunSessionId, harborTrialName } from "../src/features/benchmark/evaluation-detail-modal";
import { S } from "../src/lib/strings";

describe("a run's Session id in the evaluation dialog", () => {
  it("offers a Harbor trial's name to copy, while a Session id stands alone", () => {
    const trial = renderToStaticMarkup(
      createElement(RunSessionId, { sessionId: "harbor:music-harmony__AbC1234" }),
    );
    expect(trial).toContain("harbor:music-harmony__AbC1234");
    expect(trial).toContain(`aria-label="${S.benchmark.copyTrialName}"`);
    expect(harborTrialName("harbor:music-harmony__AbC1234")).toBe("music-harmony__AbC1234");

    const session = renderToStaticMarkup(
      createElement(RunSessionId, { sessionId: "session-2026-10-02-10-00-00-1a2b3c4d" }),
    );
    expect(session).not.toContain("<button");
    expect(harborTrialName("session-2026-10-02-10-00-00-1a2b3c4d")).toBeNull();
  });
});
