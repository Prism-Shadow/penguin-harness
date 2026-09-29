/**
 * The WAF workspace: the checkouts authoring, the sandbox and deploys work in — the framework,
 * the navbar module, the media repository, the activity-data repository, and one repository
 * per product module — laid out as a WAF checkout is, so everything that reads one reads this.
 *
 * Penguin makes and keeps these itself under `<PENGUIN_HOME>/waf`, so nobody has to clone
 * and maintain a WAF checkout by hand. An admin may instead name an existing checkout (or the
 * server may be started with WAF_ROOT_DIR); then Penguin only reads its state and never
 * clones, installs or fetches into it.
 *
 * Media is large and in Git LFS, so its clone is partial and sparse: it starts with no
 * folders and gains a product's folder when that product needs it, fetching only that
 * folder's LFS objects (the approach of the media-workspaces prototype).
 *
 * git authenticates with the host's own SSH keys; Penguin stores no git credential. Every git
 * and npm call goes through `WafWorkspacePorts`, which a test replaces.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Component, Interface, Use } from "@prismshadow/penguin-core/kernel";
import { HttpError } from "../http/errors.js";
import type { Config } from "../hmr/capabilities.js";
import type { Settings } from "../mechanisms/settings.js";
import { sameRemote, spawnGit, type DeployGit } from "./deploy-git.js";
import { spawnDeployProcess, type DeployProcess } from "./deploy-process.js";
import { DEPLOY_SETTINGS_KEY, normalizeRemote } from "./deploy-settings.js";
import { findWafRoot } from "./waf-module.js";
import type {
  WafRepoId,
  WafRepoStatus,
  WafWorkspaceSettings,
  WafWorkspaceStatus,
} from "./waf-workspace-types.js";

export type {
  WafRepoId,
  WafRepoSetting,
  WafRepoStatus,
  WafWorkspaceSettings,
  WafWorkspaceStatus,
} from "./waf-workspace-types.js";

/** The `server_settings` key the workspace settings are stored under. */
export const WAF_WORKSPACE_SETTINGS_KEY = "wafWorkspace";

/** The directory under PENGUIN_HOME a managed workspace lives in. */
export const WAF_WORKSPACE_DIR = "waf";

/** How long one clone or install may take: a large history or dependency tree on a slow link. */
export const WAF_LONG_TIMEOUT_MS = 20 * 60 * 1000;

/** How many lines of the latest preparation's log are kept. */
export const WAF_LOG_LINES = 200;

/** The shared repositories every activity needs; product modules are cloned on demand. */
export const WAF_REPO_IDS: readonly WafRepoId[] = ["framework", "navbar", "media", "activityData"];

/** Where each shared repository sits in the workspace, as a WAF checkout places it. */
export const WAF_REPO_PATHS: Record<WafRepoId, string> = {
  framework: "framework",
  navbar: "modules/navbar",
  media: "media",
  activityData: "waf-activity-data",
};

/** The repositories whose dependencies are installed: the player and navbar build with them. */
const INSTALLED: ReadonlySet<WafRepoId> = new Set(["framework", "navbar"]);

/** The placeholder a module remote template names the module folder with. */
export const MODULE_PLACEHOLDER = "{module}";

export function defaultWafWorkspaceSettings(): WafWorkspaceSettings {
  const github = (name: string) => `git@github.com:waterfordresearchinstitute/${name}.git`;
  return {
    externalRoot: "",
    repos: {
      // v2 is the framework line modules build against; the repository's default is not.
      framework: { remote: github("waf-framework"), branch: "v2" },
      navbar: { remote: github("waf-module-navbar"), branch: "main" },
      media: { remote: github("waf-media"), branch: "main" },
      activityData: { remote: github("waf-activity-data"), branch: "main" },
    },
    moduleRemote: github(MODULE_PLACEHOLDER),
  };
}

type Group = Record<string, unknown>;
const asGroup = (value: unknown): Group =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Group) : {};

