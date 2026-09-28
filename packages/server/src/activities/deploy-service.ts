/**
 * Deploying activities: the admin's deploy settings, the clones a deploy works in, whether a
 * deploy of one activity could start, and the runs that release its module and deploy it to
 * QA and then PROD. A PROD deploy needs an admin who owns the project, the product code typed
 * to confirm, and a QA deploy of the activity as it is now; each QA or PROD deploy that
 * finishes is told to `ActivityDeployEvents`.
 *
 * Nothing here changes anything outside PENGUIN_HOME. The one action that makes clones
 * (Prepare clones) clones into `PENGUIN_HOME/activity-deploy/repos/` and never into the WAF
 * checkout, which is only ever read. The connection test is one read-only GET to Jenkins,
 * made only when an admin presses it.
 *
 * Every git call and every Jenkins request goes through `DeployPorts`, which a test replaces,
 * so no test reaches a network or a real remote.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Component, Interface, Use, type ClassCtx } from "@prismshadow/penguin-core/kernel";
import { HttpError } from "../http/errors.js";
import type { Config, Db } from "../hmr/capabilities.js";
import type { Settings } from "../mechanisms/settings.js";
import type { ActivityAuthoring, ActivityGeneration } from "../mechanisms/activities.js";
import { writeSecretFile } from "../secret-file.js";
import { sandboxMediaRoot, sandboxModuleRoot, withinRoot } from "./sandbox-paths.js";
import { exportRevision, manifestAssetList, type ExportRef } from "./deploy-export.js";
import type { ActivityDetail, ActivityProduct } from "./domain.js";
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
  missingProdSettings,
  normalizeDeploySettings,
  readDeploySecrets,
  readDeploySettings,
  viewOf,
  type DeploySecrets,
  type DeploySettings,
} from "./deploy-settings.js";
import {
  DEPLOY_ALL_STAGES,
  DEPLOY_PROD_STAGES,
  DEPLOY_STAGES,
  type DeployBlocker,
  type DeployConnectionTest,
  type DeployContext,
  type DeployLogResponse,
  type DeployProductionRecord,
  type DeployProductionState,
  type DeployRepo,
  type DeployRun,
  type DeploySettingsView,
  type DeployStage,
  type DeployStageSelection,
  type DeployStageStatus,
  type DeployStateResponse,
  type DeployTarget,
} from "./deploy-types.js";
import { createDeployJenkins, type JenkinsFetch } from "./deploy-jenkins.js";
import { spawnDeployProcess, type DeployProcess } from "./deploy-process.js";
import {
  isProdSelection,
  prodStageBlocker,
  qaStages,
  realClock,
  releaseCurrent,
  stageBlocker,
  stagesFor,
  type DeployActivitySnapshot,
  type DeployClock,
} from "./deploy-stages.js";
import {
  DeployRunner,
  dbDeployStore,
  type DeployRunStore,
  type DeployStageDone,
} from "./deploy-run.js";
import { ActivityDeployEvents } from "./deploy-events.js";

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
  /** Every request a deploy makes to Jenkins (start a job, follow its build). */
  jenkinsFetch?: JenkinsFetch;
  /** Runs npm and npx in the module clone. Never throws. */
  runProcess?: DeployProcess["run"];
  /** The deploy's clock, so a test waits no real time. */
  now?: DeployClock["now"];
  sleep?: DeployClock["sleep"];
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
  /** The readiness, the latest run, and each stage's state with why it cannot run now. */
  state(projectId: string, activityId: string): Promise<DeployStateResponse>;
  /**
   * Starts the release, a QA or PROD deploy, or one stage. Only the canonical ref, only when
   * the deploy is ready (409 `deploy_blocked` naming the blocker), one at a time on this server
   * (409 `deploy_running`). PROD also needs `isAdmin` (403 `prod_requires_admin`; the caller
   * has checked the project owner) and `confirm` equal to the product code (400
   * `confirmation_mismatch`).
   */
  start(
    projectId: string,
    activityId: string,
    input: {
      target: DeployTarget;
      stage: DeployStageSelection;
      moduleVersion?: string;
      confirm?: string;
      isAdmin?: boolean;
    },
  ): Promise<DeployRun>;
  /** The activity's latest run, or null when it has had none. */
  latest(projectId: string, activityId: string): Promise<DeployRun | null>;
  /** The run's log lines after the cursor, with the run as it stands. */
  log(
    projectId: string,
    activityId: string,
    runId: string,
    after: number,
  ): Promise<DeployLogResponse>;
  /** Stops the activity's running deploy; the latest run, or null when it has had none. */
  stop(projectId: string, activityId: string): Promise<DeployRun | null>;
}>() {}

