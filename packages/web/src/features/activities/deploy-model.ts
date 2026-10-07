/**
 * What the Deploy section shows for a deploy context from the server: one row per check with
 * its tone and state in words, and every problem as a sentence. Pure, so web vitest can pin it
 * without a DOM. The server sends codes; the words are all here.
 */
import type {
  BranchState,
  CloneState,
  DeployBlocker,
  DeployContext,
  DeployLogLine,
  DeployLogPage,
  DeployPreflightIssue,
  DeployProblem,
  DeployProductionState,
  DeployRepo,
  DeployRun,
  DeployStage,
  DeployStageError,
  DeployStageState,
  DeployStageStatus,
} from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import type { Tone } from "../../lib/tone";

export interface ReadinessRow {
  id: string;
  label: string;
  tone: Tone;
  /** The state in words: colour never carries it alone. */
  state: string;
}

const REPOS: readonly DeployRepo[] = ["module", "activityData", "media"];

/** A repository's name in words. */
export function repoName(repo: DeployRepo): string {
  return S.activities.deploy.repos[repo];
}

/** A settings field's name in words, or its path when this build has no name for it. */
export function fieldName(field: string): string {
  return S.activities.deploy.fields[field] ?? field;
}

/** One problem as a sentence. */
export function problemText(problem: DeployProblem): string {
  const words = S.activities.deploy.problems;
  switch (problem.code) {
    case "settings_missing":
      return words.settings_missing(fieldName(problem.field));
    case "workspace_not_ready":
      return words.workspace_not_ready;
    case "module_remote_invalid":
      return words.module_remote_invalid;
    case "clone_missing":
      return words.clone_missing(repoName(problem.repo));
    case "clone_unknown":
      return words.clone_unknown(repoName(problem.repo), problem.what);
    case "remote_unreachable":
      return words.remote_unreachable(repoName(problem.repo));
    case "media_path_missing":
      return words.media_path_missing(problem.path);
    case "clone_dirty":
      return words.clone_dirty(repoName(problem.repo));
    case "clone_ahead":
      return words.clone_ahead(repoName(problem.repo), problem.count);
    case "clone_remote_mismatch":
      return words.clone_remote_mismatch(repoName(problem.repo));
    case "branch_missing":
      return words.branch_missing(repoName(problem.repo), problem.branch, problem.where);
    case "not_canonical":
      return words.not_canonical;
    case "no_module":
      return words.no_module;
    case "layout_unsupported":
      return words.layout_unsupported(problem.layout);
    case "git_unavailable":
      return words.git_unavailable;
  }
}

function has(context: DeployContext, code: DeployProblem["code"]): DeployProblem | undefined {
  return context.problems.find((problem) => problem.code === code);
}

function cloneRow(context: DeployContext, repo: DeployRepo, clone: CloneState): ReadinessRow {
  const words = S.activities.deploy;
  const mine = context.problems.filter((problem) => "repo" in problem && problem.repo === repo);
  const base = { id: `clone:${repo}`, label: words.rows.clone(repoName(repo)) };
  if (!clone.present) return { ...base, tone: "attention", state: words.clone.missing };
  const states: string[] = [];
  for (const problem of mine) {
    if (problem.code === "clone_dirty") states.push(words.clone.dirty);
    if (problem.code === "clone_remote_mismatch") states.push(words.clone.remoteMismatch);
    if (problem.code === "clone_ahead") states.push(words.clone.ahead(problem.count));
    if (problem.code === "clone_unknown") states.push(words.clone.notKnown[problem.what]);
    if (problem.code === "remote_unreachable") states.push(words.clone.remoteUnreachable);
    if (problem.code === "branch_missing")
      states.push(words.problems.branch_missing(repoName(repo), problem.branch, problem.where));
  }
  if (repo === "media") {
    const sparse = has(context, "media_path_missing");
    if (sparse && sparse.code === "media_path_missing")
      states.push(words.clone.mediaPathMissing(sparse.path));
  }
  if (states.length) return { ...base, tone: "danger", state: states.join(" · ") };
  if (clone.clean === null) return { ...base, tone: "attention", state: words.clone.unknown };
  return { ...base, tone: "success", state: words.clone.present(clone.branch) };
}

