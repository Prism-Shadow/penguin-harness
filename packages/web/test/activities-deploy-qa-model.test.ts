/**
 * The QA deploy's words in the Deploy section: every new stage, failure and check finding the
 * server can send says something, the run line says QA for a QA run, the link to QA comes
 * from the stored stages, and the stages that push ask first.
 */
import { describe, expect, it } from "vitest";
import type {
  DeployPreflightIssue,
  DeployRun,
  DeployStage,
  DeployStageError,
  DeployStageState,
} from "@prismshadow/penguin-server/api";
import {
  QA_STAGES,
  isQaRun,
  preflightFindings,
  preflightText,
  qaResult,
  refusalText,
  runLine,
  stageConfirmText,
  stageErrorText,
  stageName,
} from "../src/features/activities/deploy-model";
import { DEPLOY_GROUPS, deployUpdate, formFromView } from "../src/features/settings/deploy-form";

const state = (
  stage: DeployStage,
  status: DeployStageState["status"],
  metadata: DeployStageState["metadata"] = {},
): DeployStageState => ({ stage, status, finishedAt: null, metadata, blocker: null });

function run(overrides: Partial<DeployRun> = {}): DeployRun {
  return {
    runId: "dep_1",
    activityId: "act_1",
    target: "qa",
    selection: "qa",
    status: "running",
    stages: [{ stage: "export_activity_data", status: "running", error: null }],
    metadata: {},
    startedAt: "2026-09-28T00:00:00.000Z",
    finishedAt: null,
    ...overrides,
  };
}

describe("the QA deploy's words", () => {
  it("names every QA stage", () => {
    for (const stage of QA_STAGES) expect(stageName(stage)).toMatch(/\w/);
    expect(stageName("verify_media_assets")).toBe("Publish the media");
  });

  it("says each new failure", () => {
    const errors: DeployStageError[] = [
      { code: "preflight_failed", errors: 2 },
      { code: "media_missing", paths: ["media/a.mp3", "media/b.png"], count: 3 },
      { code: "deploy_timed_out", minutes: 30 },
    ];
    expect(errors.map(stageErrorText)).toEqual([
      "The activity data failed its check: 2 problems. The activity data and media were not pushed.",
      "3 media files are neither in the draft nor in the media repository: media/a.mp3, media/b.png, …. The activity data and media were not pushed.",
      "The QA deploy had not finished within 30 minutes.",
    ]);
  });

  it("says every finding of the check", () => {
    const file = "data/configurations/loom/words-1.json";
    const issues: DeployPreflightIssue[] = [
      { code: "deploy_list_mismatch", file: "deployLists/loom-words.txt" },
      { code: "file_missing", file },
      { code: "file_invalid", file },
      { code: "layout_module_mismatch", expected: "words@^1.5.0", found: null },
      { code: "no_sources" },
      { code: "assessment_empty", file },
      { code: "assessment_count_mismatch", file, items: 1, maxItems: 3 },
      { code: "media_path_unsafe", file, reference: "/media/../x" },
      { code: "media_preview_url", file, reference: "/sandbox/media/x" },
      { code: "media_token_left", file, reference: "{{MEDIA}}/x" },
      { code: "configuration_without_media", file },
    ];
    const texts = issues.map(preflightText);
    for (const text of texts) expect(text.length).toBeGreaterThan(5);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts[6]).toBe(`${file} has 1 item but says it has 3.`);
  });

  it("says QA in the run line of a QA run, and release for a release", () => {
    expect(isQaRun(run())).toBe(true);
    expect(isQaRun(run({ selection: "publish_activity_data" }))).toBe(true);
    expect(isQaRun(run({ selection: "release" }))).toBe(false);
    expect(runLine(run())?.text).toBe("Deploying to QA: Export the activity data.");
    expect(runLine(run({ status: "succeeded" }))?.text).toBe("The last QA deploy finished.");
    expect(runLine(run({ selection: "release", status: "failed" }))?.text).toBe(
      "The last release failed.",
    );
  });

  it("links to QA only once the deploy is done, with the module version it went with", () => {
    const url = "https://qa.example.org/play?productCode=words&refNum=1&frameworkVersion=4.2.1";
    expect(qaResult([state("await_activity_deploy", "pending")])).toBeNull();
    expect(
      qaResult([
        state("export_activity_data", "done", { resolvedModuleVersion: "1.5.0" }),
        state("await_activity_deploy", "done", { qaActivityUrl: url }),
      ]),
    ).toEqual({ url, version: "1.5.0" });
  });

  it("lists the check's findings from the run, else the stored stage", () => {
    const report = {
      errors: [{ code: "no_sources" as const }],
      warnings: [],
      counts: { templates: 1, configurations: 0, assessments: 0, media: 0 },
    };
    expect(preflightFindings(run({ metadata: { preflight: report } }), [])).toEqual({
      errors: ["The template has no ref to deploy."],
      warnings: [],
    });
    expect(
      preflightFindings(null, [state("verify_activity_data", "failed", { preflight: report })])
        ?.errors,
    ).toHaveLength(1);
    expect(preflightFindings(null, [])).toBeNull();
  });

  it("asks before a stage that pushes or starts a Jenkins job, and not before one that only works here", () => {
    const branches = { deploy: "loom/words-deploy", activityData: "loom/words-activity-data" };
    expect(stageConfirmText("publish_activity_data", branches)).toBe(
      "This pushes the exported activity data to the branch loom/words-activity-data.",
    );
    expect(stageConfirmText("trigger_module_build", branches)).toContain("loom/words-deploy");
    expect(stageConfirmText("verify_media_assets", branches)).not.toBeNull();
    expect(stageConfirmText("trigger_activity_deploy", branches)).not.toBeNull();
    for (const stage of [
      "export_activity_data",
      "verify_activity_data",
      "await_activity_deploy",
    ] as const)
      expect(stageConfirmText(stage, branches)).toBeNull();
  });

  it("words a refusal that names a QA stage", () => {
    expect(
      refusalText({
        stage: "publish_activity_data",
        blocker: "previous_stage",
        previous: "verify_media_assets",
      }),
    ).toBe("Waits for Publish the media to finish.");
  });

  it("offers the media address in the deploy settings and sends it when changed", () => {
    const repos = DEPLOY_GROUPS.find((group) => group.key === "repos")!;
    expect(repos.fields.map((field) => field.path)).toContain("repos.mediaPublicBase");
    const view = {
      qa: {
        jenkinsUrl: "",
        username: "",
        token: { set: false },
        tier: "qa",
        environment: "loom",
        frameworkVersion: "",
        activityBaseUrl: "",
      },
      prod: {
        jenkinsUrl: "",
        username: "",
        token: { set: false },
        tier: "prod",
        environment: "DEFAULT",
        frameworkVersion: "",
      },
      jobs: { moduleBuild: "Build WAF Modules", activityDeploy: "WAF Activity Deploy" },
      repos: { activityDataRemote: "", mediaRemote: "", mediaPublicBase: "/media/" },
      git: { userName: "", userEmail: "" },
      timeouts: { buildMinutes: 30, deployMinutes: 30 },
    };
    const values = { ...formFromView(view), "repos.mediaPublicBase": "{{MEDIA}}/" };
    expect(
      deployUpdate(values, view, {
        qa: { value: "", forget: false },
        prod: { value: "", forget: false },
      }),
    ).toEqual({ repos: { mediaPublicBase: "{{MEDIA}}/" } });
  });
});