@Component()
export class ActivityDeployService implements ActivityDeploys {
  @Use() private readonly config!: Config;
  @Use() private readonly serverSettings!: Settings;
  @Use() private readonly activities!: ActivityAuthoring;
  @Use() private readonly generation!: ActivityGeneration;
  @Use() private readonly ports!: DeployPorts;
  @Use() private readonly db!: Db;
  @Use() private readonly events!: ActivityDeployEvents;

  /** One Prepare clones at a time: the activity-data and media clones are shared. */
  private preparing = false;
  private store: DeployRunStore | null = null;
  private runner: DeployRunner | null = null;

  setup({ effect }: ClassCtx) {
    const store = dbDeployStore(this.db);
    // A run the last process left running is marked interrupted here.
    const runner = new DeployRunner({
      store,
      logDir: path.join(this.config.root, "activity-deploy", "logs"),
      onStageDone: (done) => this.deployed(done),
    });
    this.store = store;
    this.runner = runner;
    effect(() => runner.dispose());
  }

  /** A QA or PROD deploy finished: whoever keeps track of deployed versions is told. */
  private deployed({ projectId, run, stage, metadata }: DeployStageDone) {
    const at =
      stage === "await_activity_deploy"
        ? metadata.qaDeployedAt
        : stage === "await_production_deploy"
          ? metadata.prodDeployedAt
          : undefined;
    // A wait run again that found a build already recorded deployed nothing new.
    if (!at || metadata.alreadyRecorded) return;
    this.events.emit({
      projectId,
      activityId: run.activityId,
      runId: run.runId,
      target: stage === "await_production_deploy" ? "prod" : "qa",
      revision: metadata.contentRevision ?? null,
      deployedAt: at,
    });
  }

  private active(): { store: DeployRunStore; runner: DeployRunner } {
    if (!this.store || !this.runner)
      throw new HttpError(503, "deploy_unavailable", "Deploys are not ready yet.");
    return { store: this.store, runner: this.runner };
  }

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

  private statuses(activityId: string): Partial<Record<DeployStage, DeployStageStatus>> {
    const stored = this.active().store.stages(activityId);
    const out: Partial<Record<DeployStage, DeployStageStatus>> = {};
    for (const stage of DEPLOY_ALL_STAGES) if (stored[stage]) out[stage] = stored[stage]!.status;
    return out;
  }

  /** Why a PROD stage cannot run now, from the stored stages and the activity as it is now. */
  private prodBlocker(
    stage: DeployStage,
    activityId: string,
    context: DeployContext,
    currentProductRevision: string,
  ): DeployBlocker | null {
    const { store, runner } = this.active();
    return prodStageBlocker(stage, context, store.stages(activityId), runner.current() !== null, {
      currentProductRevision,
      missingSettings: missingProdSettings(this.stored(), this.secrets()),
    });
  }

  private production(
    projectId: string,
    activityId: string,
    context: DeployContext,
    currentProductRevision: string,
  ): DeployProductionState {
    const stored = this.active().store.stages(activityId);
    const stages = DEPLOY_PROD_STAGES.map((stage) => ({
      stage,
      status: stored[stage]?.status ?? "pending",
      finishedAt: stored[stage]?.finishedAt ?? null,
      metadata: stored[stage]?.metadata ?? {},
      blocker: this.prodBlocker(stage, activityId, context, currentProductRevision),
    }));
    const run = this.active().store.lastProduction(projectId, activityId);
    const last: DeployProductionRecord | null = run?.metadata.prodDeployedAt
      ? {
          runId: run.runId,
          deployedAt: run.metadata.prodDeployedAt,
          contentRevision: run.metadata.contentRevision ?? null,
          frameworkVersion: run.metadata.prodFrameworkVersion ?? null,
          url: run.metadata.productionDeployUrl ?? null,
        }
      : null;
    return { stages, blocker: stages[0]!.blocker, last };
  }

  async state(projectId: string, activityId: string): Promise<DeployStateResponse> {
    const { store, runner } = this.active();
    const context = await this.context(projectId, activityId);
    const activity = await this.activities.getActivity(projectId, activityId);
    const stored = store.stages(activityId);
    const statuses = this.statuses(activityId);
    const running = runner.current() !== null;
    return {
      context,
      run: runner.latest(projectId, activityId),
      stages: DEPLOY_STAGES.map((stage) => ({
        stage,
        status: stored[stage]?.status ?? "pending",
        finishedAt: stored[stage]?.finishedAt ?? null,
        metadata: stored[stage]?.metadata ?? {},
        blocker: stageBlocker(stage, context, statuses, running),
      })),
      production: this.production(
        projectId,
        activityId,
        context,
        await this.productRevision(projectId, activity),
      ),
    };
  }

