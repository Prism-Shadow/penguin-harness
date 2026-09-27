/**
 * Deploying activities, first slice: the admin's deploy settings, the clones a deploy works
 * in, and whether a deploy of one activity could start.
 *
 * Nothing here changes anything outside PENGUIN_HOME. The one action that makes clones
 * (Prepare clones) clones into `PENGUIN_HOME/activity-deploy/repos/` and never into the WAF
 * checkout, which is only ever read. The connection test is one read-only GET to Jenkins,
 * made only when an admin presses it.
 *
 * Every git call and every Jenkins request goes through `DeployPorts`, which a test replaces,
 * so no test reaches a network or a real remote.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Component, Interface, Use } from "@prismshadow/penguin-core/kernel";
import { HttpError } from "../http/errors.js";
import type { Config } from "../hmr/capabilities.js";
import type { Settings } from "../mechanisms/settings.js";
import type { ActivityAuthoring, ActivityGeneration } from "../mechanisms/activities.js";
import { writeSecretFile } from "../secret-file.js";
import { sandboxModuleRoot, withinRoot } from "./sandbox-paths.js";
import { findWafRoot } from "./waf-module.js";
import { buildDeployContext } from "./deploy-context.js";
import {
  cloneUrlFor,
  deployClonePaths,
  deployReposRoot,
  gitAvailable,
  mediaSparsePath,
  repositoryUrlOf,
  sameRemote,
  spawnGit,
  type DeployGit,
  type DeployGitOptions,
  type DeployGitResult,
} from "./deploy-git.js";
import {
  DEPLOY_SECRETS_FILE,
  DEPLOY_SETTINGS_KEY,
  isAllowedRemote,
  mergeSecrets,
  normalizeDeploySettings,
  readDeploySecrets,
  readDeploySettings,
  viewOf,
  type DeploySecrets,
  type DeploySettings,
} from "./deploy-settings.js";
import type {
  DeployConnectionTest,
  DeployContext,
  DeployRepo,
  DeploySettingsView,
  DeployTarget,
} from "./deploy-types.js";

/** How long a clone may take: a large module or activity-data history on a slow link. */
export const CLONE_TIMEOUT_MS = 10 * 60 * 1000;

/** How long the connection test waits for Jenkins. */
export const CONNECTION_TEST_TIMEOUT_MS = 10_000;

/** A Jenkins request, as the connection test makes it. */
export interface JenkinsRequest {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

/**
 * The parts of deploying that touch the outside world. Every field is optional: absent, the
 * real one is used; a test stands in fakes so nothing reaches git or Jenkins.
 */
export abstract class DeployPorts extends Interface<{
  /** Runs one git command. Never throws. */
  runGit?: (args: string[], cwd: string, opts?: DeployGitOptions) => Promise<DeployGitResult>;
  /** Makes one GET to Jenkins and returns its HTTP status; throws when nothing answered. */
  getJenkins?: (request: JenkinsRequest) => Promise<{ status: number }>;
}>() {}

@Component()
export class DefaultDeployPorts implements DeployPorts {}

/** The real Jenkins GET: redirects are not followed, so the credentials go nowhere else. */
async function fetchJenkins(request: JenkinsRequest): Promise<{ status: number }> {
  const response = await fetch(request.url, {
    method: "GET",
    headers: request.headers,
    redirect: "manual",
    signal: AbortSignal.timeout(request.timeoutMs),
  });
  await response.body?.cancel().catch(() => {});
  return { status: response.status };
}

export abstract class ActivityDeploys extends Interface<{
  /** The deploy settings, tokens masked. */
  settings(): DeploySettingsView;
  /** Validates and stores an update (see DeploySettingsUpdate); a rejected one stores nothing. */
  saveSettings(input: unknown): DeploySettingsView;
  /** One read-only GET to the target's Jenkins with its stored credentials. */
  testConnection(target: DeployTarget): Promise<DeployConnectionTest>;
  /** Whether a deploy of this activity could start, and what is missing. */
  context(
    projectId: string,
    activityId: string,
    options?: { checkRemote?: boolean },
  ): Promise<DeployContext>;
  /** Makes whichever of the three clones are missing; a no-op for clones already right. */
  prepareClones(projectId: string, activityId: string): Promise<DeployContext>;
}>() {}

@Component()
export class ActivityDeployService implements ActivityDeploys {
  @Use() private readonly config!: Config;
  @Use() private readonly serverSettings!: Settings;
  @Use() private readonly activities!: ActivityAuthoring;
  @Use() private readonly generation!: ActivityGeneration;
  @Use() private readonly ports!: DeployPorts;

  /** One Prepare clones at a time: the activity-data and media clones are shared. */
  private preparing = false;

  private git(): DeployGit {
    const run = this.ports.runGit;
    return run ? { run } : spawnGit;
  }

  private secretsPath(): string {
    return path.join(this.config.root, DEPLOY_SECRETS_FILE);
  }

