/**
 * The Deploy section's words: every problem the server can name says something, each check
 * has a row whose tone and text agree, a branch not made yet is not a failure, and the
 * settings form sends only what changed, with tokens only when typed or forgotten.
 */
import { describe, expect, it } from "vitest";
import type {
  DeployBlocker,
  DeployContext,
  DeployProblem,
  DeployRun,
  DeploySettingsView,
  DeployStageError,
  DeployStageState,
} from "@prismshadow/penguin-server/api";
import {
  appendLog,
  blockerText,
  refusalText,
  runLine,
  stageErrorText,
  stageRows,
  versionProblem,
  clonesMissing,
  needsSettings,
  problemText,
  readinessLine,
  readinessRows,
} from "../src/features/activities/deploy-model";
import { deployUpdate, emptyTokenDrafts, formFromView } from "../src/features/settings/deploy-form";

const CLEAN = { present: true, branch: "main", clean: true, ahead: 0, remoteUrlMatches: true };

function context(overrides: Partial<DeployContext> = {}): DeployContext {
  return {
    ready: true,
    problems: [],
    remoteChecked: false,
    module: {
      folder: "waf-module-words",
      remote: "git@github.com:org/waf-module-words.git",
      clone: CLEAN,
    },
    activityData: { clone: CLEAN },
    media: { clone: CLEAN },
    branches: { deploy: "loom/words-deploy", activityData: "loom/words-activity-data" },
    branchState: {
      deploy: { local: false, remote: null },
      activityData: { local: true, remote: null },
    },
    ...overrides,
  };
}

const EVERY_PROBLEM: DeployProblem[] = [
  { code: "settings_missing", field: "qa.jenkinsUrl" },
  { code: "settings_missing", field: "some.newField" },
  { code: "module_remote_missing" },
  { code: "clone_missing", repo: "module" },
  { code: "clone_dirty", repo: "activityData" },
  { code: "clone_ahead", repo: "media", count: 2 },
  { code: "clone_remote_mismatch", repo: "module" },
  { code: "branch_missing", repo: "media", branch: "main", where: "remote" },
  { code: "branch_missing", repo: "activityData", branch: "main", where: "local" },
  { code: "not_canonical" },
  { code: "no_module" },
  { code: "layout_unsupported", layout: "mainAndSide" },
  { code: "layout_unsupported", layout: "" },
  { code: "git_unavailable" },
  { code: "module_remote_invalid" },
  { code: "clone_unknown", repo: "module", what: "status" },
  { code: "clone_unknown", repo: "module", what: "upstream" },
  { code: "clone_unknown", repo: "module", what: "branch" },
  { code: "clone_unknown", repo: "media", what: "sparse" },
  { code: "remote_unreachable", repo: "activityData" },
  { code: "media_path_missing", path: "media/loom/words" },
];

describe("deploy problems", () => {
  it("says every problem in words", () => {
    const texts = EVERY_PROBLEM.map(problemText);
    for (const text of texts) expect(text.length).toBeGreaterThan(10);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts[0]).toBe("QA Jenkins address is empty.");
    // A field this build has no name for is still named, by its path.
    expect(texts[1]).toBe("some.newField is empty.");
    expect(texts[3]).toContain("Module clone");
    expect(texts[5]).toContain("2 commits");
    expect(texts[7]).toBe("The Media remote has no main branch.");
    expect(texts[11]).toContain("mainAndSide");
    expect(texts.join(" ")).not.toMatch(/Loom/);
  });
});

