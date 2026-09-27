/**
 * What the Deploy section shows for a deploy context from the server: one row per check with
 * its tone and state in words, and every problem as a sentence. Pure, so web vitest can pin it
 * without a DOM. The server sends codes; the words are all here.
 */
import type {
  BranchState,
  CloneState,
  DeployContext,
  DeployProblem,
  DeployRepo,
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
    case "module_remote_missing":
      return words.module_remote_missing;
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
