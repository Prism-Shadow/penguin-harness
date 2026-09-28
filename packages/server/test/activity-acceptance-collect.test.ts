/**
 * Acceptance tests, the pure parts: which criteria a specification has, reading what the
 * checks wrote, and turning it into a report in the criteria's order.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_CRITERIA,
  acceptanceCriteria,
  acceptanceReport,
  overallStatus,
  parseAcceptanceResults,
  readAcceptanceReport,
  sameCriteria,
  skippedReport,
  specSceneIds,
} from "../src/activities/acceptance-collect.js";
import {
  acceptancePrompt,
  acceptanceReusePrompt,
  activityHarnessSource,
  runAcceptanceSource,
} from "../src/activities/acceptance-harness.js";

const meta = { checkedAt: "2026-09-25T10:00:00.000Z", specRevision: "rev", reused: false };

describe("acceptance criteria", () => {
  it("reads the specification's criteria in order, trimmed, each once", () => {
    expect(
      acceptanceCriteria({
        acceptance_criterias: [
          "  Tapping the cat\n plays its name. ",
          "",
          7,
          "The end screen says well done.",
          "Tapping the cat plays its name.",
        ],
      }),
    ).toEqual(["Tapping the cat plays its name.", "The end screen says well done."]);
    expect(acceptanceCriteria({})).toEqual([]);
    expect(acceptanceCriteria(null)).toEqual([]);
    expect(acceptanceCriteria({ acceptance_criterias: "one" })).toEqual([]);
  });

  it("tests at most a bounded number of criteria", () => {
    const many = Array.from({ length: MAX_CRITERIA + 5 }, (_, index) => `Criterion ${index}`);
    expect(acceptanceCriteria({ acceptance_criterias: many })).toHaveLength(MAX_CRITERIA);
  });

  it("lists scene ids once and compares criteria lists in order", () => {
    expect(specSceneIds({ scenes: [{ id: "intro" }, { id: "end" }, { id: "intro" }, {}] })).toEqual(
      ["intro", "end"],
    );
    expect(sameCriteria(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameCriteria(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameCriteria(["a"], ["a", "b"])).toBe(false);
  });
});

describe("collecting results", () => {
  it("maps results onto the criteria in order; a criterion without one failed not_run", () => {
    const reported = parseAcceptanceResults(
      JSON.stringify({
        results: [
          {
            criterion: "The end screen says well done.",
            testName: "end screen",
            status: "failed",
            durationMs: 812.4,
            error: "Expected state end, saw intro.",
          },
          { criterion: "Not one of ours.", testName: "extra", status: "passed", durationMs: 1 },
          {
            criterion: "Tapping the cat plays its name.",
            testName: "cat",
            status: "passed",
            durationMs: 1200,
            error: "ignored when passed",
          },
        ],
      }),
    );
    const report = acceptanceReport(
      ["Tapping the cat plays its name.", "The end screen says well done.", "The art is friendly."],
      reported,
      meta,
    );
    expect(report).toEqual({
      overallStatus: "failed",
      checkedAt: meta.checkedAt,
      specRevision: "rev",
      reused: false,
      results: [
        {
          criterion: "Tapping the cat plays its name.",
          testName: "cat",
          status: "passed",
          durationMs: 1200,
          error: null,
        },
        {
          criterion: "The end screen says well done.",
          testName: "end screen",
          status: "failed",
          durationMs: 812,
          error: "Expected state end, saw intro.",
        },
        {
          criterion: "The art is friendly.",
          testName: "",
          status: "failed",
          durationMs: 0,
          error: null,
          code: "not_run",
        },
      ],
    });
  });

  it("is passed when nothing failed and something passed, skipped when all were skipped", () => {
    const result = (status: "passed" | "failed" | "skipped") => ({
      criterion: "c",
      testName: "t",
      status,
      durationMs: 0,
      error: null,
    });
    expect(overallStatus([result("passed"), result("skipped")])).toBe("passed");
    expect(overallStatus([result("skipped")])).toBe("skipped");
    expect(overallStatus([result("skipped"), result("failed")])).toBe("failed");
    expect(overallStatus([])).toBe("skipped");
  });

  it("refuses a malformed results file with a worded error", () => {
    expect(() => parseAcceptanceResults("not json")).toThrow(
      "acceptance-results.json is not valid JSON.",
    );
    expect(() => parseAcceptanceResults("[]")).toThrow(/must be an object with a results list/);
    expect(() => parseAcceptanceResults(JSON.stringify({ results: [null] }))).toThrow(
      "Result 1 in acceptance-results.json is not an object.",
    );
    expect(() =>
      parseAcceptanceResults(JSON.stringify({ results: [{ status: "passed", durationMs: 1 }] })),
    ).toThrow("Result 1 in acceptance-results.json has no criterion.");
    expect(() =>
      parseAcceptanceResults(
        JSON.stringify({ results: [{ criterion: "c", status: "ok", durationMs: 1 }] }),
      ),
    ).toThrow(/status other than passed, failed or skipped/);
    expect(() =>
      parseAcceptanceResults(
        JSON.stringify({ results: [{ criterion: "c", status: "passed", durationMs: -1 }] }),
      ),
    ).toThrow(/has no duration/);
    expect(() =>
      parseAcceptanceResults(
        JSON.stringify({
          results: [{ criterion: "c", status: "failed", durationMs: 1, error: { x: 1 } }],
        }),
      ),
    ).toThrow(/error that is not text/);
  });

  it("bounds what it keeps from each result, and how many results it reads", () => {
    const [only] = parseAcceptanceResults(
      JSON.stringify({
        results: [
          {
            criterion: "c",
            testName: "n".repeat(1000),
            status: "failed",
            durationMs: 3,
            error: "e".repeat(5000),
          },
        ],
      }),
    );
    expect(only!.testName).toHaveLength(300);
    expect(only!.error).toHaveLength(2000);
    const many = Array.from({ length: 1001 }, () => ({
      criterion: "c",
      status: "passed",
      durationMs: 1,
    }));
    expect(() => parseAcceptanceResults(JSON.stringify({ results: many }))).toThrow(
      /more than 1000 results/,
    );
  });

  it("writes a skipped report without criteria, and reads stored reports defensively", () => {
    const skipped = skippedReport(meta.checkedAt, "rev");
    expect(skipped).toEqual({
      overallStatus: "skipped",
      results: [],
      checkedAt: meta.checkedAt,
      specRevision: "rev",
      reused: false,
      skippedReason: "no_criteria",
    });
    expect(readAcceptanceReport(skipped)).toEqual(skipped);
    expect(readAcceptanceReport({ overallStatus: "maybe", results: [], checkedAt: "x" })).toBe(
      null,
    );
    expect(readAcceptanceReport([])).toBeNull();
  });
});

describe("the staged harness", () => {
  it("never reads the environment or prints request headers", () => {
    for (const source of [activityHarnessSource, runAcceptanceSource]) {
      expect(source).not.toMatch(/process\.env/);
      expect(source).not.toMatch(/headers/i);
    }
  });

  it("offers the harness API the prompt names, and runs only the agent's test file", () => {
    for (const name of [
      "export function criterion",
      "export async function openActivity",
      "waitForState(",
      "waitForMedia(",
      "interactables()",
      "async tap(",
      "async hold(",
      "async drag(",
    ])
      expect(activityHarnessSource).toContain(name);
    expect(runAcceptanceSource).toContain('await import("./acceptance.test.mjs")');
    expect(runAcceptanceSource).toContain("executablePath: input.browserPath");
    expect(acceptancePrompt).toContain("npm install --ignore-scripts");
    expect(acceptancePrompt).toContain("node run-acceptance.mjs");
    expect(acceptanceReusePrompt).toContain("Do not rewrite it.");
  });
});