describe("deploy readiness", () => {
  it("shows a ready activity with every check passed", () => {
    const rows = readinessRows(context());
    expect(readinessLine(context())).toEqual({ tone: "success", text: "Ready to deploy." });
    expect(rows.map((row) => row.id)).toEqual([
      "ref",
      "layout",
      "settings",
      "git",
      "moduleRemote",
      "clone:module",
      "clone:activityData",
      "clone:media",
      "branch:deploy",
      "branch:activityData",
    ]);
    for (const row of rows.slice(0, 8)) expect(row.tone).toBe("success");
    expect(rows.find((row) => row.id === "clone:media")?.state).toBe("Cloned, on main, clean");
    // A deploy branch not made yet recedes: the deploy makes it.
    const deploy = rows.find((row) => row.id === "branch:deploy")!;
    expect(deploy).toMatchObject({ label: "Branch loom/words-deploy", tone: "muted" });
    expect(deploy.state).toBe("Not made yet; the deploy makes it · remote not checked");
  });

  it("marks what is missing, and counts it", () => {
    const missing = context({
      ready: false,
      problems: [
        { code: "not_canonical" },
        { code: "settings_missing", field: "qa.token" },
        { code: "settings_missing", field: "git.userEmail" },
        { code: "clone_missing", repo: "media" },
        { code: "clone_dirty", repo: "activityData" },
      ],
      media: { clone: { ...CLEAN, present: false, branch: null, clean: null, ahead: null } },
    });
    const rows = Object.fromEntries(readinessRows(missing).map((row) => [row.id, row]));
    expect(readinessLine(missing)).toEqual({
      tone: "danger",
      text: "Not ready to deploy: 5 things are missing.",
    });
    expect(rows.ref).toMatchObject({ tone: "danger" });
    expect(rows.settings).toMatchObject({ tone: "danger", state: "2 settings are empty" });
    expect(rows["clone:media"]).toMatchObject({ tone: "attention", state: "Not cloned yet" });
    expect(rows["clone:activityData"]).toMatchObject({
      tone: "danger",
      state: "Has uncommitted changes",
    });
    expect(needsSettings(missing)).toBe(true);
    expect(clonesMissing(missing)).toBe(true);
    expect(clonesMissing(context())).toBe(false);
  });

  it("marks what git could not say, and a media folder not checked out, as not ready", () => {
    const unknown = context({
      ready: false,
      remoteChecked: true,
      problems: [
        { code: "clone_unknown", repo: "module", what: "status" },
        { code: "remote_unreachable", repo: "activityData" },
        { code: "media_path_missing", path: "media/loom/words" },
      ],
      module: {
        folder: "waf-module-words",
        remote: "git@github.com:org/waf-module-words.git",
        clone: { ...CLEAN, clean: null },
      },
    });
    const rows = Object.fromEntries(readinessRows(unknown).map((row) => [row.id, row]));
    expect(readinessLine(unknown).tone).toBe("danger");
    expect(rows["clone:module"]).toMatchObject({
      tone: "danger",
      state: "git could not say whether it is clean",
    });
    expect(rows["clone:activityData"]).toMatchObject({
      tone: "danger",
      state: "The remote could not be reached",
    });
    expect(rows["clone:media"]).toMatchObject({
      tone: "danger",
      state: "media/loom/words is not checked out",
    });
    // Prepare clones adds the missing media folder.
    expect(clonesMissing(unknown)).toBe(true);
  });

  it("says a module remote that cannot be cloned from", () => {
    const invalid = context({
      ready: false,
      problems: [{ code: "module_remote_invalid" }],
      module: { folder: "waf-module-words", remote: null, clone: CLEAN },
    });
    const row = readinessRows(invalid).find((entry) => entry.id === "moduleRemote")!;
    expect(row.tone).toBe("danger");
    expect(row.state).toContain("cannot be cloned from");
  });

  it("leaves out the module's rows for an activity with no product", () => {
    const orphan = context({
      ready: false,
      problems: [{ code: "no_module" }],
      module: {
        folder: "",
        remote: null,
        clone: { present: false, branch: null, clean: null, ahead: null, remoteUrlMatches: null },
      },
      branches: { deploy: "", activityData: "loom/x-activity-data" },
    });
    const ids = readinessRows(orphan).map((row) => row.id);
    expect(ids).not.toContain("moduleRemote");
    expect(ids).not.toContain("clone:module");
    expect(ids).not.toContain("branch:deploy");
  });

  it("says where a branch is once the remote was asked", () => {
    const checked = context({
      remoteChecked: true,
      branchState: {
        deploy: { local: false, remote: true },
        activityData: { local: true, remote: false },
      },
    });
    const rows = Object.fromEntries(readinessRows(checked).map((row) => [row.id, row]));
    expect(rows["branch:deploy"]).toMatchObject({
      tone: "success",
      state: "Not made yet; the deploy makes it · on the remote",
    });
    expect(rows["branch:activityData"]?.state).toBe("Here · not on the remote yet");
  });
});

