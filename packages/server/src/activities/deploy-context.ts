/**
 * Whether a deploy of one activity could start, and what is missing if not.
 *
 * Built from facts the caller gathered (the activity, its product, the settings, the
 * module's repository) plus what git and the disk say about the three deploy clones. Every
 * git call and every disk look goes through the ports, so a test answers them with fakes.
 *
 * It reads only: nothing is cloned, fetched or written. The remote is reached only when the
 * engineer asked for it (`checkRemote`).
 */
import path from "node:path";
import {
  BASE_BRANCH,
  activityDataBranchName,
  branchState,
  cloneState,
  cloneUrlFor,
  deployBranchName,
  deployClonePaths,
  gitAvailable,
  localBranchExists,
  mediaSparsePath,
  remoteBranchExists,
  sparsePathPresent,
  type DeployGit,
} from "./deploy-git.js";
import {
  isAllowedRemote,
  missingSettings,
  type DeploySecrets,
  type DeploySettings,
} from "./deploy-settings.js";
import type { CloneState, DeployContext, DeployProblem, DeployRepo } from "./deploy-types.js";

/**
 * The only layout a deploy supports: the deploy job publishes one main scene set. A spec that
 * names no layout is mainOnly, as preview and assembly treat it.
 */
export const DEPLOY_LAYOUT = "mainOnly";

export interface DeployContextInput {
  /** PENGUIN_HOME: the clones live under it, and git is run from it. */
  home: string;
  productCode: string;
  /** The product's module folder; null when the activity belongs to no product. */
  moduleFolder: string | null;
  /** Whether the activity is its product's canonical ref. */
  canonical: boolean;
  /** The specification's `runtime.layout`; null when none is named (which means mainOnly). */
  layout: string | null;
  settings: DeploySettings;
  secrets: DeploySecrets;
  /** The module's package.json `repository`, as written; null when it names none. */
  moduleRepository: string | null;
  /** Ask the remote whether the branches are there (reaches the network). */
  checkRemote: boolean;
}

export interface DeployContextPorts {
  git: DeployGit;
  exists(file: string): Promise<boolean>;
}

const ABSENT: CloneState = {
  present: false,
  branch: null,
  clean: null,
  ahead: null,
  remoteUrlMatches: null,
};