  private stored(): DeploySettings {
    return readDeploySettings(this.serverSettings.get(DEPLOY_SETTINGS_KEY));
  }

  private secrets(): DeploySecrets {
    let text: string | null = null;
    try {
      text = fs.readFileSync(this.secretsPath(), "utf8");
    } catch {
      text = null;
    }
    return readDeploySecrets(text);
  }

  settings(): DeploySettingsView {
    return viewOf(this.stored(), this.secrets());
  }

  saveSettings(input: unknown): DeploySettingsView {
    const { settings, tokens } = normalizeDeploySettings(input, this.stored());
    if (tokens.qa !== undefined || tokens.prod !== undefined) {
      const next = mergeSecrets(this.secrets(), tokens);
      const file = this.secretsPath();
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      writeSecretFile(file, JSON.stringify(next));
    }
    this.serverSettings.set(DEPLOY_SETTINGS_KEY, JSON.stringify(settings));
    return this.settings();
  }

  async testConnection(target: DeployTarget): Promise<DeployConnectionTest> {
    const settings = this.stored()[target];
    const token = target === "qa" ? this.secrets().qaToken : this.secrets().prodToken;
    if (!settings.jenkinsUrl)
      throw new HttpError(
        409,
        "deploy_settings_missing",
        `Save ${target}.jenkinsUrl before testing the connection.`,
        undefined,
        { field: `${target}.jenkinsUrl` },
      );
    const headers: Record<string, string> = { Accept: "application/json" };
    if (settings.username && token)
      headers.Authorization = `Basic ${Buffer.from(`${settings.username}:${token}`).toString("base64")}`;
    const get = this.ports.getJenkins ?? fetchJenkins;
    try {
      const { status } = await get({
        url: `${settings.jenkinsUrl}/api/json`,
        headers,
        timeoutMs: CONNECTION_TEST_TIMEOUT_MS,
      });
      return { ok: status >= 200 && status < 300, status };
    } catch {
      return { ok: false, status: 0 };
    }
  }

  /** The module's package.json `repository`: the checkout's, else the newest assembled module's. */
  private async moduleRepository(
    projectId: string,
    activityId: string,
    moduleFolder: string,
  ): Promise<string | null> {
    const candidates: string[] = [];
    const wafRoot = await findWafRoot();
    if (wafRoot) {
      const root = withinRoot(path.join(wafRoot, "modules"), moduleFolder);
      if (root) candidates.push(path.join(root, "package.json"));
    }
    const run = await this.generation
      .latestRun(projectId, activityId, "module", "succeeded")
      .catch(() => null);
    if (run)
      candidates.push(
        path.join(
          sandboxModuleRoot(path.join(this.config.root, "activity-runs", run.runId)),
          "package.json",
        ),
      );
    for (const file of candidates) {
      try {
        const url = repositoryUrlOf(JSON.parse(await fsp.readFile(file, "utf8")));
        if (url) return url;
      } catch {
        /* Not there, or not JSON: try the next. */
      }
    }
    return null;
  }

  /** The facts about an activity a deploy depends on. */
  private async facts(projectId: string, activityId: string) {
    const activity = await this.activities.getActivity(projectId, activityId);
    const product = this.activities.productOf(activity);
    const runtime = (activity.draft.spec as { runtime?: { layout?: unknown } } | null)?.runtime;
    const layout = typeof runtime?.layout === "string" ? runtime.layout : null;
    const moduleRepository = product
      ? await this.moduleRepository(projectId, activityId, product.moduleFolder)
      : null;
    return {
      activity,
      product,
      canonical: this.activities.isCanonicalRef(activity),
      layout,
      moduleRepository,
    };
  }

  async context(
    projectId: string,
    activityId: string,
    options: { checkRemote?: boolean } = {},
  ): Promise<DeployContext> {
    const facts = await this.facts(projectId, activityId);
    return buildDeployContext(
      {
        home: this.config.root,
        productCode: facts.activity.productCode,
        moduleFolder: facts.product?.moduleFolder ?? null,
        canonical: facts.canonical,
        layout: facts.layout,
        settings: this.stored(),
        secrets: this.secrets(),
        moduleRepository: facts.moduleRepository,
        checkRemote: options.checkRemote === true,
      },
      { git: this.git(), exists: exists },
    );
  }

