/**
 * Whether a deploy could start, built over a fake git and a fake disk: the ref must be the
 * canonical one, the layout mainOnly, the settings complete and the module's repository
 * known; each clone must be there, clean, pushed and pointing at the right remote, with main
 * in it. The deploy branches are reported, not required. The remote is asked only on request.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDeployContext, type DeployContextInput } from "../src/activities/deploy-context.js";
import {
  activityDataBranchName,
  cloneUrlFor,
  deployBranchName,
  deployClonePaths,
  moduleShortName,
  remoteKey,
  repositoryUrlOf,
  sameRemote,
  type DeployGitResult,
} from "../src/activities/deploy-git.js";
import {
  defaultDeploySettings,
  normalizeDeploySettings,
} from "../src/activities/deploy-settings.js";

const HOME = path.resolve("/penguin-home");
const MODULE_REMOTE = "git@github.com:org/waf-module-words.git";
const DATA_REMOTE = "git@github.com:org/data.git";
const MEDIA_REMOTE = "git@github.com:org/media.git";

interface FakeRepo {
  origin: string;
  branch?: string;
  dirty?: boolean;
  ahead?: number;
  branches?: string[];
  remoteBranches?: string[];
  /** The media clone's sparse folders; defaults to this product's. */
  sparse?: string[];
  /** `git status` fails. */
  statusFails?: boolean;
  /** The branch has no upstream, so git cannot count what is unpushed. */
  noUpstream?: boolean;
  /** The remote cannot be reached. */
  unreachable?: boolean;
}

/** A git that answers from a table of repositories by directory, recording every call. */
function fakeGit(repos: Record<string, FakeRepo>, options: { missing?: boolean } = {}) {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  const ok = (stdout = ""): DeployGitResult => ({ code: 0, stdout, stderr: "" });
  const run = async (args: string[], cwd: string): Promise<DeployGitResult> => {
    calls.push({ args, cwd });
    if (options.missing)
      return { code: null, stdout: "", stderr: "spawn git ENOENT", error: "not_found" };
    if (args[0] === "--version") return ok("git version 2.45.0");
    const repo = repos[cwd];
    if (!repo) return { code: 128, stdout: "", stderr: "not a git repository" };
    const joined = args.join(" ");
    if (joined === "rev-parse --abbrev-ref HEAD") return ok(`${repo.branch ?? "main"}\n`);
    if (joined === "status --porcelain")
      return repo.statusFails
        ? { code: 128, stdout: "", stderr: "fatal: index file corrupt" }
        : ok(repo.dirty ? " M file.txt\n" : "");
    if (joined === "rev-list --count @{u}..HEAD")
      return repo.noUpstream
        ? { code: 128, stdout: "", stderr: "fatal: no upstream configured" }
        : ok(`${repo.ahead ?? 0}\n`);
    if (joined === "sparse-checkout list")
      return ok(`${(repo.sparse ?? ["media/loom/words"]).join("\n")}\n`);
    if (joined === "remote get-url origin") return ok(`${repo.origin}\n`);
    if (args[0] === "rev-parse" && args[1] === "--verify") {
      const branch = args[3]!.replace("refs/heads/", "");
      return (repo.branches ?? ["main"]).includes(branch)
        ? ok("abc\n")
        : { code: 1, stdout: "", stderr: "" };
    }
    if (args[0] === "ls-remote") {
      if (repo.unreachable)
        return { code: 128, stdout: "", stderr: "ssh: Could not resolve hostname" };
      const branch = args[3]!.replace("refs/heads/", "");
      return ok(
        (repo.remoteBranches ?? ["main"]).includes(branch) ? `abc\trefs/heads/${branch}\n` : "",
      );
    }
    return { code: 1, stdout: "", stderr: `unexpected: ${joined}` };
  };
  return { run, calls };
}

const PATHS = deployClonePaths(HOME, "waf-module-words");

function completeSettings() {
  return normalizeDeploySettings(
    {
      qa: {
        jenkinsUrl: "https://jenkins.example.org",
        username: "robot",
        frameworkVersion: "4.2.1",
        activityBaseUrl: "https://qa.example.org",
      },
      repos: { activityDataRemote: DATA_REMOTE, mediaRemote: MEDIA_REMOTE },
      git: { userName: "Deploy", userEmail: "deploy@example.org" },
    },
    defaultDeploySettings(),
  ).settings;
}

function input(overrides: Partial<DeployContextInput> = {}): DeployContextInput {
  return {
    home: HOME,
    productCode: "words",
    moduleFolder: "waf-module-words",
    canonical: true,
    layout: "mainOnly",
    settings: completeSettings(),
    secrets: { qaToken: "t" },
    moduleRepository: "git+https://github.com/org/waf-module-words.git",
    checkRemote: false,
    ...overrides,
  };
}

/** All three clones on disk and healthy. */
function healthyRepos(): Record<string, FakeRepo> {
  return {
    [PATHS.module]: { origin: MODULE_REMOTE, branches: ["main"] },
    [PATHS.activityData]: { origin: DATA_REMOTE, branches: ["main", "loom/words-activity-data"] },
    [PATHS.media]: { origin: MEDIA_REMOTE },
  };
}

