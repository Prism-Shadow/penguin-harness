/**
 * What the App sees of deploying an activity: the admin's deploy settings (tokens masked),
 * and whether a deploy of one activity could start, with each thing still missing as a code.
 * Type-only, so the web can import it.
 *
 * The server words none of it: every problem is a code with the facts it names (a settings
 * field, a repository, a branch), and the App says it in words.
 */

/** A secret the server holds: only whether one is stored ever leaves it. */
export interface DeploySecretView {
  set: boolean;
}

/** Where a QA deploy goes. */
export interface DeployQaSettingsView {
  jenkinsUrl: string;
  username: string;
  token: DeploySecretView;
  tier: string;
  environment: string;
  frameworkVersion: string;
  /** Where a deployed activity can be opened on QA, for the link after a deploy. */
  activityBaseUrl: string;
}

/** Where a PROD deploy goes. */
export interface DeployProdSettingsView {
  jenkinsUrl: string;
  username: string;
  token: DeploySecretView;
  tier: string;
  environment: string;
  frameworkVersion: string;
}

export interface DeploySettingsView {
  qa: DeployQaSettingsView;
  prod: DeployProdSettingsView;
  /** Jenkins job names; defaults "Build WAF Modules" and "WAF Activity Deploy". */
  jobs: { moduleBuild: string; activityDeploy: string };
  /**
   * The git remotes activity data and media are published to, and where the deployed
   * activity finds its media: exported configurations point every media file at
   * `mediaPublicBase` followed by its path under `media/` (default `/media/`; `{{MEDIA}}/`
   * leaves the framework's token in place).
   */
  repos: { activityDataRemote: string; mediaRemote: string; mediaPublicBase: string };
  /** Who the deploy's commits are made as. */
  git: { userName: string; userEmail: string };
  /** How long a Jenkins build or deploy is waited for, in minutes; defaults 30 and 30. */
  timeouts: { buildMinutes: number; deployMinutes: number };
}

export interface DeploySettingsResponse {
  settings: DeploySettingsView;
}

/**
 * A settings update. Every group and field is optional (absent keeps what is stored). A token
 * left empty keeps the stored one; `null` clears it; any other string replaces it.
 */
export interface DeploySettingsUpdate {
  qa?: Partial<Omit<DeployQaSettingsView, "token">> & { token?: string | null };
  prod?: Partial<Omit<DeployProdSettingsView, "token">> & { token?: string | null };
  jobs?: Partial<DeploySettingsView["jobs"]>;
  repos?: Partial<DeploySettingsView["repos"]>;
  git?: Partial<DeploySettingsView["git"]>;
  timeouts?: Partial<DeploySettingsView["timeouts"]>;
}

/**
 * Why a settings field was refused, sent as `detail.reason` beside `detail.field` on an
 * `invalid_deploy_setting` error so the App can say it in words.
 */
export type DeploySettingReason =
  | "not_text"
  | "not_object"
  | "control_characters"
  | "too_long"
  | "not_address"
  | "https_required"
  | "credentials_in_address"
  | "query_in_address"
  | "not_remote"
  | "remote_scheme"
  | "password_in_remote"
  | "not_version"
  | "not_email"
  | "minutes_range"
  | "token_spaces"
  | "not_media_base";

/** Which Jenkins a connection test reaches. */
export type DeployTarget = "qa" | "prod";

/** A connection test: whether Jenkins answered with success, and its HTTP status (0 when none). */
export interface DeployConnectionTest {
  ok: boolean;
  status: number;
}

export interface DeployConnectionTestResponse {
  test: DeployConnectionTest;
}

/** The three clones a deploy works in. */
export type DeployRepo = "module" | "activityData" | "media";

