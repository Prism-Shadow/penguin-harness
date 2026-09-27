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
  /** The git remotes activity data and media are published to. */
  repos: { activityDataRemote: string; mediaRemote: string };
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
  | "token_spaces";

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

export type DeployStage = (typeof DEPLOY_RELEASE_STAGES)[number];

/** What a run was asked to do: the whole release, or one stage on its own. */
export type DeployStageSelection = "release" | DeployStage;

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
  | { code: "not_ready"; problem: DeployProblem };

/** A stage as it stands for an activity, across runs: survives a restart. */
export interface DeployStageState {
  stage: DeployStage;
  status: DeployStageStatus;
  finishedAt: string | null;
  metadata: DeployRunMetadata;
  /** Null when the stage may be run now. */
  blocker: DeployBlocker | null;
}

export interface DeployStateResponse {
  context: DeployContext;
  /** The activity's latest run; null when it has had none. */
  run: DeployRun | null;
  stages: DeployStageState[];
}

/** A start: the whole release or one stage, and optionally the version to release as. */
export interface DeployStartRequest {
  stage: DeployStageSelection;
  moduleVersion?: string;
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