/** The stored settings, read tolerantly: a missing or mistyped field takes its default. */
export function readWafWorkspaceSettings(raw: string | null): WafWorkspaceSettings {
  const out = defaultWafWorkspaceSettings();
  let stored: Group = {};
  try {
    stored = raw === null ? {} : asGroup(JSON.parse(raw));
  } catch {
    stored = {};
  }
  if (typeof stored.externalRoot === "string") out.externalRoot = stored.externalRoot;
  if (typeof stored.moduleRemote === "string") out.moduleRemote = stored.moduleRemote;
  const repos = asGroup(stored.repos);
  for (const id of WAF_REPO_IDS) {
    const repo = asGroup(repos[id]);
    if (typeof repo.remote === "string") out.repos[id].remote = repo.remote;
    if (typeof repo.branch === "string") out.repos[id].branch = repo.branch;
  }
  return out;
}

const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

function invalid(field: string, message: string): HttpError {
  return new HttpError(400, "waf_workspace_invalid", `${field} ${message}`, undefined, {
    field,
  });
}

/**
 * An update merged over the stored settings; a field left out keeps its value. Rejects the
 * whole update when any field is wrong, so nothing half-applies.
 */
export function normalizeWafWorkspaceSettings(
  current: WafWorkspaceSettings,
  input: unknown,
): WafWorkspaceSettings {
  const body = asGroup(input);
  const out: WafWorkspaceSettings = structuredClone(current);
  if (body.externalRoot !== undefined) {
    if (typeof body.externalRoot !== "string") throw invalid("externalRoot", "must be text.");
    const root = body.externalRoot.trim();
    if (root && !path.isAbsolute(root)) throw invalid("externalRoot", "must be an absolute path.");
    out.externalRoot = root;
  }
  if (body.moduleRemote !== undefined) {
    if (typeof body.moduleRemote !== "string") throw invalid("moduleRemote", "must be text.");
    const template = body.moduleRemote.trim();
    if (!template.includes(MODULE_PLACEHOLDER))
      throw invalid("moduleRemote", `must name the module folder as ${MODULE_PLACEHOLDER}.`);
    normalizeRemote(template.replaceAll(MODULE_PLACEHOLDER, "waf-module-x"), "moduleRemote");
    out.moduleRemote = template;
  }
  const repos = asGroup(body.repos);
  for (const id of WAF_REPO_IDS) {
    const repo = asGroup(repos[id]);
    if (repo.remote !== undefined) {
      const remote = normalizeRemote(repo.remote, `repos.${id}.remote`);
      if (!remote) throw invalid(`repos.${id}.remote`, "is required.");
      out.repos[id].remote = remote;
    }
    if (repo.branch !== undefined) {
      const branch = typeof repo.branch === "string" ? repo.branch.trim() : "";
      if (!BRANCH.test(branch) || branch.includes(".."))
        throw invalid(`repos.${id}.branch`, "must be a branch name.");
      out.repos[id].branch = branch;
    }
  }
  return out;
}

/** A module folder a repository may be made for: one path segment, as WAF names them. */
export function checkModuleFolder(folder: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(folder) || folder.includes(".."))
    throw new HttpError(400, "module_folder_invalid", "Not a module folder name.");
  return folder;
}

/** A media folder a sparse checkout may add: relative, forward slashes, no traversal. */
export function checkMediaFolder(folder: string): string {
  const parts = folder.split("/");
  if (
    !/^[A-Za-z0-9][A-Za-z0-9 _./()-]{0,299}$/.test(folder) ||
    parts.some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")
  )
    throw new HttpError(400, "media_folder_invalid", `Not a media folder: ${folder}`);
  return folder;
}

/** Whether a failed `ls-remote` means the repository does not exist, not that it was unreachable. */
export function repositoryMissing(stderr: string): boolean {
  return /repository not found|does not appear to be a git repository|not found/i.test(stderr);
}

/** The parts of the workspace that touch the outside world; a test replaces them. */
export abstract class WafWorkspacePorts extends Interface<{
  runGit?: DeployGit["run"];
  runProcess?: DeployProcess["run"];
  /**
   * Whether the server prepares a managed workspace that is not ready when it starts; true
   * unless PENGUIN_WAF_AUTO_PREPARE is "0". Tests turn it off, so nothing clones at boot.
   */
  autoPrepare?: boolean;
}>() {}