  async start(
    projectId: string,
    activityId: string,
    input: {
      target: DeployTarget;
      stage: DeployStageSelection;
      moduleVersion?: string;
      confirm?: string;
      isAdmin?: boolean;
    },
  ): Promise<DeployRun> {
    const { runner } = this.active();
    const prod = isProdSelection(input.stage);
    if (prod !== (input.target === "prod"))
      throw new HttpError(
        400,
        "invalid_request",
        prod
          ? "A PROD stage deploys to PROD: the target must be prod."
          : "A PROD deploy runs only the PROD stages.",
      );
    // PROD is an admin's who owns the project; the route has checked the owner.
    if (prod && input.isAdmin !== true)
      throw new HttpError(
        403,
        "prod_requires_admin",
        "Only an admin who owns the project can deploy to PROD.",
      );
    if (runner.current())
      throw new HttpError(409, "deploy_running", "A deploy is already running on this server.");
    const facts = await this.facts(projectId, activityId);
    if (prod && input.confirm !== facts.activity.productCode)
      throw new HttpError(
        400,
        "confirmation_mismatch",
        "Type the product code to confirm the PROD deploy.",
      );
    if (!facts.product)
      throw new HttpError(409, "deploy_no_module", "This activity belongs to no product.");
    if (!facts.canonical)
      throw new HttpError(
        409,
        "deploy_not_canonical",
        "Only the product's canonical ref deploys its module.",
      );
    if (prod) return this.startProd(projectId, activityId, input.stage, facts);
    const product = facts.product;
    const home = this.config.root;
    const folder = product.moduleFolder;
    const moduleRun = await this.generation
      .latestRun(projectId, activityId, "module", "succeeded")
      .catch(() => null);
    const source = moduleRun
      ? sandboxModuleRoot(path.join(home, "activity-runs", moduleRun.runId))
      : null;
    const sourceReady = source !== null && (await exists(path.join(source, "package.json")));
    const contentHash = sourceReady ? await moduleContentHash(source) : null;
    const stages =
      input.stage === "qa"
        ? qaStages(releaseCurrent(this.active().store.stages(activityId), contentHash))
        : stagesFor(input.stage);
    const context = await this.context(projectId, activityId);
    const first = stages[0]!;
    const blocker = stageBlocker(
      first,
      context,
      this.statuses(activityId),
      runner.current() !== null,
    );
    if (blocker?.code === "run_active")
      throw new HttpError(409, "deploy_running", "A deploy is already running on this server.");
    if (blocker)
      throw new HttpError(
        409,
        "deploy_blocked",
        `The ${first} stage cannot run now (${blocker.code}).`,
        undefined,
        blockerDetail(first, blocker),
      );
    const settings = this.stored();
    const secrets = this.secrets();
    const run = this.ports.runProcess;
    const paths = deployClonePaths(home, folder);
    const activity = facts.activity;
    // The runner checks again: another start may have begun while this one read the clones.
    return runner.start({
      projectId,
      activityId,
      target: input.target,
      selection: input.stage,
      stages,
      base: {
        git: this.git(),
        jenkins: createDeployJenkins(
          {
            url: settings.qa.jenkinsUrl,
            username: settings.qa.username,
            token: secrets.qaToken ?? "",
          },
          this.ports.jenkinsFetch,
        ),
        process: run ? { run } : spawnDeployProcess,
        clock: {
          now: this.ports.now ?? realClock.now,
          sleep: this.ports.sleep ?? realClock.sleep,
        },
        settings,
        productCode: activity.productCode,
        module: {
          folder,
          dir: paths.module,
          source: sourceReady ? source : null,
          contentHash,
        },
        qa: {
          activityData: { dir: paths.activityData },
          media: { dir: paths.media },
          refNum: activity.refNum,
          target: {
            tier: settings.qa.tier,
            environment: settings.qa.environment,
            frameworkVersion: settings.qa.frameworkVersion,
            activityBaseUrl: settings.qa.activityBaseUrl,
          },
          snapshot: () =>
            this.snapshot(projectId, activityId, product, sourceReady ? source : null),
        },
        moduleVersion: input.moduleVersion ?? null,
      },
    });
  }