function branchRow(id: string, name: string, state: BranchState, checked: boolean): ReadinessRow {
  const words = S.activities.deploy.branch;
  const local =
    state.local === true ? words.local : state.local === false ? words.notYet : words.unknown;
  const remote = !checked
    ? words.remoteUnknown
    : state.remote === true
      ? words.onRemote
      : state.remote === false
        ? words.notOnRemote
        : words.remoteUnknown;
  // A branch that is not made yet is not a problem: the deploy makes it.
  const tone: Tone = state.local === true || state.remote === true ? "success" : "muted";
  return { id, label: S.activities.deploy.rows.branch(name), tone, state: `${local} · ${remote}` };
}

/** Every check, in the order an engineer would fix them. */
export function readinessRows(context: DeployContext): ReadinessRow[] {
  const words = S.activities.deploy;
  const rows: ReadinessRow[] = [];
  rows.push(
    has(context, "no_module")
      ? { id: "ref", label: words.rows.ref, tone: "danger", state: words.states.noModule }
      : has(context, "not_canonical")
        ? { id: "ref", label: words.rows.ref, tone: "danger", state: words.states.notCanonical }
        : { id: "ref", label: words.rows.ref, tone: "success", state: words.states.canonical },
  );
  const layout = has(context, "layout_unsupported");
  rows.push({
    id: "layout",
    label: words.rows.layout,
    tone: layout ? "danger" : "success",
    state:
      layout && layout.code === "layout_unsupported"
        ? layout.layout
          ? words.states.layout(layout.layout)
          : words.states.noLayout
        : "mainOnly",
  });
  const missing = context.problems.filter((problem) => problem.code === "settings_missing");
  rows.push({
    id: "settings",
    label: words.rows.settings,
    tone: missing.length ? "danger" : "success",
    state: missing.length
      ? words.states.settingsMissing(missing.length)
      : words.states.settingsComplete,
  });
  rows.push({
    id: "git",
    label: words.rows.git,
    tone: has(context, "git_unavailable") ? "danger" : "success",
    state: has(context, "git_unavailable")
      ? words.states.gitUnavailable
      : words.states.gitAvailable,
  });
  if (!has(context, "no_module"))
    rows.push({
      id: "moduleRemote",
      label: words.rows.moduleRemote,
      tone: context.module.remote ? "success" : "danger",
      state:
        context.module.remote ??
        (has(context, "module_remote_invalid")
          ? words.problems.module_remote_invalid
          : words.states.noRemote),
    });
  const clones: Record<DeployRepo, CloneState> = {
    module: context.module.clone,
    activityData: context.activityData.clone,
    media: context.media.clone,
  };
  for (const repo of REPOS) {
    if (repo === "module" && has(context, "no_module")) continue;
    rows.push(cloneRow(context, repo, clones[repo]));
  }
  if (context.branches.deploy)
    rows.push(
      branchRow(
        "branch:deploy",
        context.branches.deploy,
        context.branchState.deploy,
        context.remoteChecked,
      ),
    );
  rows.push(
    branchRow(
      "branch:activityData",
      context.branches.activityData,
      context.branchState.activityData,
      context.remoteChecked,
    ),
  );
  return rows;
}

/** The one line above the checks. */
export function readinessLine(context: DeployContext): { tone: Tone; text: string } {
  const words = S.activities.deploy;
  return context.ready
    ? { tone: "success", text: words.ready }
    : { tone: "danger", text: words.notReady(context.problems.length) };
}

/** Whether the admin's settings are what is missing, so the page points at them. */
export function needsSettings(context: DeployContext): boolean {
  return context.problems.some((problem) => problem.code === "settings_missing");
}

/** Whether Prepare clones has anything to make: a missing clone, or media not checked out. */
export function clonesMissing(context: DeployContext): boolean {
  return context.problems.some(
    (problem) => problem.code === "clone_missing" || problem.code === "media_path_missing",
  );
}

// ---------------------------------------------------------------------------
// The module release
// ---------------------------------------------------------------------------

/** The release stages in the order they run, as the server names them. */
export const RELEASE_STAGES: readonly DeployStage[] = [
  "verify_module",
  "prepare_deploy",
  "trigger_module_build",
  "await_module_build",
];