  async prepareClones(projectId: string, activityId: string): Promise<DeployContext> {
    if (this.preparing)
      throw new HttpError(409, "deploy_clones_running", "The clones are already being prepared.");
    this.preparing = true;
    try {
      const facts = await this.facts(projectId, activityId);
      if (!facts.product)
        throw new HttpError(409, "deploy_no_module", "This activity belongs to no product.");
      if (!facts.canonical)
        throw new HttpError(
          409,
          "deploy_not_canonical",
          "Only the product's canonical ref deploys its module.",
        );
      const settings = this.stored();
      for (const field of ["activityDataRemote", "mediaRemote"] as const)
        if (!settings.repos[field])
          throw new HttpError(
            409,
            "deploy_settings_missing",
            `Save repos.${field} before preparing the clones.`,
            undefined,
            { field: `repos.${field}` },
          );
      if (!facts.moduleRepository)
        throw new HttpError(
          409,
          "deploy_module_remote_missing",
          "The module's package.json names no repository.",
        );
      const moduleRemote = cloneUrlFor(facts.moduleRepository);
      if (!isAllowedRemote(moduleRemote))
        throw new HttpError(
          409,
          "deploy_module_remote_invalid",
          "The module's package.json names a repository that cannot be cloned from.",
        );
      const git = this.git();
      const home = this.config.root;
      if (!(await gitAvailable(git, home)))
        throw new HttpError(503, "git_unavailable", "git could not be run on this server.");

      const paths = deployClonePaths(home, facts.product.moduleFolder);
      const root = deployReposRoot(home);
      const wafRoot = await findWafRoot();
      const sparse = mediaSparsePath(facts.activity.productCode);
      const plan: Array<{ repo: DeployRepo; dir: string; remote: string; args: string[] }> = [
        {
          repo: "module",
          dir: paths.module,
          remote: moduleRemote,
          args: [],
        },
        {
          repo: "activityData",
          dir: paths.activityData,
          remote: settings.repos.activityDataRemote,
          args: [],
        },
        {
          repo: "media",
          dir: paths.media,
          remote: settings.repos.mediaRemote,
          args: ["--filter=blob:none", "--sparse"],
        },
      ];
      for (const entry of plan) {
        // Every clone sits under the deploy root and never inside the WAF checkout.
        const relative = path.relative(root, entry.dir);
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
          throw new HttpError(500, "deploy_clone_path", "A clone path left the deploy directory.");
        if (wafRoot && isInside(wafRoot, entry.dir))
          throw new HttpError(
            409,
            "deploy_clone_path",
            "The deploy directory is inside the WAF checkout, which is never written.",
          );
      }
      for (const entry of plan) {
        if (await exists(entry.dir)) {
          await this.checkExisting(git, entry);
          if (entry.repo === "media") await this.ensureSparsePath(git, entry.dir, sparse);
          continue;
        }
        await fsp.mkdir(path.dirname(entry.dir), { recursive: true });
        const cloned = await git.run(
          ["clone", ...entry.args, "--", entry.remote, entry.dir],
          path.dirname(entry.dir),
          { timeoutMs: CLONE_TIMEOUT_MS },
        );
        if (cloned.code !== 0) {
          await fsp.rm(entry.dir, { recursive: true, force: true }).catch(() => {});
          throw cloneFailed(entry.repo, cloned);
        }
        if (entry.repo === "media") {
          const set = await git.run(["sparse-checkout", "set", sparse], entry.dir, {
            timeoutMs: CLONE_TIMEOUT_MS,
          });
          if (set.code !== 0) throw cloneFailed(entry.repo, set);
        }
      }
      return await this.context(projectId, activityId);
    } finally {
      this.preparing = false;
    }
  }

  /** A path that already exists must be the expected clone; anything else is left alone. */
  private async checkExisting(
    git: DeployGit,
    entry: { repo: DeployRepo; dir: string; remote: string },
  ): Promise<void> {
    const origin = (await exists(path.join(entry.dir, ".git")))
      ? await git.run(["remote", "get-url", "origin"], entry.dir)
      : null;
    if (!origin || origin.code !== 0 || !sameRemote(origin.stdout, entry.remote))
      throw new HttpError(
        409,
        "deploy_clone_path_taken",
        `The ${entry.repo} clone's directory exists and is not a clone of its remote; it was left as it is.`,
        undefined,
        { repo: entry.repo },
      );
  }

  /** Adds this activity's media to the media clone's sparse paths when it is not there yet. */
  private async ensureSparsePath(git: DeployGit, dir: string, sparse: string): Promise<void> {
    const list = await git.run(["sparse-checkout", "list"], dir);
    if (list.code === 0 && list.stdout.split(/\r?\n/).some((line) => line.trim() === sparse))
      return;
    const added = await git.run(["sparse-checkout", "add", sparse], dir, {
      timeoutMs: CLONE_TIMEOUT_MS,
    });
    if (added.code !== 0) throw cloneFailed("media", added);
  }
}

/**
 * A failed clone. The App words it from `detail`: the repository, why (`timed_out` or
 * `git_failed`), and the end of git's own output, which is git's text, not the server's.
 */
function cloneFailed(repo: DeployRepo, result: DeployGitResult): HttpError {
  const timedOut = result.error === "timed_out";
  const output = timedOut ? "" : result.stderr.trim().split(/\r?\n/).slice(-3).join(" ");
  return new HttpError(502, "deploy_clone_failed", `The ${repo} clone failed.`, undefined, {
    repo,
    reason: timedOut ? "timed_out" : "git_failed",
    output,
  });
}

async function exists(file: string): Promise<boolean> {
  return fsp.stat(file).then(
    () => true,
    () => false,
  );
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