function disk(repos: Record<string, FakeRepo>) {
  return async (file: string) => Object.keys(repos).some((dir) => file === path.join(dir, ".git"));
}

describe("deploy context", () => {
  it("is ready when every check passes, and names Loom's branches", async () => {
    const repos = healthyRepos();
    const git = fakeGit(repos);
    const context = await buildDeployContext(input(), { git, exists: disk(repos) });
    expect(context.problems).toEqual([]);
    expect(context.ready).toBe(true);
    expect(context.branches).toEqual({
      deploy: "loom/words-deploy",
      activityData: "loom/words-activity-data",
    });
    expect(context.module).toMatchObject({ folder: "waf-module-words", remote: MODULE_REMOTE });
    expect(context.module.clone).toEqual({
      present: true,
      branch: "main",
      clean: true,
      ahead: 0,
      remoteUrlMatches: true,
    });
    // The deploy branch is not made yet: reported, not a problem.
    expect(context.branchState).toEqual({
      deploy: { local: false, remote: null },
      activityData: { local: true, remote: null },
    });
    // Without Check remote, nothing reaches the remote.
    expect(git.calls.some((call) => call.args[0] === "ls-remote")).toBe(false);
    expect(context.remoteChecked).toBe(false);
  });

  it("refuses a ref that is not the canonical one", async () => {
    const repos = healthyRepos();
    const context = await buildDeployContext(input({ canonical: false }), {
      git: fakeGit(repos),
      exists: disk(repos),
    });
    expect(context.ready).toBe(false);
    expect(context.problems).toEqual([{ code: "not_canonical" }]);
  });

  it("names an activity with no product, and a layout other than mainOnly", async () => {
    const context = await buildDeployContext(
      input({ moduleFolder: null, moduleRepository: null, layout: "mainAndSide" }),
      { git: fakeGit({}), exists: async () => false },
    );
    expect(context.problems).toEqual(
      expect.arrayContaining([
        { code: "no_module" },
        { code: "layout_unsupported", layout: "mainAndSide" },
      ]),
    );
    // No module, so no module clone is expected either.
    expect(context.problems).not.toContainEqual({ code: "clone_missing", repo: "module" });
    const none = await buildDeployContext(input({ layout: null }), {
      git: fakeGit(healthyRepos()),
      exists: disk(healthyRepos()),
    });
    // A spec that names no layout is mainOnly, as preview and assembly treat it.
    expect(none.problems).toEqual([]);
    expect(none.ready).toBe(true);
  });

  it("names each missing setting by field", async () => {
    const repos = healthyRepos();
    const context = await buildDeployContext(
      input({ settings: defaultDeploySettings(), secrets: {} }),
      { git: fakeGit(repos), exists: disk(repos) },
    );
    const fields = context.problems
      .filter((problem) => problem.code === "settings_missing")
      .map((problem) => (problem as { field: string }).field);
    expect(fields).toEqual([
      "qa.jenkinsUrl",
      "qa.username",
      "qa.token",
      "qa.frameworkVersion",
      "qa.activityBaseUrl",
      "repos.mediaRemote",
      "git.userName",
      "git.userEmail",
    ]);
  });

  it("names a module whose package.json names no repository", async () => {
    const repos = healthyRepos();
    const context = await buildDeployContext(input({ moduleRepository: null }), {
      git: fakeGit(repos),
      exists: disk(repos),
    });
    expect(context.problems).toContainEqual({ code: "module_remote_missing" });
    expect(context.module.remote).toBeNull();
    expect(context.module.clone.remoteUrlMatches).toBeNull();
  });

  it("refuses a module remote no clone may be made from", async () => {
    const repos = healthyRepos();
    for (const moduleRepository of [
      "file:///srv/modules/words.git",
      "/srv/modules/words.git",
      "http://git.example.org/org/words.git",
      "https://user:secret@git.example.org/org/words.git",
    ]) {
      const context = await buildDeployContext(input({ moduleRepository }), {
        git: fakeGit(repos),
        exists: disk(repos),
      });
      expect(context.problems).toContainEqual({ code: "module_remote_invalid" });
      expect(context.ready).toBe(false);
      expect(context.module.remote).toBeNull();
    }
  });

  it("is not ready when git cannot say whether a clone is clean or pushed", async () => {
    const repos = healthyRepos();
    repos[PATHS.module]!.statusFails = true;
    repos[PATHS.activityData]!.noUpstream = true;
    repos[PATHS.media]!.branch = "some-other-branch";
    const context = await buildDeployContext(input(), { git: fakeGit(repos), exists: disk(repos) });
    expect(context.ready).toBe(false);
    expect(context.problems).toEqual([
      { code: "clone_unknown", repo: "module", what: "status" },
      { code: "clone_unknown", repo: "activityData", what: "upstream" },
    ]);
    // Another checked-out branch is shown, not a problem: the deploy checks out main itself.
    expect(context.media.clone.branch).toBe("some-other-branch");
  });

  it("is not ready when the remote cannot be reached on Check remote", async () => {
    const repos = healthyRepos();
    repos[PATHS.activityData]!.unreachable = true;
    const context = await buildDeployContext(input({ checkRemote: true }), {
      git: fakeGit(repos),
      exists: disk(repos),
    });
    expect(context.ready).toBe(false);
    expect(context.problems).toEqual([{ code: "remote_unreachable", repo: "activityData" }]);
  });

  it("names a media clone that does not check out this product's folder", async () => {
    const repos = healthyRepos();
    repos[PATHS.media]!.sparse = ["media/loom/other"];
    const context = await buildDeployContext(input(), { git: fakeGit(repos), exists: disk(repos) });
    expect(context.ready).toBe(false);
    expect(context.problems).toEqual([{ code: "media_path_missing", path: "media/loom/words" }]);
  });

  it("names each missing clone", async () => {
    const context = await buildDeployContext(input(), {
      git: fakeGit({}),
      exists: async () => false,
    });
    expect(context.problems).toEqual([
      { code: "clone_missing", repo: "module" },
      { code: "clone_missing", repo: "activityData" },
      { code: "clone_missing", repo: "media" },
    ]);
    expect(context.media.clone.present).toBe(false);
  });

  it("names a dirty clone, one ahead of its upstream, one on the wrong remote, and missing main", async () => {
    const repos: Record<string, FakeRepo> = {
      [PATHS.module]: { origin: "git@github.com:someone/else.git" },
      [PATHS.activityData]: { origin: DATA_REMOTE, dirty: true, branches: [] },
      [PATHS.media]: { origin: MEDIA_REMOTE, ahead: 2 },
    };
    const context = await buildDeployContext(input(), { git: fakeGit(repos), exists: disk(repos) });
    expect(context.problems).toEqual([
      { code: "clone_remote_mismatch", repo: "module" },
      { code: "clone_dirty", repo: "activityData" },
      { code: "branch_missing", repo: "activityData", branch: "main", where: "local" },
      { code: "clone_ahead", repo: "media", count: 2 },
    ]);
  });

  it("asks the remote about main and the deploy branches only when asked to", async () => {
    const repos = healthyRepos();
    repos[PATHS.media]!.remoteBranches = [];
    repos[PATHS.module]!.remoteBranches = ["main", "loom/words-deploy"];
    const git = fakeGit(repos);
    const context = await buildDeployContext(input({ checkRemote: true }), {
      git,
      exists: disk(repos),
    });
    expect(context.remoteChecked).toBe(true);
    expect(context.problems).toEqual([
      { code: "branch_missing", repo: "media", branch: "main", where: "remote" },
    ]);
    expect(context.branchState.deploy).toEqual({ local: false, remote: true });
    expect(context.branchState.activityData).toEqual({ local: true, remote: false });
  });

  it("says git is unavailable, and still says which clones are on disk", async () => {
    const repos = healthyRepos();
    delete repos[PATHS.media];
    const context = await buildDeployContext(input(), {
      git: fakeGit(repos, { missing: true }),
      exists: disk(repos),
    });
    expect(context.problems).toEqual([
      { code: "git_unavailable" },
      { code: "clone_missing", repo: "media" },
    ]);
    expect(context.module.clone).toMatchObject({ present: true, clean: null });
  });
});