/** One thing that keeps a deploy from starting. */
export type DeployProblem =
  /** A setting the deploy needs is empty; `field` is its dotted path, e.g. "qa.jenkinsUrl". */
  | { code: "settings_missing"; field: string }
  /** The module's package.json names no repository, so there is nowhere to clone it from. */
  | { code: "module_remote_missing" }
  /**
   * The module's package.json names a repository a clone may not be made from (only ssh,
   * git@host:owner/repo or https remotes without a password are).
   */
  | { code: "module_remote_invalid" }
  /** The clone is not there yet; Prepare clones makes it. */
  | { code: "clone_missing"; repo: DeployRepo }
  /** The clone has uncommitted changes. */
  | { code: "clone_dirty"; repo: DeployRepo }
  /** The clone has commits its upstream does not. */
  | { code: "clone_ahead"; repo: DeployRepo; count: number }
  /** The clone's origin is not the remote the settings or the module name. */
  | { code: "clone_remote_mismatch"; repo: DeployRepo }
  /**
   * git could not say something about a present clone: whether it is clean (`status`), how
   * far it is ahead of its upstream (`upstream`, e.g. no upstream is set), whether the
   * branch a deploy starts from is there (`branch`), or which folders a media clone checks
   * out (`sparse`). Unknown is not ready.
   */
  | { code: "clone_unknown"; repo: DeployRepo; what: "status" | "upstream" | "branch" | "sparse" }
  /** Check remote was asked for and the clone's remote could not be reached. */
  | { code: "remote_unreachable"; repo: DeployRepo }
  /**
   * The media clone does not check out this product's media folder (`path`, e.g.
   * "media/loom/abc"); Prepare clones adds it.
   */
  | { code: "media_path_missing"; path: string }
  /** A branch the deploy starts from is not in the clone, or (when checked) not on the remote. */
  | { code: "branch_missing"; repo: DeployRepo; branch: string; where: "local" | "remote" }
  /** Only the canonical ref deploys: the module is shared by every ref of the product. */
  | { code: "not_canonical" }
  /** The activity belongs to no product, so it has no module to deploy. */
  | { code: "no_module" }
  /** The specification's layout is not one a deploy supports (only mainOnly is; none named is mainOnly). */
  | { code: "layout_unsupported"; layout: string }
  /** git could not be run on this server. */
  | { code: "git_unavailable" };

export type DeployProblemCode = DeployProblem["code"];

/** What a clone looks like on disk; the parts that could not be read are null. */
export interface CloneState {
  present: boolean;
  /** The checked-out branch; null when detached, absent or unreadable. */
  branch: string | null;
  /** Whether the working tree has no uncommitted changes. */
  clean: boolean | null;
  /** Commits on the branch its upstream does not have. */
  ahead: number | null;
  /** Whether origin is the expected remote; null when there is no expectation to compare. */
  remoteUrlMatches: boolean | null;
}

/** Whether a branch is there: locally, and on the remote (null until the remote is checked). */
export interface BranchState {
  local: boolean | null;
  remote: boolean | null;
}

export interface DeployContext {
  /** True when nothing in `problems` stands in the way. */
  ready: boolean;
  problems: DeployProblem[];
  /** Whether the remote branches were asked about (Check remote). */
  remoteChecked: boolean;
  module: { folder: string; remote: string | null; clone: CloneState };
  activityData: { clone: CloneState };
  media: { clone: CloneState };
  /** The branches a deploy pushes, named as Loom named them so its branches are reused. */
  branches: { deploy: string; activityData: string };
  /**
   * Whether those branches exist yet. They are information, not problems: the deploy makes
   * them when they are missing.
   */
  branchState: { deploy: BranchState; activityData: BranchState };
}

export interface DeployContextResponse {
  context: DeployContext;
}

/**
 * The stages of a module release, in the order each needs the one before: build and check the
 * module in its clone, make the deploy branch's commit, push it and ask Jenkins to build it,
 * and wait for the release tag that build makes.
 */
export const DEPLOY_RELEASE_STAGES = [
  "verify_module",
  "prepare_deploy",
  "trigger_module_build",
  "await_module_build",
] as const;

/**
 * The stages that put a released module's activity on QA, after the release: write the
 * activity's data into the activity-data clone, check it, publish the media it names, publish
 * the data, ask Jenkins to deploy it, and wait for that deploy.
 */
export const DEPLOY_QA_STAGES = [
  "export_activity_data",
  "verify_activity_data",
  "verify_media_assets",
  "publish_activity_data",
  "trigger_activity_deploy",
  "await_activity_deploy",
] as const;