  /**
   * Starts the PROD deploy (or one of its stages) once the caller has checked who asks and the
   * confirmation: the same job QA ran, on the PROD Jenkins with PROD's settings, for the
   * activity data QA has.
   */
  private async startProd(
    projectId: string,
    activityId: string,
    selection: DeployStageSelection,
    facts: Awaited<ReturnType<ActivityDeployService["facts"]>>,
  ): Promise<DeployRun> {
    const { runner } = this.active();
    const product = facts.product!;
    const stages = stagesFor(selection);
    const first = stages[0]!;
    const context = await this.context(projectId, activityId);
    const blocker = this.prodBlocker(
      first,
      activityId,
      context,
      await this.productRevision(projectId, facts.activity),
    );
    if (blocker?.code === "run_active")
      throw new HttpError(409, "deploy_running", "A deploy is already running on this server.");
    if (blocker)
      throw new HttpError(
        409,
        "deploy_blocked",
        `The ${first} stage cannot run now (${blocker.code}).`,
        undefined,
        blockerDetail(first, blocker),
      );
    const settings = this.stored();
    const secrets = this.secrets();
    const run = this.ports.runProcess;
    const home = this.config.root;
    return runner.start({
      projectId,
      activityId,
      target: "prod",
      selection,
      stages,
      base: {
        git: this.git(),
        jenkins: createDeployJenkins(
          {
            url: settings.prod.jenkinsUrl,
            username: settings.prod.username,
            token: secrets.prodToken ?? "",
          },
          this.ports.jenkinsFetch,
        ),
        process: run ? { run } : spawnDeployProcess,
        clock: {
          now: this.ports.now ?? realClock.now,
          sleep: this.ports.sleep ?? realClock.sleep,
        },
        settings,
        productCode: facts.activity.productCode,
        module: {
          folder: product.moduleFolder,
          dir: deployClonePaths(home, product.moduleFolder).module,
          source: null,
        },
        prod: {
          target: {
            tier: settings.prod.tier,
            environment: settings.prod.environment,
            frameworkVersion: settings.prod.frameworkVersion,
          },
        },
        moduleVersion: null,
      },
    });
  }

  /** Every ref of the product `activity` belongs to, archived ones included. */
  private async productRefs(
    projectId: string,
    activity: ActivityDetail,
    product: ActivityProduct,
  ): Promise<ActivityDetail[]> {
    const siblings = (
      await this.activities.listActivities(projectId, activity.collectionId)
    ).filter(
      (entry) =>
        entry.productCode === activity.productCode &&
        (entry.productId === null || entry.productId === product.productId),
    );
    const refs: ActivityDetail[] = [];
    for (const entry of siblings) refs.push(await this.activities.getActivity(projectId, entry.id));
    return refs;
  }

  /** What a QA deploy of the activity's product would export now, as `exportRevision` names it. */
  private async productRevision(projectId: string, activity: ActivityDetail): Promise<string> {
    const product = this.activities.productOf(activity);
    return exportRevision(
      product ? await this.productRefs(projectId, activity, product) : [activity],
    );
  }