export async function buildDeployContext(
  input: DeployContextInput,
  ports: DeployContextPorts,
): Promise<DeployContext> {
  const problems: DeployProblem[] = [];
  const folder = input.moduleFolder ?? "";
  if (input.moduleFolder === null) problems.push({ code: "no_module" });
  else if (!input.canonical) problems.push({ code: "not_canonical" });
  const layout = input.layout ?? DEPLOY_LAYOUT;
  if (layout !== DEPLOY_LAYOUT) problems.push({ code: "layout_unsupported", layout });
  for (const field of missingSettings(input.settings, input.secrets))
    problems.push({ code: "settings_missing", field });
  const named = input.moduleRepository ? cloneUrlFor(input.moduleRepository) : null;
  // The module's remote comes from a package.json, not the admin: it must pass the same rule
  // the settings' remotes do before anything is cloned from it.
  const moduleRemote = named !== null && isAllowedRemote(named) ? named : null;
  if (input.moduleFolder !== null && named === null)
    problems.push({ code: "module_remote_missing" });
  else if (input.moduleFolder !== null && moduleRemote === null)
    problems.push({ code: "module_remote_invalid" });

  const branches = {
    deploy: folder ? deployBranchName(folder) : "",
    activityData: activityDataBranchName(input.productCode),
  };
  const paths = deployClonePaths(input.home, folder || "_");
  const repos: Array<{ repo: DeployRepo; dir: string; remote: string | null; used: boolean }> = [
    { repo: "module", dir: paths.module, remote: moduleRemote, used: folder !== "" },
    {
      repo: "activityData",
      dir: paths.activityData,
      remote: input.settings.repos.activityDataRemote || null,
      used: true,
    },
    {
      repo: "media",
      dir: paths.media,
      remote: input.settings.repos.mediaRemote || null,
      used: true,
    },
  ];
  const present = await Promise.all(
    repos.map((entry) =>
      entry.used ? ports.exists(path.join(entry.dir, ".git")) : Promise.resolve(false),
    ),
  );

  const gitOk = await gitAvailable(ports.git, input.home);
  if (!gitOk) problems.push({ code: "git_unavailable" });

  const states = await Promise.all(
    repos.map((entry, index) =>
      !entry.used
        ? Promise.resolve(ABSENT)
        : gitOk
          ? cloneState(ports.git, entry.dir, entry.remote, present[index]!)
          : Promise.resolve({ ...ABSENT, present: present[index]! }),
    ),
  );

  for (const [index, entry] of repos.entries()) {
    if (!entry.used) continue;
    const state = states[index]!;
    if (!state.present) {
      problems.push({ code: "clone_missing", repo: entry.repo });
      continue;
    }
    if (!gitOk) continue;
    if (state.clean === false) problems.push({ code: "clone_dirty", repo: entry.repo });
    if (state.remoteUrlMatches === false)
      problems.push({ code: "clone_remote_mismatch", repo: entry.repo });
    if (state.ahead !== null && state.ahead > 0)
      problems.push({ code: "clone_ahead", repo: entry.repo, count: state.ahead });
    // What git could not say is not ready: a deploy must not start on a guess.
    if (state.clean === null)
      problems.push({ code: "clone_unknown", repo: entry.repo, what: "status" });
    if (state.ahead === null)
      problems.push({ code: "clone_unknown", repo: entry.repo, what: "upstream" });
    // The checked-out branch is only shown: the deploy checks out main itself, and a clean
    // clone with nothing unpushed can switch safely.
    if (entry.repo === "media") {
      const sparse = mediaSparsePath(input.productCode);
      const included = await sparsePathPresent(ports.git, entry.dir, sparse);
      if (included === false) problems.push({ code: "media_path_missing", path: sparse });
      if (included === null)
        problems.push({ code: "clone_unknown", repo: entry.repo, what: "sparse" });
    }
    // Every deploy branch is made from main, so main must be there.
    const [local, remote] = await Promise.all([
      localBranchExists(ports.git, entry.dir, BASE_BRANCH),
      input.checkRemote
        ? remoteBranchExists(ports.git, entry.dir, BASE_BRANCH)
        : Promise.resolve(null),
    ]);
    if (local === null) problems.push({ code: "clone_unknown", repo: entry.repo, what: "branch" });
    if (input.checkRemote && remote === null)
      problems.push({ code: "remote_unreachable", repo: entry.repo });
    if (local === false)
      problems.push({
        code: "branch_missing",
        repo: entry.repo,
        branch: BASE_BRANCH,
        where: "local",
      });
    if (remote === false)
      problems.push({
        code: "branch_missing",
        repo: entry.repo,
        branch: BASE_BRANCH,
        where: "remote",
      });
  }

  const moduleState = states[0]!;
  const dataState = states[1]!;
  const [deployBranch, dataBranch] = await Promise.all([
    gitOk && folder
      ? branchState(
          ports.git,
          paths.module,
          moduleState.present,
          branches.deploy,
          input.checkRemote,
        )
      : Promise.resolve({ local: null, remote: null }),
    gitOk
      ? branchState(
          ports.git,
          paths.activityData,
          dataState.present,
          branches.activityData,
          input.checkRemote,
        )
      : Promise.resolve({ local: null, remote: null }),
  ]);

  return {
    ready: problems.length === 0,
    problems,
    remoteChecked: input.checkRemote && gitOk,
    module: { folder, remote: moduleRemote, clone: moduleState },
    activityData: { clone: dataState },
    media: { clone: states[2]! },
    branches,
    branchState: { deploy: deployBranch, activityData: dataBranch },
  };
}