/** The release and QA stages, in the order each needs the one before: the QA stage list. */
export const DEPLOY_STAGES = [...DEPLOY_RELEASE_STAGES, ...DEPLOY_QA_STAGES] as const;

/**
 * The stages of a PROD deploy, after a current QA deploy: ask the PROD Jenkins to deploy the
 * activity data QA has, and wait for that deploy.
 */
export const DEPLOY_PROD_STAGES = ["trigger_production_deploy", "await_production_deploy"] as const;

/** Every stage, QA's then PROD's, in the order each needs the one before. */
export const DEPLOY_ALL_STAGES = [...DEPLOY_STAGES, ...DEPLOY_PROD_STAGES] as const;

export type DeployStage = (typeof DEPLOY_ALL_STAGES)[number];

export type DeployProdStage = (typeof DEPLOY_PROD_STAGES)[number];

/**
 * What a run was asked to do: the module release (stages 1 to 4), a QA deploy (stages 1 to
 * 10, the release left out when it is current), a PROD deploy (its two stages), or one stage
 * on its own.
 */
export type DeployStageSelection = "release" | "qa" | "prod" | DeployStage;

export type DeployStageStatus = "pending" | "running" | "done" | "failed" | "cancelled";

export type DeployRunStatus = "running" | "succeeded" | "failed" | "cancelled" | "interrupted";

/**
 * Why a stage ended badly, as facts the App words. `output` is the end of the program's own
 * output (npm's, git's), never the server's words.
 */
export type DeployStageError =
  /** A program exited with a failure: its command line, its exit code (null when it did not exit). */
  | { code: "command_failed"; command: string; exitCode: number | null; output: string }
  /** A program ran past its time limit and was stopped. */
  | { code: "command_timed_out"; command: string }
  /** A program is not on this server. */
  | { code: "command_missing"; command: string }
  /** Jenkins refused or did not answer; `status` is its HTTP status, 0 when nothing answered. */
  | { code: "jenkins_failed"; status: number }
  /** The Jenkins build ended without success; `result` is Jenkins's word for it. */
  | { code: "build_failed"; result: string; url: string | null }
  /** The build finished and no newer release tag appeared. */
  | { code: "no_newer_tag"; before: string | null; after: string | null }
  /** Waited the configured minutes and the build had made no new tag. */
  | { code: "build_timed_out"; minutes: number }
  /** A stage run on its own needs what an earlier stage records, and it is not there. */
  | { code: "missing_input"; stage: DeployStage }
  /** The exported activity data failed its checks; `errors` is how many. */
  | { code: "preflight_failed"; errors: number }
  /**
   * Media the exported data names are neither in the draft nor in the media repository:
   * `paths` are the first of them (paths in the media repository), `count` all of them.
   */
  | { code: "media_missing"; paths: string[]; count: number }
  /**
   * The Jenkins activity deploy ran for the configured minutes and had not finished; `target`
   * is absent for a QA deploy's (as runs before PROD deploys existed recorded it).
   */
  | { code: "deploy_timed_out"; minutes: number; target?: DeployTarget }
  /** The server stopped while the stage ran. */
  | { code: "interrupted" }
  /** Something the stage did not expect; the log says what. */
  | { code: "unexpected" };