  /**
   * The product's refs as a QA deploy exports them, read when the export runs. Each ref's
   * configuration is the author's edit, else the one the newest assembled module wrote for it,
   * else the checkout module's; its assessment is the one in effect (the canonical ref's edit,
   * else the module's own for the ref, else the canonical ref's). Archived refs are not listed.
   */
  private async snapshot(
    projectId: string,
    activityId: string,
    product: ActivityProduct,
    moduleRoot: string | null,
  ): Promise<DeployActivitySnapshot> {
    const deploying = await this.activities.getActivity(projectId, activityId);
    const wafRoot = await findWafRoot();
    const checkout = wafRoot
      ? withinRoot(path.join(wafRoot, "modules"), product.moduleFolder)
      : null;
    const roots = [moduleRoot, checkout].filter((root): root is string => root !== null);
    const readDocument = async (folder: string, names: string[]): Promise<unknown> => {
      for (const root of roots)
        for (const name of names) {
          const file = withinRoot(path.join(root, folder), name);
          if (!file) continue;
          try {
            return JSON.parse(await fsp.readFile(file, "utf8")) as unknown;
          } catch {
            /* Not there, or not JSON: try the next. */
          }
        }
      return null;
    };
    const siblings = await this.productRefs(projectId, deploying, product);
    const refs: ExportRef[] = [];
    const draftMediaRoots: string[] = [];
    const code = deploying.productCode;
    const canonical = product.canonicalRefNum;
    for (const ref of siblings) {
      const own = `${code}-${ref.refNum}.json`;
      const shared =
        canonical != null && canonical !== ref.refNum ? [`${code}-${canonical}.json`] : [];
      const configurationEdit = await this.activities.effectiveModuleDocument(
        projectId,
        ref,
        "configuration",
      );
      const assessmentEdit = await this.activities.effectiveModuleDocument(
        projectId,
        ref,
        "assessment",
      );
      const runtime = (ref.draft.spec as { runtime?: { usesAssessment?: unknown } } | null)
        ?.runtime;
      refs.push({
        refNum: ref.refNum,
        displayName: ref.displayName,
        configuration: configurationEdit?.value ?? (await readDocument("configurations", [own])),
        assessment: assessmentEdit?.value ?? (await readDocument("assessments", [own, ...shared])),
        usesAssessment: runtime?.usesAssessment === true,
        assets: manifestAssetList(ref.draft.mediaPlan?.manifest),
        archived: ref.archived,
      });
      draftMediaRoots.push(
        sandboxMediaRoot({
          draftWorkspace: this.activities.draftWorkspace(
            projectId,
            ref.collectionId,
            ref.id,
            ref.draft.draftId,
          ),
        }),
      );
    }
    const spec = (deploying.draft.spec ?? null) as {
      title?: unknown;
      runtime?: { layout?: unknown; theme?: unknown };
    } | null;
    return {
      title: typeof spec?.title === "string" && spec.title.trim() ? spec.title : deploying.title,
      layout: typeof spec?.runtime?.layout === "string" ? spec.runtime.layout : null,
      theme: typeof spec?.runtime?.theme === "string" ? spec.runtime.theme : null,
      contentRevision: deploying.draft.contentRevision,
      productRevision: exportRevision(siblings),
      refs,
      draftMediaRoots,
    };
  }

  async latest(projectId: string, activityId: string): Promise<DeployRun | null> {
    await this.activities.getActivity(projectId, activityId);
    return this.active().runner.latest(projectId, activityId);
  }

  async log(
    projectId: string,
    activityId: string,
    runId: string,
    after: number,
  ): Promise<DeployLogResponse> {
    await this.activities.getActivity(projectId, activityId);
    const page = this.active().runner.log(projectId, activityId, runId, after);
    if (!page) throw new HttpError(404, "deploy_run_not_found", "No such deploy run.");
    return page;
  }

  async stop(projectId: string, activityId: string): Promise<DeployRun | null> {
    await this.activities.getActivity(projectId, activityId);
    return this.active().runner.stop(projectId, activityId);
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

/** A blocker as the refusal's detail: its code and the facts it names. */
function blockerDetail(stage: DeployStage, blocker: DeployBlocker): Record<string, string> {
  const detail: Record<string, string> = { stage, blocker: blocker.code };
  if (blocker.code === "previous_stage" || blocker.code === "previous_rerun")
    detail.previous = blocker.stage;
  if (blocker.code === "settings_missing") detail.field = blocker.field;
  if (blocker.code === "clone_missing" || blocker.code === "clone_dirty")
    detail.repo = blocker.repo;
  if (blocker.code === "not_ready") detail.problem = blocker.problem.code;
  return detail;
}

/**
 * The folders and files of an assembled module a build reads and a release publishes: its
 * content and the build configuration assembly writes beside it, not its build output.
 */
const MODULE_CONTENT = [
  "src",
  "res",
  "generated",
  "definition.json",
  "package.json",
  "tsconfig.json",
  "tsconfig.build.json",
  "webpack.config.cjs",
  ".npmrc",
  ".gitignore",
];

/**
 * What an assembled module's content hashes to: every file its build reads, by path and bytes.
 * A module built again in place hashes the same; one assembled again with changes does not.
 */
export async function moduleContentHash(root: string): Promise<string> {
  const hash = createHash("sha256");
  const files: string[] = [];
  async function walk(relative: string) {
    const full = path.join(root, relative);
    const stat = await fsp.stat(full).catch(() => null);
    if (!stat) return;
    if (stat.isFile()) {
      files.push(relative.split(path.sep).join("/"));
      return;
    }
    if (!stat.isDirectory()) return;
    for (const entry of await fsp.readdir(full)) {
      if (entry === "node_modules" || entry === ".git") continue;
      await walk(path.join(relative, entry));
    }
  }
  for (const entry of MODULE_CONTENT) await walk(entry);
  for (const file of files.sort()) {
    hash.update(`${file}\n`);
    hash.update(await fsp.readFile(path.join(root, file)));
    hash.update("\n");
  }
  return hash.digest("hex");
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