/** The QA deploy's own stages, after the release, in the order they run. */
export const QA_STAGES: readonly DeployStage[] = [
  "export_activity_data",
  "verify_activity_data",
  "verify_media_assets",
  "publish_activity_data",
  "trigger_activity_deploy",
  "await_activity_deploy",
];

/** The PROD deploy's stages, after a current QA deploy, in the order they run. */
export const PROD_STAGES: readonly DeployStage[] = [
  "trigger_production_deploy",
  "await_production_deploy",
];

/** The log lines the panel keeps: the server keeps no more in memory either. */
export const LOG_KEEP = 2000;

const STATUS_TONE: Record<DeployStageStatus, Tone> = {
  pending: "muted",
  running: "busy",
  done: "success",
  failed: "danger",
  cancelled: "attention",
};

export function stageName(stage: DeployStage): string {
  return S.activities.deploy.stages[stage];
}

/** Why a stage ended badly, as a sentence. */
export function stageErrorText(error: DeployStageError): string {
  const words = S.activities.deploy.errors;
  switch (error.code) {
    case "command_failed":
      return words.command_failed(error.command, error.exitCode);
    case "command_timed_out":
      return words.command_timed_out(error.command);
    case "command_missing":
      return words.command_missing(error.command);
    case "jenkins_failed":
      return words.jenkins_failed(error.status);
    case "build_failed":
      return words.build_failed(error.result);
    case "no_newer_tag":
      return words.no_newer_tag(error.before, error.after);
    case "build_timed_out":
      return words.build_timed_out(error.minutes);
    case "missing_input":
      return words.missing_input(stageName(error.stage));
    case "preflight_failed":
      return words.preflight_failed(error.errors);
    case "media_missing":
      return words.media_missing(error.paths, error.count);
    case "deploy_timed_out":
      return words.deploy_timed_out(error.minutes, error.target);
    case "module_repository_missing":
      return words.module_repository_missing(error.remote);
    case "interrupted":
      return words.interrupted;
    case "unexpected":
      return words.unexpected;
  }
}

/** Why a stage cannot be run now, as a sentence. */
export function blockerText(blocker: DeployBlocker): string {
  const words = S.activities.deploy.blockers;
  switch (blocker.code) {
    case "previous_stage":
      return words.previous_stage(stageName(blocker.stage));
    case "previous_rerun":
      return words.previous_rerun(stageName(blocker.stage));
    case "run_active":
      return words.run_active;
    case "settings_missing":
      return words.settings_missing(fieldName(blocker.field));
    case "clone_missing":
      return words.clone_missing(repoName(blocker.repo));
    case "clone_dirty":
      return words.clone_dirty(repoName(blocker.repo));
    case "not_ready":
      return words.not_ready(problemText(blocker.problem));
    case "qa_outdated":
      return words.qa_outdated;
  }
}

const STAGES: readonly DeployStage[] = [...RELEASE_STAGES, ...QA_STAGES, ...PROD_STAGES];

function asStage(value: string | undefined): DeployStage | null {
  return STAGES.find((stage) => stage === value) ?? null;
}

function asRepo(value: string | undefined): DeployRepo | null {
  return REPOS.find((repo) => repo === value) ?? null;
}

/**
 * A `deploy_blocked` refusal's detail as a sentence: the blocker it names, worded as the stage
 * list words it. Null when the detail names none this App knows, so the caller falls back to
 * the code's own words.
 */
export function refusalText(detail: Readonly<Record<string, string>> | undefined): string | null {
  if (!detail) return null;
  const previous = asStage(detail.previous);
  const repo = asRepo(detail.repo);
  switch (detail.blocker) {
    case "previous_stage":
      return previous ? blockerText({ code: "previous_stage", stage: previous }) : null;
    case "previous_rerun":
      return previous ? blockerText({ code: "previous_rerun", stage: previous }) : null;
    case "run_active":
      return blockerText({ code: "run_active" });
    case "settings_missing":
      return detail.field ? blockerText({ code: "settings_missing", field: detail.field }) : null;
    case "clone_missing":
      return repo ? blockerText({ code: "clone_missing", repo }) : null;
    case "clone_dirty":
      return repo ? blockerText({ code: "clone_dirty", repo }) : null;
    case "qa_outdated":
      return blockerText({ code: "qa_outdated" });
    default:
      return null;
  }
}