/** What a run found out, gathered from its stages. */
export interface DeployRunMetadata {
  /** The version prepare_deploy wrote into package.json. */
  moduleVersion?: string;
  /** The commit prepare_deploy made on the deploy branch; absent when nothing had changed. */
  commit?: string;
  /** The newest plain semver tag before the build; null when the module had none. */
  preBuildTag?: string | null;
  /** The newest Jenkins build for this module before the trigger; null when there was none. */
  preBuildNumber?: number | null;
  /** The Jenkins build's page, once Jenkins has one. */
  moduleBuildUrl?: string;
  /** The release tag the build made. */
  resolvedModuleVersion?: string;
  /**
   * What the assembled module verify_module checked hashed to; null when there was none and
   * the module was verified as its repository held it. A QA deploy leaves out a release that
   * is done for the same hash.
   */
  moduleContentHash?: string | null;
  /** The ref numbers the exported data carries; archived refs are left out. */
  deployedRefNums?: number[];
  /** Every file export_activity_data wrote, relative to the activity-data clone. */
  exportedFiles?: string[];
  /** The draft revision of the deploying ref when its data was exported. */
  exportedRevision?: string;
  /** Every exported ref's revision as one, when the data was exported. */
  exportedProductRevision?: string;
  /** What verify_activity_data found. */
  preflight?: DeployPreflightReport;
  /** How many media files the exported data names. */
  mediaChecked?: number;
  /** The first media files copied into the media clone, and how many were copied. */
  mediaCopied?: string[];
  mediaCopiedCount?: number;
  /** The media commit pushed to main; absent when the repository already had every file. */
  mediaCommit?: string;
  /** The activity-data commit pushed; absent when nothing had changed. */
  activityDataCommit?: string;
  /** The framework version the activity was deployed with. */
  qaFrameworkVersion?: string;
  /** The newest Jenkins activity deploy before the trigger; null when there was none. */
  preDeployNumber?: number | null;
  /** The Jenkins activity deploy's page, once Jenkins has one. */
  activityDeployUrl?: string;
  /** Where the deployed activity opens on QA. */
  qaActivityUrl?: string;
  /** When the QA deploy finished. */
  qaDeployedAt?: string;
  /** The number of the Jenkins QA activity deploy that succeeded; null when Jenkins gave none. */
  activityDeployNumber?: number | null;
  /**
   * The draft revision of the deploying ref that is now on QA; on a PROD deploy, the one QA had
   * and PROD now has.
   */
  contentRevision?: string;
  /** Every exported ref's revision as one, as it is now on QA; the PROD gate compares it. */
  productRevision?: string;
  /** The framework version the activity was deployed to PROD with. */
  prodFrameworkVersion?: string;
  /** The newest Jenkins PROD activity deploy before the trigger; null when there was none. */
  preProductionDeployNumber?: number | null;
  /** The Jenkins PROD activity deploy's page, once Jenkins has one. */
  productionDeployUrl?: string;
  /** When the PROD deploy finished. */
  prodDeployedAt?: string;
  /** The number of the Jenkins PROD activity deploy that succeeded; null when Jenkins gave none. */
  productionDeployNumber?: number | null;
  /**
   * Set when a wait stage, run again on its own, found the build it had already recorded: nothing
   * new was deployed, and the deployed time is the one first recorded.
   */
  alreadyRecorded?: boolean;
}

/**
 * One thing the check of the exported activity data found. Files are named relative to the
 * activity-data clone; media by the reference as the file writes it.
 */
export type DeployPreflightIssue =
  /** The deploy list is missing or does not name exactly this product's template. */
  | { code: "deploy_list_mismatch"; file: string }
  /** A file the template or deploy list names is not there. */
  | { code: "file_missing"; file: string }
  /** A file is not JSON, or not the object it must be. */
  | { code: "file_invalid"; file: string }
  /** The template's main module is not the released module. */
  | { code: "layout_module_mismatch"; expected: string; found: string | null }
  /** The template has no source, so the deploy would publish no ref. */
  | { code: "no_sources" }
  /** A ref uses the assessment and its assessment has no items. */
  | { code: "assessment_empty"; file: string }
  /** The assessment's item count is not its `configuration.maxItems`. */
  | { code: "assessment_count_mismatch"; file: string; items: number; maxItems: number }
  /** A media reference is not a plain relative path under the media folder. */
  | { code: "media_path_unsafe"; file: string; reference: string }
  /** A media reference still points at this server's preview. */
  | { code: "media_preview_url"; file: string; reference: string }
  /** A media reference still carries the framework's token, which the media address replaces. */
  | { code: "media_token_left"; file: string; reference: string }
  /** Warning: a configuration names no media at all. */
  | { code: "configuration_without_media"; file: string };

export interface DeployPreflightReport {
  errors: DeployPreflightIssue[];
  warnings: DeployPreflightIssue[];
  counts: { templates: number; configurations: number; assessments: number; media: number };
}

