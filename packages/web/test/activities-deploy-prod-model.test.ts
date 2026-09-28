/**
 * The PROD deploy's words in the Deploy section: its stages and failures say something, the
 * gate says why PROD waits, the bar shows the last deploy and the live PROD run, and the typed
 * confirmation matches only the product code.
 */
import { describe, expect, it } from "vitest";
import type {
  DeployProductionState,
  DeployRun,
  DeployStage,
  DeployStageState,
} from "@prismshadow/penguin-server/api";
import {
  PROD_STAGES,
  blockerText,
  isProdRun,
  prodBar,
  prodConfirmed,
  prodRefusalText,
  refusalText,
  runLine,
  stageErrorText,
  stageName,
} from "../src/features/activities/deploy-model";

const state = (
  stage: DeployStage,
  status: DeployStageState["status"] = "pending",
): DeployStageState => ({ stage, status, finishedAt: null, metadata: {}, blocker: null });

function production(overrides: Partial<DeployProductionState> = {}): DeployProductionState {
  return {
    stages: [state("trigger_production_deploy"), state("await_production_deploy")],
    blocker: null,
    last: null,
    ...overrides,
  };
}

function run(overrides: Partial<DeployRun> = {}): DeployRun {
  return {
    runId: "dep_1",
    activityId: "act_1",
    target: "prod",
    selection: "prod",
    status: "running",
    stages: [
      { stage: "trigger_production_deploy", status: "done", error: null },
      { stage: "await_production_deploy", status: "running", error: null },
    ],
    metadata: {},
    startedAt: "2026-09-28T00:00:00.000Z",
    finishedAt: null,
    ...overrides,
  };
}

const when = (iso: string) => `at ${iso}`;

describe("the PROD deploy's words", () => {
  it("names both PROD stages", () => {
    expect(PROD_STAGES.map(stageName)).toEqual([
      "Start the PROD deploy",
      "Wait for the PROD deploy",
    ]);
  });

  it("says why PROD waits for QA, from the stage list and from a refusal", () => {
    expect(blockerText({ code: "qa_outdated" })).toBe(
      "The activity changed after it went to QA. Deploy to QA again first.",
    );
    expect(refusalText({ stage: "trigger_production_deploy", blocker: "qa_outdated" })).toBe(
      blockerText({ code: "qa_outdated" }),
    );
    expect(
      refusalText({
        stage: "trigger_production_deploy",
        blocker: "previous_stage",
        previous: "await_activity_deploy",
      }),
    ).toBe("Waits for Wait for the QA deploy to finish.");
  });

  it("names PROD in a PROD timeout, and QA in one that names no target", () => {
    expect(stageErrorText({ code: "deploy_timed_out", minutes: 30, target: "prod" })).toMatch(
      /^The PROD deploy/,
    );
    expect(stageErrorText({ code: "deploy_timed_out", minutes: 1 })).toBe(
      "The QA deploy had not finished within 1 minute.",
    );
  });

  it("words a PROD run as PROD", () => {
    expect(isProdRun(run())).toBe(true);
    expect(runLine(run())?.text).toBe("Deploying to PROD: Wait for the PROD deploy.");
    expect(runLine(run({ status: "succeeded" }))).toEqual({
      tone: "success",
      text: "The last PROD deploy finished.",
    });
    expect(isProdRun(run({ target: "qa", selection: "qa" }))).toBe(false);
  });

  it("shows no deploy yet, the gate, and the last deploy with its framework", () => {
    const empty = prodBar(production({ blocker: { code: "qa_outdated" } }), null, when);
    expect(empty.last).toBe("Not deployed to PROD yet.");
    expect(empty.blocker).toBe(blockerText({ code: "qa_outdated" }));
    expect(empty.line).toBeNull();
    expect(empty.rows.map((row) => row.statusText)).toEqual(["Not run", "Not run"]);

    const done = prodBar(
      production({
        stages: [
          state("trigger_production_deploy", "done"),
          state("await_production_deploy", "done"),
        ],
        last: {
          runId: "dep_1",
          deployedAt: "2026-09-28T09:00:00.000Z",
          contentRevision: "rev",
          frameworkVersion: "4.1.0",
          url: "https://jenkins/job/9/",
        },
      }),
      run({ target: "qa", selection: "qa", status: "succeeded", stages: [] }),
      when,
    );
    expect(done.last).toBe(
      "Last deployed to PROD on at 2026-09-28T09:00:00.000Z, with framework 4.1.0.",
    );
    expect(done.lastUrl).toBe("https://jenkins/job/9/");
    expect(done.blocker).toBeNull();
    // The latest run is QA's: the bar has no line of its own.
    expect(done.line).toBeNull();
  });

  it("follows a live PROD run, and waits while any run goes", () => {
    const live = prodBar(production(), run(), when);
    expect(live.rows.map((row) => row.status)).toEqual(["done", "running"]);
    expect(live.line?.tone).toBe("busy");
    expect(live.blocker).toBe("A deploy is running on this server.");

    const qa = prodBar(
      production(),
      run({
        target: "qa",
        selection: "qa",
        stages: [{ stage: "export_activity_data", status: "running", error: null }],
      }),
      when,
    );
    expect(qa.line).toBeNull();
    expect(qa.blocker).toBe("A deploy is running on this server.");
  });

  it("confirms only on the product code, exactly", () => {
    expect(prodConfirmed("words", "words")).toBe(true);
    expect(prodConfirmed("  words ", "words")).toBe(false);
    expect(prodConfirmed("Words", "words")).toBe(false);
    expect(prodConfirmed("", "words")).toBe(false);
    expect(prodRefusalText("confirmation_mismatch")).toMatch(/did not match/);
    expect(prodRefusalText("prod_requires_admin")).toMatch(/admin/);
    expect(prodRefusalText("deploy_blocked")).toBeNull();
  });
});