@Component()
export class DefaultWafWorkspacePorts implements WafWorkspacePorts {}

export abstract class WafWorkspace extends Interface<{
  /** The checkout's root when it can be used, else null. Replaces looking for one on disk. */
  root(): Promise<string | null>;
  /**
   * The checkout's root, or the refusal that says why there is none: 503
   * `waf_workspace_preparing` while it is being prepared, else 409 `waf_workspace_not_ready`
   * (naming why the last preparation failed, when it did).
   */
  requireRoot(): Promise<string>;
  status(): Promise<WafWorkspaceStatus>;
  /**
   * Clones whichever shared repositories are missing and installs their dependencies, in the
   * background; one preparation at a time. A no-op for an existing checkout.
   */
  prepare(): Promise<WafWorkspaceStatus>;
  /**
   * A product module's directory, cloned on first use. A module whose repository does not
   * exist yet starts as an empty repository with origin set, as Loom started one.
   */
  ensureModule(moduleFolder: string): Promise<string>;
  /** Adds media folders to the sparse checkout and fetches their LFS objects. */
  ensureMedia(folders: readonly string[]): Promise<void>;
  /** The remote a product's module repository is cloned from and pushed to. */
  moduleRemote(moduleFolder: string): string;
  /**
   * A product module's directory to author in. In the managed workspace it is the module's
   * clone (see ensureModule); in an existing checkout it is made when missing and nothing is
   * cloned, since that checkout's repositories are its owner's.
   */
  authoringModule(moduleFolder: string): Promise<string>;
  settings(): WafWorkspaceSettings;
  saveSettings(input: unknown): WafWorkspaceSettings;
}>() {}

@Component()
export class WafWorkspaceService implements WafWorkspace {
  @Use() private readonly config!: Config;
  @Use() private readonly serverSettings!: Settings;
  @Use() private readonly ports!: WafWorkspacePorts;

  private preparing: Promise<void> | null = null;
  private lastError: string | null = null;
  private log: string[] = [];
  /** Git calls on one repository run one after another. */
  private queues = new Map<string, Promise<unknown>>();

  settings(): WafWorkspaceSettings {
    const raw = this.serverSettings.get(WAF_WORKSPACE_SETTINGS_KEY);
    const settings = readWafWorkspaceSettings(raw);
    // Until the workspace is saved once, a server that set the two remotes in its deploy
    // settings (where they used to be) keeps them.
    if (raw === null) {
      const deploy = asGroup(safeJson(this.serverSettings.get(DEPLOY_SETTINGS_KEY))).repos;
      const { activityDataRemote, mediaRemote } = asGroup(deploy);
      if (typeof activityDataRemote === "string" && activityDataRemote)
        settings.repos.activityData.remote = activityDataRemote;
      if (typeof mediaRemote === "string" && mediaRemote) settings.repos.media.remote = mediaRemote;
    }
    return settings;
  }

  moduleRemote(moduleFolder: string): string {
    return this.settings().moduleRemote.replaceAll(
      MODULE_PLACEHOLDER,
      checkModuleFolder(moduleFolder),
    );
  }

  saveSettings(input: unknown): WafWorkspaceSettings {
    const next = normalizeWafWorkspaceSettings(this.settings(), input);
    this.serverSettings.set(WAF_WORKSPACE_SETTINGS_KEY, JSON.stringify(next));
    return next;
  }

  /** The external checkout when one is named, else null: WAF_ROOT_DIR, then the setting. */
  private external(): string | null {
    return process.env.WAF_ROOT_DIR || this.settings().externalRoot || null;
  }

  private managedRoot(): string {
    return path.join(this.config.root, WAF_WORKSPACE_DIR);
  }

  private git(): DeployGit {
    const run = this.ports.runGit;
    return run ? { run } : spawnGit;
  }

  private process(): DeployProcess {
    const run = this.ports.runProcess;
    return run ? { run } : spawnDeployProcess;
  }

  private note(line: string) {
    this.log.push(line);
    if (this.log.length > WAF_LOG_LINES) this.log.splice(0, this.log.length - WAF_LOG_LINES);
  }