export interface DeployRunStage {
  stage: DeployStage;
  status: DeployStageStatus;
  error: DeployStageError | null;
}

export interface DeployRun {
  runId: string;
  activityId: string;
  target: DeployTarget;
  selection: DeployStageSelection;
  status: DeployRunStatus;
  stages: DeployRunStage[];
  /** The release stages a QA deploy left out because the module's release was current. */
  skipped?: DeployStage[];
  metadata: DeployRunMetadata;
  startedAt: string;
  finishedAt: string | null;
}

/** Why a stage cannot be run now. */
export type DeployBlocker =
  /** The stage before it has not finished since it was last run. */
  | { code: "previous_stage"; stage: DeployStage }
  /**
   * The stage has run since the stage before it last did, and works on what that stage leaves
   * behind: the stage before it has to run again first.
   */
  | { code: "previous_rerun"; stage: DeployStage }
  /** A deploy is running on this server; one runs at a time. */
  | { code: "run_active" }
  | { code: "settings_missing"; field: string }
  | { code: "clone_missing"; repo: DeployRepo }
  | { code: "clone_dirty"; repo: DeployRepo }
  /** Another readiness problem stands in the way. */
  | { code: "not_ready"; problem: DeployProblem }
  /**
   * PROD only: QA's deploy is not of the activity as it is now. The activity data was published
   * or its deploy started again after QA's deploy finished, or the draft changed since the
   * revision QA has. Deploy to QA again first.
   */
  | { code: "qa_outdated" };

/** A stage as it stands for an activity, across runs: survives a restart. */
export interface DeployStageState {
  stage: DeployStage;
  status: DeployStageStatus;
  finishedAt: string | null;
  metadata: DeployRunMetadata;
  /** Null when the stage may be run now. */
  blocker: DeployBlocker | null;
}

/** The last deploy that finished on PROD. */
export interface DeployProductionRecord {
  runId: string;
  deployedAt: string;
  /** The deploying ref's draft revision PROD has; null when QA did not record one. */
  contentRevision: string | null;
  frameworkVersion: string | null;
  /** The Jenkins deploy's page; null when Jenkins gave none. */
  url: string | null;
}

/** Where PROD stands for an activity. */
export interface DeployProductionState {
  /** The two PROD stages, as the QA stage list gives its own. */
  stages: DeployStageState[];
  /** Why Deploy to PROD cannot start now; null when it can. */
  blocker: DeployBlocker | null;
  /** The last deploy that finished on PROD; null when there has been none. */
  last: DeployProductionRecord | null;
}

export interface DeployStateResponse {
  context: DeployContext;
  /** The activity's latest run, QA's or PROD's; null when it has had none. */
  run: DeployRun | null;
  /** The release and QA stages. */
  stages: DeployStageState[];
  production: DeployProductionState;
}

/**
 * A start: the release, the QA deploy, the PROD deploy or one stage, and optionally the
 * version to release the module as. A PROD deploy (or one of its stages) needs `confirm`,
 * which must be the activity's product code, and an admin who owns the project.
 */
export interface DeployStartRequest {
  stage: DeployStageSelection;
  moduleVersion?: string;
  /** Where the run deploys; absent, it follows from `stage`. */
  target?: DeployTarget;
  confirm?: string;
}

/**
 * An activity went live on a target: fired once each time a QA or PROD deploy finishes with
 * success, for whatever keeps track of deployed versions.
 */
export interface DeployedEvent {
  projectId: string;
  activityId: string;
  runId: string;
  target: DeployTarget;
  /** The deploying ref's draft revision that went live; null when none was recorded. */
  revision: string | null;
  deployedAt: string;
}

export interface DeployRunResponse {
  run: DeployRun;
}

export interface DeployLogLine {
  /** Increases by one per line within a run, from 1. */
  seq: number;
  at: string;
  text: string;
}

/** The log lines after a cursor; `done` once the run has ended and every line was sent. */
export interface DeployLogPage {
  lines: DeployLogLine[];
  /** The cursor for the next page: the last line's seq, or the cursor asked with. */
  next: number;
  done: boolean;
}

export interface DeployLogResponse {
  log: DeployLogPage;
  run: DeployRun;
}
