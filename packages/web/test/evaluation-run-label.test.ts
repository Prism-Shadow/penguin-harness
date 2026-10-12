/**
 * A run's label in the evaluation dialog.
 *
 * - A run in a Session is a link (a button the dialog resolves: the Session opens, or, archived,
 *   is named with where to find it).
 * - A run recorded as a Harbor trial (`harbor:<trial name>`, as agent-evaluation records a case
 *   it runs through Harbor) is no Session: its label stays text, with a button that copies the
 *   trial's name, the directory to look for under the Benchmark's `.jobs/`.
 *
 * vitest runs node-only here, so the cell is rendered to static markup.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunLabel, harborTrialName } from "../src/features/benchmark/evaluation-detail-modal";
import { S } from "../src/lib/strings";

describe("a run's label in the evaluation dialog", () => {
  it("links a Session's run, and offers a Harbor trial's name to copy instead of a link", () => {
    const onOpen = () => {};
    const session = renderToStaticMarkup(
      createElement(RunLabel, {
        index: 2,
        sessionId: "session-2026-10-02-10-00-00-1a2b3c4d",
        onOpen,
      }),
    );
    expect(session).toContain(`data-tooltip="${S.benchmark.runOpenSession}"`);
    expect(session).toContain(`${S.benchmark.colRun} #2`);
    expect(harborTrialName("session-2026-10-02-10-00-00-1a2b3c4d")).toBeNull();

    const trial = renderToStaticMarkup(
      createElement(RunLabel, { index: 1, sessionId: "harbor:music-harmony__AbC1234", onOpen }),
    );
    expect(trial).not.toContain(S.benchmark.runOpenSession);
    expect(trial).toContain(`aria-label="${S.benchmark.copyTrialName}"`);
    expect(harborTrialName("harbor:music-harmony__AbC1234")).toBe("music-harmony__AbC1234");
  });
});