  private serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const prior = this.queues.get(key) ?? Promise.resolve();
    const next = prior.catch(() => {}).then(work);
    this.queues.set(key, next);
    // The caller sees a failure; this bookkeeping must not become an unhandled one.
    const done = () => {
      if (this.queues.get(key) === next) this.queues.delete(key);
    };
    void next.then(done, done);
    return next;
  }

  async root(): Promise<string | null> {
    const external = this.external();
    if (external) return findWafRoot(external, external);
    // Called on every request that needs the checkout, so only the disk is looked at; a
    // clone of the wrong remote is caught by status() and prepare(), never made by Penguin.
    const root = this.managedRoot();
    const has = (relative: string) => fs.existsSync(path.join(root, relative));
    const ready =
      has("framework/.git") &&
      has("framework/node_modules") &&
      has("modules/navbar/.git") &&
      has("modules/navbar/node_modules") &&
      has("media/.git") &&
      has("waf-activity-data/.git");
    return ready ? root : null;
  }

  private async repoStatus(root: string, id: WafRepoId, managed: boolean): Promise<WafRepoStatus> {
    const dir = path.join(root, WAF_REPO_PATHS[id]);
    const present = fs.existsSync(path.join(dir, ".git"));
    const installed = INSTALLED.has(id) ? fs.existsSync(path.join(dir, "node_modules")) : null;
    if (!present)
      return {
        id,
        path: dir,
        present,
        remote: null,
        remoteMatches: !managed,
        branch: null,
        branchMatches: !managed,
        dirty: null,
        installed,
      };
    const git = this.git();
    const [remote, branch, status] = await Promise.all([
      git.run(["remote", "get-url", "origin"], dir),
      git.run(["branch", "--show-current"], dir),
      git.run(["status", "--porcelain"], dir),
    ]);
    const origin = remote.code === 0 ? remote.stdout.trim() : null;
    const current = branch.code === 0 ? branch.stdout.trim() || null : null;
    return {
      id,
      path: dir,
      present,
      remote: origin,
      remoteMatches:
        !managed || (origin !== null && sameRemote(origin, this.settings().repos[id].remote)),
      branch: current,
      branchMatches: !managed || current === this.settings().repos[id].branch,
      dirty: status.code === 0 ? status.stdout.trim() !== "" : null,
      installed,
    };
  }

  async status(): Promise<WafWorkspaceStatus> {
    const external = this.external();
    const root = external ?? this.managedRoot();
    const repos = await Promise.all(WAF_REPO_IDS.map((id) => this.repoStatus(root, id, !external)));
    const usable = (id: WafRepoId) => {
      const repo = repos.find((entry) => entry.id === id)!;
      return repo.present && repo.remoteMatches && repo.branchMatches && repo.installed !== false;
    };
    // Every repository counts: deploys need the activity data as much as builds need the
    // framework, and a clone on another branch than the one configured builds something else.
    const ready = external
      ? (await findWafRoot(external, external)) !== null
      : WAF_REPO_IDS.every(usable);
    return {
      managed: !external,
      root,
      ready,
      repos,
      preparing: this.preparing !== null,
      lastError: this.lastError,
      log: [...this.log],
    };
  }

  async prepare(): Promise<WafWorkspaceStatus> {
    if (this.external()) return this.status();
    if (!this.preparing) {
      this.lastError = null;
      this.log = [];
      this.preparing = this.prepareAll()
        .catch((error: Error) => {
          this.lastError = error.message;
          this.note(`Failed: ${error.message}`);
        })
        .finally(() => {
          this.preparing = null;
        });
    }
    return this.status();
  }

  private async prepareAll(): Promise<void> {
    const root = this.managedRoot();
    await fsp.mkdir(path.join(root, "modules"), { recursive: true });
    for (const id of WAF_REPO_IDS) {
      const status = await this.repoStatus(root, id, true);
      if (status.present && !status.remoteMatches)
        throw new Error(
          `${WAF_REPO_PATHS[id]} is a clone of ${status.remote ?? "an unknown remote"}, not ${this.settings().repos[id].remote}. Move it aside to let Penguin clone it again.`,
        );
      if (!status.present) await this.serial(id, () => this.cloneShared(root, id));
      const switched =
        status.present && !status.branchMatches
          ? await this.serial(id, () => this.switchBranch(status))
          : false;
      if (INSTALLED.has(id) && (switched || !fs.existsSync(path.join(status.path, "node_modules"))))
        await this.install(status.path);
    }
    this.note("The workspace is ready.");
  }

  /**
   * Puts an existing clone on the branch the settings name, as origin has it: a changed
   * branch in Settings takes effect on the next Prepare. A clone with changes of its own is
   * left alone, and the preparation fails naming it, so nothing is lost.
   */
  private async switchBranch(status: WafRepoStatus): Promise<boolean> {
    const { branch } = this.settings().repos[status.id];
    const where = WAF_REPO_PATHS[status.id];
    if (status.dirty !== false)
      throw new Error(
        `${where} is on ${status.branch ?? "no branch"}, not ${branch}, and has changes of its own. Commit or move them aside, then prepare again.`,
      );
    this.note(`Switching ${where} from ${status.branch ?? "no branch"} to ${branch}…`);
    // A single-branch clone fetches only its first branch until told of another.
    await this.gitOk(status.path, ["remote", "set-branches", "--add", "origin", branch]);
    await this.gitOk(status.path, ["fetch", "origin", branch]);
    await this.gitOk(status.path, ["checkout", "-B", branch, `origin/${branch}`]);
    return true;
  }

  private async cloneShared(root: string, id: WafRepoId): Promise<void> {
    const { remote, branch } = this.settings().repos[id];
    const dir = path.join(root, WAF_REPO_PATHS[id]);
    if (fs.existsSync(dir) && (await fsp.readdir(dir)).length > 0)
      throw new Error(`${WAF_REPO_PATHS[id]} exists but is not a clone. Move it aside first.`);
    await fsp.mkdir(path.dirname(dir), { recursive: true });
    this.note(`Cloning ${remote} (${branch}) into ${WAF_REPO_PATHS[id]}…`);
    // Media is partial and sparse, with LFS objects left for ensureMedia to fetch per folder.
    const media = id === "media";
    const args = [
      "clone",
      "--branch",
      branch,
      "--single-branch",
      ...(media ? ["--filter=blob:none", "--sparse"] : []),
      "--",
      remote,
      dir,
    ];
    const cloned = await this.git().run(args, path.dirname(dir), {
      timeoutMs: WAF_LONG_TIMEOUT_MS,
      ...(media ? { env: { GIT_LFS_SKIP_SMUDGE: "1" } } : {}),
    });
    if (cloned.code !== 0)
      throw new Error(`Cloning ${remote} failed: ${gitError(cloned.stderr, cloned.error)}`);
    if (media) await this.gitOk(dir, ["lfs", "install", "--local"]);
  }

  private async install(dir: string): Promise<void> {
    this.note(`Installing dependencies in ${path.relative(this.managedRoot(), dir)}…`);
    const result = await this.process().run("npm", ["install", "--ignore-scripts"], {
      cwd: dir,
      timeoutMs: WAF_LONG_TIMEOUT_MS,
    });
    if (result.code !== 0)
      throw new Error(
        `npm install failed in ${path.basename(dir)}: ${result.error ?? result.tail.slice(-2000)}`,
      );
  }

  private async gitOk(cwd: string, args: string[], env?: Record<string, string>) {
    const result = await this.git().run(args, cwd, {
      timeoutMs: WAF_LONG_TIMEOUT_MS,
      ...(env ? { env } : {}),
    });
    if (result.code !== 0)
      throw new Error(`git ${args[0]} failed: ${gitError(result.stderr, result.error)}`);
    return result;
  }

  async requireRoot(): Promise<string> {
    const root = await this.root();
    if (root) return root;
    if (this.preparing)
      throw new HttpError(
        503,
        "waf_workspace_preparing",
        "The WAF workspace is being prepared. Cloning and installing can take several minutes.",
      );
    throw new HttpError(
      409,
      "waf_workspace_not_ready",
      this.lastError
        ? `The WAF workspace is not prepared: ${this.lastError} An admin can try again in Settings.`
        : "The WAF workspace is not prepared. An admin can prepare it in Settings.",
    );
  }

  /** A managed workspace that is not ready is prepared in the background as the server starts. */
  setup() {
    const enabled = this.ports.autoPrepare ?? process.env.PENGUIN_WAF_AUTO_PREPARE !== "0";
    if (!enabled || this.external()) return;
    void this.root()
      .then((root) => (root ? undefined : this.prepare()))
      .catch(() => {
        /* status() reports what went wrong; startup goes on regardless. */
      });
  }

  async ensureModule(moduleFolder: string): Promise<string> {
    const folder = checkModuleFolder(moduleFolder);
    const root = await this.requireRoot();
    const dir = path.join(root, "modules", folder);
    return this.serial(`module:${folder}`, async () => {
      if (fs.existsSync(path.join(dir, ".git"))) return dir;
      if (fs.existsSync(dir) && (await fsp.readdir(dir)).length > 0)
        throw new HttpError(
          409,
          "module_not_a_clone",
          `modules/${folder} exists but is not a git repository.`,
        );
      const remote = this.moduleRemote(folder);
      const probe = await this.git().run(["ls-remote", "--heads", "--", remote], root);
      if (probe.code === 0) {
        const cloned = await this.git().run(["clone", "--", remote, dir], root, {
          timeoutMs: WAF_LONG_TIMEOUT_MS,
        });
        if (cloned.code !== 0)
          throw new HttpError(
            502,
            "module_clone_failed",
            `Cloning ${remote} failed: ${gitError(cloned.stderr, cloned.error)}`,
          );
        return dir;
      }
      if (!repositoryMissing(probe.stderr))
        throw new HttpError(
          502,
          "module_remote_unreachable",
          `Could not reach ${remote}: ${gitError(probe.stderr, probe.error)}`,
        );
      // A new module: its repository is made by whoever owns the organisation; the first
      // deploy pushes main to it.
      await fsp.mkdir(dir, { recursive: true });
      await this.gitOk(dir, ["init", "--initial-branch=main"]);
      await this.gitOk(dir, ["remote", "add", "origin", remote]);
      return dir;
    });
  }

  async authoringModule(moduleFolder: string): Promise<string> {
    const folder = checkModuleFolder(moduleFolder);
    if (!this.external()) return this.ensureModule(folder);
    const dir = path.join(await this.requireRoot(), "modules", folder);
    return this.serial(`module:${folder}`, async () => {
      // A module the checkout already has is its owner's, repository and all.
      if (fs.existsSync(dir)) return dir;
      // A new one starts as Loom started one: an empty repository on main with origin set,
      // so a deploy can later push it. Nothing is fetched from the remote.
      await fsp.mkdir(dir, { recursive: true });
      await this.gitOk(dir, ["init", "--initial-branch=main"]);
      await this.gitOk(dir, ["remote", "add", "origin", this.moduleRemote(folder)]);
      return dir;
    });
  }

  async ensureMedia(folders: readonly string[]): Promise<void> {
    const wanted = [...new Set(folders.map(checkMediaFolder))];
    if (!wanted.length) return;
    const root = await this.requireRoot();
    // An existing checkout belongs to whoever made it; its media is theirs to fetch.
    if (this.external()) return;
    const dir = path.join(root, WAF_REPO_PATHS.media);
    await this.serial("media", async () => {
      const listed = await this.gitOk(dir, ["sparse-checkout", "list"]);
      const have = new Set(listed.stdout.split(/\r?\n/).map((line) => line.trim()));
      const missing = wanted.filter((folder) => !have.has(folder));
      // Adding a folder checks out only its files, and the LFS filter smudges them as it goes.
      // Never `git lfs pull`: it lists the whole tree with sizes, which in a partial clone
      // fetches every blob of the repository one at a time, and takes hours.
      if (missing.length) await this.gitOk(dir, ["sparse-checkout", "add", "--", ...missing]);
    });
  }
}

function safeJson(raw: string | null): unknown {
  try {
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

/** git's own words for why it failed, or why it never ran. */
function gitError(stderr: string, error?: string): string {
  if (error === "not_found") return "git is not installed on the server.";
  if (error === "timed_out") return "it took too long.";
  const text = stderr.trim();
  return text ? text.slice(-2000) : (error ?? "unknown error");
}