describe("deploy git helpers", () => {
  it("derives Loom's short name and branch names", () => {
    expect(moduleShortName("waf-module-words")).toBe("words");
    expect(moduleShortName("wafmodule-abc")).toBe("abc");
    expect(moduleShortName("custom")).toBe("custom");
    expect(deployBranchName("waf-module-words")).toBe("loom/words-deploy");
    expect(activityDataBranchName("PC1")).toBe("loom/PC1-activity-data");
  });

  it("reads package.json's repository in either shape", () => {
    expect(repositoryUrlOf({ repository: { url: " https://github.com/org/x.git " } })).toBe(
      "https://github.com/org/x.git",
    );
    expect(repositoryUrlOf({ repository: "org/x" })).toBe("org/x");
    expect(repositoryUrlOf({ repository: {} })).toBeNull();
    expect(repositoryUrlOf(null)).toBeNull();
  });

  it("clones GitHub modules over SSH and compares remotes across spellings", () => {
    expect(cloneUrlFor("git+https://github.com/Org/X.git")).toBe("git@github.com:org/x.git");
    expect(cloneUrlFor("github:org/x")).toBe("git@github.com:org/x.git");
    expect(cloneUrlFor("org/x")).toBe("git@github.com:org/x.git");
    expect(cloneUrlFor("https://gitlab.example.org/org/x.git")).toBe(
      "https://gitlab.example.org/org/x.git",
    );
    expect(remoteKey("ssh://git@github.com/org/x.git")).toBe("github.com/org/x");
    expect(sameRemote("git@github.com:org/x.git", "https://github.com/ORG/x")).toBe(true);
    expect(sameRemote("git@github.com:org/x.git", "git@github.com:org/y.git")).toBe(false);
    expect(sameRemote("", "")).toBe(false);
  });
});