export interface StageRow {
  stage: DeployStage;
  label: string;
  status: DeployStageStatus;
  tone: Tone;
  /** The status in words: colour never carries it alone. */
  statusText: string;
  /** Why it ended badly, when the latest run says. */
  error: string | null;
  /** Why it cannot run now; null when it can. */
  blocker: string | null;
}

/**
 * One row per stage. While a run is going its stages' live states win over the stored ones
 * (which the server set before it started), and nothing may be started; once it has ended the
 * stored states are the truth, and a failed stage says why from the run that failed it.
 */
export function stageRows(run: DeployRun | null, stages: readonly DeployStageState[]): StageRow[] {
  const running = run?.status === "running";
  const words = S.activities.deploy;
  return stages.map((state) => {
    const live = run?.stages.find((entry) => entry.stage === state.stage);
    const status: DeployStageStatus = running && live ? live.status : state.status;
    const error =
      live?.error && status === "failed" && live.status === "failed"
        ? stageErrorText(live.error)
        : null;
    const blocker = running
      ? words.blockers.run_active
      : state.blocker
        ? blockerText(state.blocker)
        : null;
    return {
      stage: state.stage,
      label: stageName(state.stage),
      status,
      tone: STATUS_TONE[status],
      statusText: words.statuses[status],
      error,
      blocker,
    };
  });
}

/** Whether a run went further than the module release: a QA deploy, or a QA stage on its own. */
export function isQaRun(run: DeployRun): boolean {
  return run.selection === "qa" || QA_STAGES.includes(run.selection as DeployStage);
}

/** Whether a run deployed to PROD: the PROD deploy, or one of its stages on its own. */
export function isProdRun(run: DeployRun): boolean {
  return run.target === "prod";
}

/** The line above the stages: how the latest run stands. */
export function runLine(run: DeployRun | null): { tone: Tone; text: string } | null {
  if (!run) return null;
  const words = isProdRun(run)
    ? S.activities.deploy.prod.runStatuses
    : isQaRun(run)
      ? S.activities.deploy.qaRunStatuses
      : S.activities.deploy.runStatuses;
  switch (run.status) {
    case "running": {
      const current = run.stages.find((entry) => entry.status === "running") ?? run.stages[0];
      return { tone: "busy", text: words.running(current ? stageName(current.stage) : "") };
    }
    case "succeeded":
      return { tone: "success", text: words.succeeded };
    case "failed":
      return { tone: "danger", text: words.failed };
    case "cancelled":
      return { tone: "attention", text: words.cancelled };
    case "interrupted":
      return { tone: "attention", text: words.interrupted };
  }
}

/**
 * The lines kept after a page arrives: only lines newer than the newest kept, so a page asked
 * twice (a slow poll overtaken by the next) never shows a line twice; at most LOG_KEEP.
 */
export function appendLog(lines: readonly DeployLogLine[], page: DeployLogPage): DeployLogLine[] {
  const newest = lines.length ? lines[lines.length - 1]!.seq : 0;
  const fresh = page.lines.filter((line) => line.seq > newest);
  if (!fresh.length) return lines as DeployLogLine[];
  const next = [...lines, ...fresh];
  return next.length > LOG_KEEP ? next.slice(next.length - LOG_KEEP) : next;
}

/** A version an engineer typed: empty (keep the one in package.json) or plain semver. */
export function versionProblem(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(text)
    ? null
    : S.activities.deploy.moduleVersionInvalid;
}

/** One finding of the check of the exported activity data, as a sentence. */
export function preflightText(issue: DeployPreflightIssue): string {
  const words = S.activities.deploy.preflight;
  switch (issue.code) {
    case "deploy_list_mismatch":
      return words.deploy_list_mismatch(issue.file);
    case "file_missing":
      return words.file_missing(issue.file);
    case "file_invalid":
      return words.file_invalid(issue.file);
    case "layout_module_mismatch":
      return words.layout_module_mismatch(issue.expected, issue.found);
    case "no_sources":
      return words.no_sources;
    case "assessment_empty":
      return words.assessment_empty(issue.file);
    case "assessment_count_mismatch":
      return words.assessment_count_mismatch(issue.file, issue.items, issue.maxItems);
    case "media_path_unsafe":
      return words.media_path_unsafe(issue.file, issue.reference);
    case "media_preview_url":
      return words.media_preview_url(issue.file, issue.reference);
    case "media_token_left":
      return words.media_token_left(issue.file, issue.reference);
    case "configuration_without_media":
      return words.configuration_without_media(issue.file);
  }
}