const VIEW: DeploySettingsView = {
  qa: {
    jenkinsUrl: "https://jenkins.example.org",
    username: "robot",
    token: { set: true },
    tier: "qa",
    environment: "loom",
    frameworkVersion: "4.2.1",
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
  repos: {
    activityDataRemote: "git@github.com:org/data.git",
    mediaRemote: "",
    mediaPublicBase: "/media/",
  },
  git: { userName: "", userEmail: "" },
  timeouts: { buildMinutes: 30, deployMinutes: 30 },
};

describe("deploy settings form", () => {
  it("holds the saved values, and sends nothing when nothing changed", () => {
    const values = formFromView(VIEW);
    expect(values["qa.jenkinsUrl"]).toBe("https://jenkins.example.org");
    expect(values["timeouts.buildMinutes"]).toBe("30");
    expect(deployUpdate(values, VIEW, emptyTokenDrafts())).toBeNull();
  });

  it("sends only the changed fields, minutes as numbers", () => {
    const values = {
      ...formFromView(VIEW),
      "repos.mediaRemote": " git@github.com:org/media.git ",
      "timeouts.deployMinutes": "45",
    };
    expect(deployUpdate(values, VIEW, emptyTokenDrafts())).toEqual({
      repos: { mediaRemote: "git@github.com:org/media.git" },
      timeouts: { deployMinutes: 45 },
    });
  });

  it("sends a token only when typed, and null to forget a saved one", () => {
    const values = formFromView(VIEW);
    expect(
      deployUpdate(values, VIEW, { ...emptyTokenDrafts(), prod: { value: "abc", forget: false } }),
    ).toEqual({ prod: { token: "abc" } });
    expect(
      deployUpdate(values, VIEW, { ...emptyTokenDrafts(), qa: { value: "", forget: true } }),
    ).toEqual({ qa: { token: null } });
    // Forgetting a token that is not saved sends nothing.
    expect(
      deployUpdate(values, VIEW, { ...emptyTokenDrafts(), prod: { value: "", forget: true } }),
    ).toBeNull();
  });
});

describe("the module release", () => {
  const stored = (
    status: DeployStageState["status"],
    blocker: DeployBlocker | null = null,
  ): Omit<DeployStageState, "stage"> => ({ status, finishedAt: null, metadata: {}, blocker });
  const stages: DeployStageState[] = [
    { stage: "verify_module", ...stored("done") },
    { stage: "prepare_deploy", ...stored("done") },
    {
      stage: "trigger_module_build",
      ...stored("failed"),
    },
    {
      stage: "await_module_build",
      ...stored("pending", { code: "previous_stage", stage: "trigger_module_build" }),
    },
  ];
  const run = (overrides: Partial<DeployRun> = {}): DeployRun => ({
    runId: "dep_1",
    activityId: "act_1",
    target: "qa",
    selection: "release",
    status: "failed",
    stages: [
      { stage: "verify_module", status: "done", error: null },
      { stage: "prepare_deploy", status: "done", error: null },
      {
        stage: "trigger_module_build",
        status: "failed",
        error: { code: "jenkins_failed", status: 401 },
      },
      { stage: "await_module_build", status: "pending", error: null },
    ],
    metadata: {},
    startedAt: "2026-09-28T00:00:00.000Z",
    finishedAt: "2026-09-28T00:01:00.000Z",
    ...overrides,
  });

  it("names every stage error and blocker the server can send", () => {
    const errors: DeployStageError[] = [
      { code: "command_failed", command: "npm run lint", exitCode: 1, output: "x" },
      { code: "command_failed", command: "npm ci", exitCode: null, output: "" },
      { code: "command_timed_out", command: "npm ci" },
      { code: "command_missing", command: "npm" },
      { code: "jenkins_failed", status: 0 },
      { code: "jenkins_failed", status: 403 },
      { code: "build_failed", result: "FAILURE", url: null },
      { code: "no_newer_tag", before: null, after: "1.0.0" },
      { code: "build_timed_out", minutes: 1 },
      { code: "missing_input", stage: "trigger_module_build" },
      { code: "interrupted" },
      { code: "unexpected" },
    ];
    for (const error of errors) expect(stageErrorText(error).length).toBeGreaterThan(5);
    expect(stageErrorText(errors[0]!)).toBe(
      "npm run lint failed with exit code 1. The log shows its output.",
    );
    expect(stageErrorText({ code: "missing_input", stage: "trigger_module_build" })).toBe(
      "Run Push and start the build first: this stage works from what it records.",
    );
    const blockers: DeployBlocker[] = [
      { code: "previous_stage", stage: "verify_module" },
      { code: "run_active" },
      { code: "settings_missing", field: "qa.token" },
      { code: "clone_missing", repo: "module" },
      { code: "clone_dirty", repo: "module" },
      { code: "not_ready", problem: { code: "not_canonical" } },
    ];
    for (const blocker of blockers) expect(blockerText(blocker).length).toBeGreaterThan(5);
    expect(blockerText(blockers[0]!)).toBe("Waits for Verify the module to finish.");
    expect(blockerText(blockers[2]!)).toBe("QA Jenkins token is empty.");
    expect(blockerText(blockers[5]!)).toBe(problemText({ code: "not_canonical" }));
    expect(blockerText({ code: "previous_rerun", stage: "verify_module" })).toBe(
      "Run Verify the module again first: this stage starts from what it leaves.",
    );
  });

  it("words a refused start from its detail, as the stage list words the blocker", () => {
    expect(
      refusalText({
        stage: "prepare_deploy",
        blocker: "previous_rerun",
        previous: "verify_module",
      }),
    ).toBe("Run Verify the module again first: this stage starts from what it leaves.");
    expect(
      refusalText({
        stage: "trigger_module_build",
        blocker: "previous_stage",
        previous: "prepare_deploy",
      }),
    ).toBe("Waits for Prepare the deploy branch to finish.");
    expect(refusalText({ stage: "verify_module", blocker: "clone_dirty", repo: "media" })).toBe(
      blockerText({ code: "clone_dirty", repo: "media" }),
    );
    expect(refusalText({ stage: "verify_module", blocker: "run_active" })).toBe(
      blockerText({ code: "run_active" }),
    );
    // Facts the App does not know, or none at all: the caller falls back to the code's words.
    expect(refusalText({ stage: "verify_module", blocker: "not_ready", problem: "x" })).toBeNull();
    expect(refusalText({ blocker: "previous_stage", previous: "deploy_everything" })).toBeNull();
    expect(refusalText(undefined)).toBeNull();
  });

  it("shows the stored states, and why a failed stage failed, once the run has ended", () => {
    const rows = stageRows(run(), stages);
    expect(rows.map((row) => [row.label, row.statusText, row.tone])).toEqual([
      ["Verify the module", "Done", "success"],
      ["Prepare the deploy branch", "Done", "success"],
      ["Push and start the build", "Failed", "danger"],
      ["Wait for the release tag", "Not run", "muted"],
    ]);
    expect(rows[2]!.error).toBe("Jenkins refused the request (HTTP 401).");
    expect(rows[3]!.blocker).toBe("Waits for Push and start the build to finish.");
    expect(rows[0]!.blocker).toBeNull();
    expect(runLine(run())).toEqual({ tone: "danger", text: "The last release failed." });
    expect(runLine(null)).toBeNull();
  });

  it("follows a running run's live states, and nothing may start while it runs", () => {
    const live = run({
      status: "running",
      finishedAt: null,
      stages: [
        { stage: "verify_module", status: "done", error: null },
        { stage: "prepare_deploy", status: "running", error: null },
        { stage: "trigger_module_build", status: "pending", error: null },
        { stage: "await_module_build", status: "pending", error: null },
      ],
    });
    const rows = stageRows(live, stages);
    expect(rows.map((row) => row.status)).toEqual(["done", "running", "pending", "pending"]);
    expect(rows[1]!.tone).toBe("busy");
    expect(rows[2]!.error).toBeNull();
    expect(rows.every((row) => row.blocker === "A deploy is running on this server.")).toBe(true);
    expect(runLine(live)).toEqual({
      tone: "busy",
      text: "Releasing: Prepare the deploy branch.",
    });
  });

  it("appends only lines newer than those it has, and keeps the newest 2 000", () => {
    const line = (seq: number) => ({ seq, at: "now", text: `line ${seq}` });
    const first = appendLog([], { lines: [line(1), line(2)], next: 2, done: false });
    expect(first.map((entry) => entry.seq)).toEqual([1, 2]);
    // A page asked twice (a slow poll overtaken by the next) adds nothing twice.
    const again = appendLog(first, { lines: [line(2), line(3)], next: 3, done: false });
    expect(again.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(appendLog(again, { lines: [], next: 3, done: true })).toBe(again);
    const many = appendLog([], {
      lines: Array.from({ length: 2100 }, (_, index) => line(index + 1)),
      next: 2100,
      done: false,
    });
    expect(many).toHaveLength(2000);
    expect(many[0]!.seq).toBe(101);
  });

  it("takes an empty version or three numbers", () => {
    expect(versionProblem("")).toBeNull();
    expect(versionProblem(" 1.2.3 ")).toBeNull();
    for (const bad of ["v1.2.3", "1.2", "01.2.3", "1.2.3-rc.1"])
      expect(versionProblem(bad)).toBe("Write the version as three numbers, like 1.2.3.");
  });
});