/** The check's findings to show: from the latest run while it has them, else the stored stage. */
export function preflightFindings(
  run: DeployRun | null,
  stages: readonly DeployStageState[],
): { errors: string[]; warnings: string[] } | null {
  const report =
    run?.metadata.preflight ??
    stages.find((state) => state.stage === "verify_activity_data")?.metadata.preflight;
  if (!report || (!report.errors.length && !report.warnings.length)) return null;
  return {
    errors: report.errors.map(preflightText),
    warnings: report.warnings.map(preflightText),
  };
}

/**
 * Where the activity is on QA, once a QA deploy finished: the address and the module version it
 * was deployed with, from the stored stages so it survives a reload. Null until one has.
 */
export function qaResult(
  stages: readonly DeployStageState[],
): { url: string; version: string | null } | null {
  const done = stages.find((state) => state.stage === "await_activity_deploy");
  if (done?.status !== "done" || !done.metadata.qaActivityUrl) return null;
  const exported = stages.find((state) => state.stage === "export_activity_data");
  return {
    url: done.metadata.qaActivityUrl,
    version:
      done.metadata.resolvedModuleVersion ?? exported?.metadata.resolvedModuleVersion ?? null,
  };
}

/**
 * What a stage run on its own asks before it starts, when it pushes or starts a Jenkins job;
 * null for a stage that only works on this server's clones or waits.
 */
export function stageConfirmText(
  stage: DeployStage,
  branches: { deploy: string; activityData: string },
): string | null {
  const words = S.activities.deploy;
  switch (stage) {
    case "trigger_module_build":
      return words.triggerConfirm(branches.deploy);
    case "verify_media_assets":
      return words.stageConfirm.verify_media_assets;
    case "publish_activity_data":
      return words.stageConfirm.publish_activity_data(branches.activityData);
    case "trigger_activity_deploy":
      return words.stageConfirm.trigger_activity_deploy;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// The PROD deploy
// ---------------------------------------------------------------------------

/** What the PROD bar shows: its stages, whether it may start and why not, and the last deploy. */
export interface ProdBar {
  rows: StageRow[];
  /** The latest PROD run's line while it is the latest run; null otherwise. */
  line: { tone: Tone; text: string } | null;
  /** Why Deploy to PROD cannot start now; null when it can. */
  blocker: string | null;
  /** The last PROD deploy in words, or that there has been none. */
  last: string;
  /** The last PROD deploy's Jenkins page; null when there is none. */
  lastUrl: string | null;
}

/**
 * The PROD bar for the state the server sent. `run` is the activity's latest run, QA's or
 * PROD's: its live stage states show only while it is a PROD run, and while any run goes
 * nothing may start. `when` words a timestamp.
 */
export function prodBar(
  production: DeployProductionState,
  run: DeployRun | null,
  when: (iso: string) => string,
): ProdBar {
  const words = S.activities.deploy;
  const prodRun = run && isProdRun(run) ? run : null;
  const running = run?.status === "running";
  const rows = stageRows(prodRun ?? (running ? run : null), production.stages);
  const blocker = running
    ? words.blockers.run_active
    : production.blocker
      ? blockerText(production.blocker)
      : null;
  const last = production.last;
  return {
    rows,
    line: prodRun ? runLine(prodRun) : null,
    blocker,
    last: last ? words.prod.last(when(last.deployedAt), last.frameworkVersion) : words.prod.never,
    lastUrl: last?.url ?? null,
  };
}

/** A typed confirmation matches the product code exactly. */
export function prodConfirmed(typed: string, productCode: string): boolean {
  return typed === productCode;
}

/** A refused PROD start in words, for the codes the PROD deploy adds; null for the others. */
export function prodRefusalText(code: string | undefined): string | null {
  const words = S.activities.deploy.prod.refused;
  if (code === "confirmation_mismatch") return words.confirmation_mismatch;
  if (code === "prod_requires_admin") return words.prod_requires_admin;
  return null;
}
