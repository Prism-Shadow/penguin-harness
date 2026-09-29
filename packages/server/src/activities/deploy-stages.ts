/**
 * The stages of a module release, each a step over injected ports, and which of them may run
 * now.
 *
 *   verify_module         put the module clone on main as origin has it, carrying the authored
 *                         work in its working tree, copy the newest assembled module over it,
 *                         commit all of it on main, and run `npm ci`, `npm run buildDebug`,
 *                         `npm run lint` and `npm run buildRelease` in it
 *   prepare_deploy        make the deploy branch from main, carrying that content; write the
 *                         package name and version; compile `res/style.scss` when there is one;
 *                         commit as the configured identity (nothing to commit is not a failure)
 *   trigger_module_build  note the newest release tag and Jenkins build, push main when the
 *                         remote lacks it, push the deploy branch, and start the module build
 *   await_module_build    every 15 seconds, look for a newer release tag than the one noted,
 *                         until one appears, the build fails, or the configured minutes pass
 *
 * and the QA deploy after it:
 *
 *   export_activity_data     put the activity-data clone on `loom/<pc>-activity-data` as origin
 *                            has it (from main when origin has no such branch) and write every
 *                            deployed ref's configuration and assessment, the template and the
 *                            deploy list into it (`deploy-export.ts`)
 *   verify_activity_data     check what was written (`deploy-preflight.ts`); errors fail it
 *   verify_media_assets      bring the media clone's main up to origin around the authored media,
 *                            fail naming any file the data names that is nowhere, then commit the
 *                            new or changed ones and push main (`deploy-media.ts`)
 *   publish_activity_data    commit what export wrote and push the branch
 *   trigger_activity_deploy  note the newest activity deploy build, and start the activity
 *                            deploy job for the branch and this product's template
 *   await_activity_deploy    every 15 seconds, follow that build until it succeeds, fails, or
 *                            the configured minutes pass; record where the activity opens on QA
 *
 * and, once QA has the activity as it is now, the PROD deploy:
 *
 *   trigger_production_deploy   start the same activity deploy job on the PROD Jenkins, for the
 *                               branch QA deployed, with PROD's tier, environment and framework
 *                               version
 *   await_production_deploy     follow that deploy as await_activity_deploy follows QA's, and
 *                               record when PROD got it
 *
 * Everything runs in the WAF workspace's clones. The module and media clones hold authored
 * work, which the stages commit rather than discard; the activity-data clone is the deploy's
 * own and must be clean. git, Jenkins, the programs and the clock are ports, so a test runs every stage with
 * fakes and nothing reaches a remote.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  BASE_BRANCH,
  activityDataBranchName,
  deployBranchName,
  moduleShortName,
  type DeployGit,
} from "./deploy-git.js";
import type { DeployJenkins, JenkinsBuildStatus } from "./deploy-jenkins.js";
import { JenkinsError } from "./deploy-jenkins.js";
import type { DeployProcess } from "./deploy-process.js";
import type { DeploySettings } from "./deploy-settings.js";
import {
  ExportLayoutError,
  exportFiles,
  mainModule,
  deployedRefs,
  type ExportRef,
} from "./deploy-export.js";
import { runPreflight } from "./deploy-preflight.js";
import { syncMedia } from "./deploy-media.js";
import { repositoryMissing } from "./waf-workspace.js";
import { withinRoot } from "./sandbox-paths.js";
import {
  DEPLOY_ALL_STAGES,
  DEPLOY_PROD_STAGES,
  DEPLOY_QA_STAGES,
  DEPLOY_RELEASE_STAGES,
  DEPLOY_STAGES,
  type DeployBlocker,
  type DeployContext,
  type DeployProblem,
  type DeployRunMetadata,
  type DeployStage,
  type DeployStageError,
  type DeployStageSelection,
  type DeployStageStatus,
  type DeployTarget,
} from "./deploy-types.js";

/** The module checks a release runs, in order: install, both builds, and lint between them. */
export const MODULE_VERIFY_COMMANDS: readonly (readonly string[])[] = [
  ["ci"],
  ["run", "buildDebug"],
  ["run", "lint"],
  ["run", "buildRelease"],
];

/** The Sass a module's stylesheet is compiled with, pinned as the WAF build pins it. */
export const SASS_PACKAGE = "sass@1.54.0";

/** How often the build is looked at while waiting for it. */
export const BUILD_POLL_MS = 15_000;

/** How long a push may take. */
export const PUSH_TIMEOUT_MS = 5 * 60 * 1000;

/** A release version: plain semver, as the module's tags are. */
const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Whether a version an engineer typed is one a module can be released as. */
export function isModuleVersion(value: string): boolean {
  return SEMVER.test(value) && !value.startsWith("v");
}

/** A tag as a plain version (`v1.2.3` → `1.2.3`); null when it is not plain semver. */
export function plainSemver(tag: string): string | null {
  const match = SEMVER.exec(tag.trim());
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

export function compareSemver(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < 3; index++)
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  return 0;
}

/** The newest plain semver among `tags`, normalised; null when none is. */
export function latestSemver(tags: readonly string[]): string | null {
  let best: string | null = null;
  for (const tag of tags) {
    const version = plainSemver(tag);
    if (version && (best === null || compareSemver(version, best) > 0)) best = version;
  }
  return best;
}

/** The npm package name a module is published under (`waf-module-Abc` → `wafmodule-abc`). */
export function modulePackageName(moduleFolder: string): string {
  return `wafmodule-${moduleShortName(moduleFolder).toLowerCase()}`;
}

/** The `Modules` parameter the module build job takes: the module's short name and branch. */
export function moduleBuildLine(moduleFolder: string): string {
  return `${moduleShortName(moduleFolder)} ${deployBranchName(moduleFolder)}`;
}

/** The deploy's clock: tests wait no real time. */
export interface DeployClock {
  now(): number;
  /** Resolves after `ms`, or as soon as `signal` aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export const realClock: DeployClock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (signal.aborted) return resolve();
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      }
      signal.addEventListener("abort", done, { once: true });
    }),
};

/** The activity as a QA deploy exports it, read when the export runs. */
export interface DeployActivitySnapshot {
  /** The deploying (canonical) ref's title, layout and theme, which the template carries. */
  title: string;
  layout: string | null;
  theme: string | null;
  /** The deploying ref's draft revision, recorded as what went to QA. */
  contentRevision: string;
  /** Every exported ref's revision as one (`exportRevision`), which the PROD gate compares. */
  productRevision: string;
  /** Every ref of the product; archived ones are left out of the export. */
  refs: ExportRef[];
}

/** What the QA stages work on besides the module. */
export interface DeployQaContext {
  /** The activity-data clone. */
  activityData: { dir: string };
  /** The media clone. */
  media: { dir: string };
  /** The deploying ref's number, which the link to QA opens. */
  refNum: number;
  /** Where the deploy goes: the target's Jenkins job settings and the QA address. */
  target: { tier: string; environment: string; frameworkVersion: string; activityBaseUrl: string };
  snapshot(): Promise<DeployActivitySnapshot>;
}

/** Where an activity deploy job runs: the target's tier, environment and framework version. */
export interface DeployJobTarget {
  tier: string;
  environment: string;
  frameworkVersion: string;
}

/** What the PROD stages work on: PROD's job settings. Jenkins is PROD's for such a run. */
export interface DeployProdContext {
  target: DeployJobTarget;
}

export interface DeployStageContext {
  git: DeployGit;
  jenkins: DeployJenkins;
  process: DeployProcess;
  clock: DeployClock;
  settings: DeploySettings;
  productCode: string;
  module: {
    folder: string;
    /** The module's deploy clone. */
    dir: string;
    /** The newest assembled module to copy over the clone; null to deploy the clone as it is. */
    source: string | null;
    /** What that module's content hashes to; null (or absent) when there is none. */
    contentHash?: string | null;
  };
  /** The activity-data and media side of a QA deploy; absent for a run that cannot reach it. */
  qa?: DeployQaContext;
  /** The PROD side of a PROD deploy; absent for every other run. */
  prod?: DeployProdContext;
  /** The version to write into package.json; null keeps the one there. */
  moduleVersion: string | null;
  /** What this run found out so far; stages add to it. */
  metadata: DeployRunMetadata;
  /** What each stage recorded when it last finished, for a stage run on its own. */
  earlier: Partial<Record<DeployStage, DeployRunMetadata>>;
  log(text: string): void;
  signal: AbortSignal;
}

/** A stage that ended badly, with the facts of why. */
export class DeployStageFailure extends Error {
  constructor(readonly error: DeployStageError) {
    super(error.code);
    this.name = "DeployStageFailure";
  }
}

/** The engineer pressed Stop. */
export class DeployStopped extends Error {
  constructor() {
    super("stopped");
    this.name = "DeployStopped";
  }
}

export interface DeployStageDefinition {
  id: DeployStage;
  run(ctx: DeployStageContext): Promise<void>;
}

function checkStopped(ctx: DeployStageContext) {
  if (ctx.signal.aborted) throw new DeployStopped();
}

/** Output handed on as whole lines; the last partial line waits for the rest of it. */
function lineWriter(log: (text: string) => void) {
  let pending = "";
  return {
    write(text: string) {
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) if (line.trim() !== "") log(line);
    },
    flush() {
      if (pending.trim() !== "") log(pending);
      pending = "";
    },
  };
}

/** Runs git, logging the command and what git said; a failure ends the stage unless allowed. */
async function git(
  ctx: DeployStageContext,
  args: string[],
  options: { timeoutMs?: number; allowFailure?: boolean; quiet?: boolean; cwd?: string } = {},
) {
  checkStopped(ctx);
  const command = `git ${args.join(" ")}`;
  ctx.log(`$ ${command}`);
  const result = await ctx.git.run(args, options.cwd ?? ctx.module.dir, {
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    signal: ctx.signal,
  });
  if (!options.quiet) {
    const out = lineWriter(ctx.log);
    out.write(`${result.stdout}\n${result.stderr}`);
    out.flush();
  }
  checkStopped(ctx);
  if (result.error === "stopped") throw new DeployStopped();
  if (result.code !== 0 && !options.allowFailure) {
    if (result.error === "not_found")
      throw new DeployStageFailure({ code: "command_missing", command: "git" });
    if (result.error === "timed_out")
      throw new DeployStageFailure({ code: "command_timed_out", command });
    throw new DeployStageFailure({
      code: "command_failed",
      command,
      exitCode: result.code,
      output: tailOf(`${result.stdout}\n${result.stderr}`),
    });
  }
  return result;
}

/** Characters of paths one `git add` may name, well under Windows' 32,767-character command line. */
const ADD_BATCH_CHARS = 8_000;

/** Stages the paths in batches, so a product with hundreds of files never overflows the command line. */
async function gitAdd(
  ctx: DeployStageContext,
  flags: readonly string[],
  paths: readonly string[],
  cwd: string,
) {
  let batch: string[] = [];
  let size = 0;
  for (const path of paths) {
    if (batch.length && size + path.length + 1 > ADD_BATCH_CHARS) {
      await git(ctx, ["add", ...flags, "--", ...batch], { cwd });
      batch = [];
      size = 0;
    }
    batch.push(path);
    size += path.length + 1;
  }
  if (batch.length) await git(ctx, ["add", ...flags, "--", ...batch], { cwd });
}

function tailOf(text: string): string {
  return text.trim().split(/\r?\n/).slice(-20).join("\n");
}

/** Runs a program in the clone, streaming its output to the log; a failure ends the stage. */
async function program(ctx: DeployStageContext, command: string, args: readonly string[]) {
  checkStopped(ctx);
  const line = `${command} ${args.join(" ")}`;
  ctx.log(`$ ${line}`);
  const out = lineWriter(ctx.log);
  const result = await ctx.process.run(command, [...args], {
    cwd: ctx.module.dir,
    signal: ctx.signal,
    onOutput: (text) => out.write(text),
  });
  out.flush();
  if (result.error === "stopped" || ctx.signal.aborted) throw new DeployStopped();
  if (result.error === "not_found" || result.error === "not_started")
    throw new DeployStageFailure({ code: "command_missing", command });
  if (result.error === "timed_out")
    throw new DeployStageFailure({ code: "command_timed_out", command: line });
  if (result.code !== 0)
    throw new DeployStageFailure({
      code: "command_failed",
      command: line,
      exitCode: result.code,
      output: tailOf(result.tail),
    });
}

async function exists(file: string): Promise<boolean> {
  return fs.stat(file).then(
    () => true,
    () => false,
  );
}

/** What is never copied from an assembled module into the clone. */
const NOT_COPIED = new Set([".git", "node_modules"]);

/** Copies the assembled module over the clone's working tree (files the module lacks stay). */
async function syncModule(source: string, target: string): Promise<number> {
  let copied = 0;
  async function walk(from: string, to: string) {
    for (const entry of await fs.readdir(from, { withFileTypes: true })) {
      if (NOT_COPIED.has(entry.name)) continue;
      const src = path.join(from, entry.name);
      const dst = path.join(to, entry.name);
      if (entry.isDirectory()) {
        await fs.mkdir(dst, { recursive: true });
        await walk(src, dst);
      } else if (entry.isFile()) {
        await fs.copyFile(src, dst);
        copied++;
      }
    }
  }
  await walk(source, target);
  return copied;
}

async function tagsOf(ctx: DeployStageContext): Promise<string | null> {
  await git(ctx, ["fetch", "--tags", "origin"], { timeoutMs: PUSH_TIMEOUT_MS });
  const listed = await git(ctx, ["tag", "--list"], { quiet: true });
  return latestSemver(listed.stdout.split(/\r?\n/));
}

async function jenkinsCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new DeployStageFailure({
      code: "jenkins_failed",
      status: error instanceof JenkinsError ? error.status : 0,
    });
  }
}

const verifyModule: DeployStageDefinition = {
  id: "verify_module",
  async run(ctx) {
    // The module is where activities are authored, so what is in its working tree is work:
    // it is carried onto main as origin has it (never reset away), the newest assembled
    // module is copied over it, and all of it is committed on main before the checks run.
    const fetched = await git(ctx, ["fetch", "origin"], {
      timeoutMs: PUSH_TIMEOUT_MS,
      allowFailure: true,
    });
    if (fetched.code !== 0) {
      // A new product's module starts locally; its repository has to exist before a deploy.
      if (repositoryMissing(fetched.stderr)) {
        const remote = await git(ctx, ["remote", "get-url", "origin"], { quiet: true });
        throw new DeployStageFailure({
          code: "module_repository_missing",
          remote: remote.stdout.trim(),
        });
      }
      await git(ctx, ["fetch", "origin"], { timeoutMs: PUSH_TIMEOUT_MS });
    }
    await onMainCarryingWork(ctx, ctx.module.dir);
    if (ctx.module.source) {
      const copied = await syncModule(ctx.module.source, ctx.module.dir);
      ctx.log(`Copied ${copied} files from the newest assembled module.`);
    } else ctx.log("No assembled module: verifying the module as its repository holds it.");
    await git(ctx, ["add", "--all"]);
    const authored = await commitStaged(
      ctx,
      ctx.module.dir,
      `Penguin Harness: ${ctx.productCode} as authored`,
    );
    ctx.log(
      authored
        ? `Committed the authored module on main: ${authored}.`
        : "Main already had everything authored.",
    );
    ctx.metadata.moduleContentHash = ctx.module.contentHash ?? null;
    for (const args of MODULE_VERIFY_COMMANDS) await program(ctx, "npm", args);
  },
};

/**
 * Puts a clone on main as origin has it without losing what is in its working tree: the
 * work is set aside, main is checked out and fast-forwarded to origin (a main that has
 * diverged from origin fails the stage, naming git's reason), and the work is put back. A
 * clone with no main yet (a new module) starts it where it is.
 */
async function onMainCarryingWork(ctx: DeployStageContext, cwd: string): Promise<void> {
  const status = await git(ctx, ["status", "--porcelain"], { quiet: true, cwd });
  const work = status.stdout.trim() !== "";
  const stash = ["stash", "push", "--include-untracked", "-m", "penguin-harness deploy"];
  const stashed = work && (await git(ctx, stash, { cwd, allowFailure: true })).code === 0;
  if (work && !stashed) {
    // git cannot stash in a repository with no commit yet: a new product's module, made
    // locally, before its first deploy, whose work then stays where it is. A stash that
    // failed for any other reason (a conflict, say) stops the deploy with git's own words.
    const born = await git(ctx, ["rev-parse", "--verify", "--quiet", "HEAD"], {
      allowFailure: true,
      quiet: true,
      cwd,
    });
    if (born.code === 0) await git(ctx, stash, { cwd });
  }
  const local = await git(ctx, ["rev-parse", "--verify", "--quiet", `refs/heads/${BASE_BRANCH}`], {
    allowFailure: true,
    quiet: true,
    cwd,
  });
  const remote = await git(
    ctx,
    ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${BASE_BRANCH}`],
    { allowFailure: true, quiet: true, cwd },
  );
  if (work && !stashed) {
    ctx.log("No commit yet: the new module's work stays in place.");
    // Main starts as origin has it, the work left as changes to it; with no main on origin
    // either, main is born when the work is committed.
    await git(ctx, ["symbolic-ref", "HEAD", `refs/heads/${BASE_BRANCH}`], { cwd });
    if (remote.code === 0) {
      await git(ctx, ["reset", "--mixed", `origin/${BASE_BRANCH}`], { cwd });
      // Origin's files the new module never had would read as deleted and be committed
      // away: they are checked out, and only the module's own work is a change.
      const deleted = await git(ctx, ["ls-files", "--deleted", "-z"], { quiet: true, cwd });
      const missing = deleted.stdout.split("\0").filter(Boolean);
      if (missing.length) await git(ctx, ["checkout", "--", ...missing], { cwd });
    }
    return;
  }
  if (local.code === 0) await git(ctx, ["checkout", BASE_BRANCH], { cwd });
  else if (remote.code === 0)
    await git(ctx, ["checkout", "-b", BASE_BRANCH, `origin/${BASE_BRANCH}`], { cwd });
  else await git(ctx, ["checkout", "-B", BASE_BRANCH], { cwd });
  if (remote.code === 0) await git(ctx, ["merge", "--ff-only", `origin/${BASE_BRANCH}`], { cwd });
  // A conflict here keeps the work in the stash, and git's output says so.
  if (stashed) await git(ctx, ["stash", "pop"], { cwd });
}

/** Writes the package name, and the version when one is given, into package.json and its lock. */
async function syncPackage(ctx: DeployStageContext): Promise<string | undefined> {
  const name = modulePackageName(ctx.module.folder);
  const file = path.join(ctx.module.dir, "package.json");
  const pkg = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
  pkg.name = name;
  if (ctx.moduleVersion) pkg.version = ctx.moduleVersion;
  await fs.writeFile(file, `${JSON.stringify(pkg, null, 2)}\n`);
  const lockFile = path.join(ctx.module.dir, "package-lock.json");
  if (await exists(lockFile)) {
    const lock = JSON.parse(await fs.readFile(lockFile, "utf8")) as Record<string, unknown>;
    lock.name = name;
    if (ctx.moduleVersion) lock.version = ctx.moduleVersion;
    const root = (lock.packages as Record<string, Record<string, unknown>> | undefined)?.[""];
    if (root) {
      root.name = name;
      if (ctx.moduleVersion) root.version = ctx.moduleVersion;
    }
    await fs.writeFile(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
  }
  return typeof pkg.version === "string" ? pkg.version : undefined;
}

const prepareDeploy: DeployStageDefinition = {
  id: "prepare_deploy",
  async run(ctx) {
    const branch = deployBranchName(ctx.module.folder);
    // From main, carrying the verified content in the working tree onto the deploy branch.
    // That content is only there straight after verify_module, which is why this stage runs
    // once per verify (stageBlocker).
    await git(ctx, ["checkout", "-B", branch, BASE_BRANCH]);
    const version = await syncPackage(ctx);
    if (version) ctx.metadata.moduleVersion = version;
    if (await exists(path.join(ctx.module.dir, "res", "style.scss")))
      await program(ctx, "npx", [
        "--yes",
        "-p",
        SASS_PACKAGE,
        "sass",
        "res/style.scss",
        "res/style.css",
        "--no-source-map",
      ]);
    else ctx.log("No res/style.scss: no stylesheet to compile.");
    await git(ctx, ["add", "--all"]);
    const staged = await git(ctx, ["diff", "--cached", "--quiet"], {
      allowFailure: true,
      quiet: true,
    });
    if (staged.code === 0) {
      ctx.log("Nothing changed since the branch's last commit: nothing to commit.");
      return;
    }
    const { userName, userEmail } = ctx.settings.git;
    await git(ctx, [
      "-c",
      `user.name=${userName}`,
      "-c",
      `user.email=${userEmail}`,
      "commit",
      "-m",
      `Prepare module deploy for ${ctx.productCode}`,
    ]);
    const head = await git(ctx, ["rev-parse", "HEAD"], { quiet: true });
    ctx.metadata.commit = head.stdout.trim();
  },
};

/**
 * How a trigger reads the newest build before starting one: past the queue, whose matching
 * item has no number yet — reading it would leave no floor, and an older success could pass.
 */
const BEFORE_TRIGGER = { skipQueue: true } as const;

const triggerModuleBuild: DeployStageDefinition = {
  id: "trigger_module_build",
  async run(ctx) {
    const branch = deployBranchName(ctx.module.folder);
    const job = ctx.settings.jobs.moduleBuild;
    const params = { Modules: moduleBuildLine(ctx.module.folder) };
    ctx.metadata.preBuildTag = await tagsOf(ctx);
    ctx.log(`Newest release tag before the build: ${ctx.metadata.preBuildTag ?? "none"}.`);
    const before = await jenkinsCall(() => ctx.jenkins.status(job, params, BEFORE_TRIGGER));
    ctx.metadata.preBuildNumber = before.number ?? null;
    const remoteMain = await git(
      ctx,
      ["ls-remote", "--heads", "origin", `refs/heads/${BASE_BRANCH}`],
      {
        timeoutMs: PUSH_TIMEOUT_MS,
        quiet: true,
      },
    );
    if (remoteMain.stdout.trim() === "")
      await git(ctx, ["push", "origin", BASE_BRANCH], { timeoutMs: PUSH_TIMEOUT_MS });
    await git(ctx, ["push", "--force-with-lease", "-u", "origin", branch], {
      timeoutMs: PUSH_TIMEOUT_MS,
    });
    checkStopped(ctx);
    ctx.log(`Starting Jenkins job "${job}" with Modules=${params.Modules}.`);
    const { queueUrl } = await jenkinsCall(() => ctx.jenkins.trigger(job, params));
    if (queueUrl) ctx.log(`Queued: ${queueUrl}`);
  },
};

const awaitModuleBuild: DeployStageDefinition = {
  id: "await_module_build",
  async run(ctx) {
    // Run on its own, the stage waits on the build the trigger stage last started.
    const triggered =
      ctx.metadata.preBuildTag !== undefined ? ctx.metadata : ctx.earlier.trigger_module_build;
    if (!triggered || triggered.preBuildTag === undefined)
      throw new DeployStageFailure({ code: "missing_input", stage: "trigger_module_build" });
    const before = triggered.preBuildTag;
    const after = triggered.preBuildNumber ?? null;
    ctx.metadata.preBuildTag = before;
    ctx.metadata.preBuildNumber = after;
    const job = ctx.settings.jobs.moduleBuild;
    const params = { Modules: moduleBuildLine(ctx.module.folder) };
    const minutes = ctx.settings.timeouts.buildMinutes;
    const deadline = ctx.clock.now() + minutes * 60_000;
    let last: JenkinsBuildStatus["state"] | null = null;
    for (;;) {
      checkStopped(ctx);
      const status = await jenkinsCall(() => ctx.jenkins.status(job, params, { after }));
      if (status.url && status.url !== ctx.metadata.moduleBuildUrl) {
        ctx.metadata.moduleBuildUrl = status.url;
        ctx.log(`Build: ${status.url}`);
      }
      if (status.state !== last) {
        ctx.log(`Jenkins: ${status.state}${status.number ? ` (#${status.number})` : ""}.`);
        last = status.state;
      }
      if (status.state === "failed")
        throw new DeployStageFailure({
          code: "build_failed",
          result: status.result ?? "FAILURE",
          url: status.url ?? null,
        });
      const latest = await tagsOf(ctx);
      if (latest && (before === null || compareSemver(latest, before) > 0)) {
        ctx.metadata.resolvedModuleVersion = latest;
        ctx.log(`Released as ${latest}.`);
        return;
      }
      if (status.state === "succeeded")
        throw new DeployStageFailure({ code: "no_newer_tag", before, after: latest });
      if (ctx.clock.now() >= deadline)
        throw new DeployStageFailure({ code: "build_timed_out", minutes });
      await ctx.clock.sleep(BUILD_POLL_MS, ctx.signal);
    }
  },
};

/** How often the activity deploy is looked at while waiting for it. */
export const DEPLOY_POLL_MS = 15_000;

/** How many media paths a failure or the metadata names at most. */
const PATHS_SHOWN = 20;

function qaOf(ctx: DeployStageContext): DeployQaContext {
  if (!ctx.qa) throw new Error("This run has no activity-data or media clone to work in.");
  return ctx.qa;
}

/**
 * The released module version the QA stages pin: this run's, else the one the last release (or
 * the last export) recorded. A QA stage never guesses one.
 */
function releasedVersion(ctx: DeployStageContext): string {
  const version =
    ctx.metadata.resolvedModuleVersion ??
    ctx.earlier.export_activity_data?.resolvedModuleVersion ??
    ctx.earlier.await_module_build?.resolvedModuleVersion;
  if (!version)
    throw new DeployStageFailure({ code: "missing_input", stage: "await_module_build" });
  ctx.metadata.resolvedModuleVersion = version;
  return version;
}

/** Puts a clone on `branch` as origin has it (or on a new one from origin's main), clean. */
async function resetClone(ctx: DeployStageContext, cwd: string, branch: string) {
  await git(ctx, ["fetch", "origin"], { timeoutMs: PUSH_TIMEOUT_MS, cwd });
  const has = async (ref: string) =>
    (
      await git(ctx, ["rev-parse", "--verify", "--quiet", ref], {
        allowFailure: true,
        quiet: true,
        cwd,
      })
    ).code === 0;
  const start = (await has(`refs/remotes/origin/${branch}`))
    ? `origin/${branch}`
    : (await has(`refs/remotes/origin/${BASE_BRANCH}`))
      ? `origin/${BASE_BRANCH}`
      : BASE_BRANCH;
  await git(ctx, ["checkout", "-f", "-B", branch, start], { cwd });
  await git(ctx, ["clean", "-fd"], { cwd });
}

/** The exported data's check, reading the activity-data clone. */
async function preflightOf(ctx: DeployStageContext, version: string) {
  const qa = qaOf(ctx);
  return runPreflight({
    productCode: ctx.productCode,
    expectedModule: mainModule(ctx.module.folder, version),
    mediaBase: ctx.settings.repos.mediaPublicBase,
    read: async (relative) => {
      const file = withinRoot(qa.activityData.dir, relative);
      return file ? fs.readFile(file, "utf8").catch(() => null) : null;
    },
  });
}

/** Commits what is staged as the configured identity; the new commit, or null when nothing was. */
async function commitStaged(
  ctx: DeployStageContext,
  cwd: string,
  message: string,
): Promise<string | null> {
  const staged = await git(ctx, ["diff", "--cached", "--quiet"], {
    allowFailure: true,
    quiet: true,
    cwd,
  });
  if (staged.code === 0) return null;
  const { userName, userEmail } = ctx.settings.git;
  await git(
    ctx,
    ["-c", `user.name=${userName}`, "-c", `user.email=${userEmail}`, "commit", "-m", message],
    { cwd },
  );
  return (await git(ctx, ["rev-parse", "HEAD"], { quiet: true, cwd })).stdout.trim();
}

const exportActivityData: DeployStageDefinition = {
  id: "export_activity_data",
  async run(ctx) {
    const qa = qaOf(ctx);
    const version = releasedVersion(ctx);
    const dir = qa.activityData.dir;
    await resetClone(ctx, dir, activityDataBranchName(ctx.productCode));
    const snapshot = await qa.snapshot();
    checkStopped(ctx);
    let files;
    try {
      files = exportFiles({
        productCode: ctx.productCode,
        title: snapshot.title,
        layout: snapshot.layout,
        theme: snapshot.theme,
        moduleFolder: ctx.module.folder,
        version,
        mediaBase: ctx.settings.repos.mediaPublicBase,
        refs: snapshot.refs,
      });
    } catch (error) {
      if (error instanceof ExportLayoutError) ctx.log(error.message);
      throw error;
    }
    for (const file of files) {
      const target = withinRoot(dir, file.path);
      if (!target) throw new Error(`An exported path left the clone: ${file.path}`);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.content);
      ctx.log(`Wrote ${file.path}`);
    }
    const refs = deployedRefs(snapshot.refs);
    ctx.metadata.deployedRefNums = refs.map((ref) => ref.refNum);
    ctx.metadata.exportedFiles = files.map((file) => file.path);
    ctx.metadata.exportedRevision = snapshot.contentRevision;
    ctx.metadata.exportedProductRevision = snapshot.productRevision;
    ctx.log(
      `Exported ${refs.length} ref${refs.length === 1 ? "" : "s"} for ${mainModule(ctx.module.folder, version)}.`,
    );
  },
};

const verifyActivityData: DeployStageDefinition = {
  id: "verify_activity_data",
  async run(ctx) {
    const version = releasedVersion(ctx);
    const report = await preflightOf(ctx, version);
    const { errors, warnings, counts } = report;
    ctx.metadata.preflight = { errors, warnings, counts };
    ctx.log(
      `Checked ${report.counts.templates} template, ${report.counts.configurations} configurations, ${report.counts.assessments} assessments and ${report.counts.media} media files.`,
    );
    for (const warning of report.warnings) ctx.log(`Warning: ${JSON.stringify(warning)}`);
    for (const error of report.errors) ctx.log(`Error: ${JSON.stringify(error)}`);
    if (report.errors.length)
      throw new DeployStageFailure({ code: "preflight_failed", errors: report.errors.length });
  },
};

const verifyMediaAssets: DeployStageDefinition = {
  id: "verify_media_assets",
  async run(ctx) {
    const qa = qaOf(ctx);
    const version = releasedVersion(ctx);
    const report = await preflightOf(ctx, version);
    if (report.errors.length)
      throw new DeployStageFailure({ code: "preflight_failed", errors: report.errors.length });
    ctx.metadata.mediaChecked = report.media.length;
    const cwd = qa.media.dir;
    // Authored media (accepted takes, uploads, candidates) is in the clone's working tree:
    // main is brought up to origin around it, and only what the data names is published.
    await git(ctx, ["fetch", "origin"], { timeoutMs: PUSH_TIMEOUT_MS, cwd });
    await onMainCarryingWork(ctx, cwd);
    const result = await syncMedia(
      { dir: cwd, references: report.media },
      {
        git: (args, options = {}) => git(ctx, args, { ...options, cwd }),
        log: ctx.log,
      },
    );
    for (const missing of result.missing.slice(0, PATHS_SHOWN)) ctx.log(`Missing: ${missing}`);
    if (result.missing.length)
      throw new DeployStageFailure({
        code: "media_missing",
        paths: result.missing.slice(0, PATHS_SHOWN),
        count: result.missing.length,
      });
    ctx.metadata.mediaCopied = result.copied.slice(0, PATHS_SHOWN);
    ctx.metadata.mediaCopiedCount = result.copied.length;
    if (!result.copied.length) {
      ctx.log("The media repository already has every file: nothing to publish.");
      return;
    }
    // --sparse: an authored file may sit in a folder the partial clone has not checked out.
    await gitAdd(ctx, ["--sparse"], result.copied, cwd);
    const commit = await commitStaged(ctx, cwd, `Publish media for ${ctx.productCode}`);
    if (!commit) return;
    ctx.metadata.mediaCommit = commit;
    await git(ctx, ["push", "origin", BASE_BRANCH], { timeoutMs: PUSH_TIMEOUT_MS, cwd });
  },
};

const publishActivityData: DeployStageDefinition = {
  id: "publish_activity_data",
  async run(ctx) {
    const qa = qaOf(ctx);
    const version = releasedVersion(ctx);
    const files =
      ctx.metadata.exportedFiles ?? ctx.earlier.export_activity_data?.exportedFiles ?? null;
    if (!files?.length)
      throw new DeployStageFailure({ code: "missing_input", stage: "export_activity_data" });
    const cwd = qa.activityData.dir;
    const branch = activityDataBranchName(ctx.productCode);
    await gitAdd(ctx, ["--all"], files, cwd);
    const commit = await commitStaged(
      ctx,
      cwd,
      `Deploy activity data for ${ctx.productCode} (${mainModule(ctx.module.folder, version)})`,
    );
    if (commit) ctx.metadata.activityDataCommit = commit;
    else ctx.log("The activity data had not changed: nothing to commit.");
    await git(ctx, ["push", "-u", "origin", branch], { timeoutMs: PUSH_TIMEOUT_MS, cwd });
  },
};

/** The parameters the activity deploy job is started with, as the job takes them. */
export function activityDeployParams(
  productCode: string,
  target: DeployJobTarget,
): Record<string, string> {
  return {
    branch: activityDataBranchName(productCode),
    framework_version: target.frameworkVersion,
    tier: target.tier,
    deploy_environment: target.environment,
    add_activities_to_catalog: "false",
    template_names: productCode,
  };
}

/** The parameters a started activity deploy is recognised by. */
function activityDeployMatch(params: Record<string, string>): Record<string, string> {
  return {
    branch: params.branch!,
    tier: params.tier!,
    deploy_environment: params.deploy_environment!,
    template_names: params.template_names!,
  };
}

/** Where the deployed activity opens on QA. */
export function qaActivityUrl(
  base: string,
  productCode: string,
  refNum: number,
  frameworkVersion: string,
): string {
  const query = new URLSearchParams({
    productCode,
    refNum: String(refNum),
    frameworkVersion,
  });
  return `${base}?${query.toString()}`;
}

const triggerActivityDeploy: DeployStageDefinition = {
  id: "trigger_activity_deploy",
  async run(ctx) {
    const qa = qaOf(ctx);
    const job = ctx.settings.jobs.activityDeploy;
    const params = activityDeployParams(ctx.productCode, qa.target);
    const before = await jenkinsCall(() =>
      ctx.jenkins.status(job, activityDeployMatch(params), BEFORE_TRIGGER),
    );
    ctx.metadata.preDeployNumber = before.number ?? null;
    ctx.metadata.qaFrameworkVersion = qa.target.frameworkVersion;
    ctx.metadata.qaActivityUrl = qaActivityUrl(
      qa.target.activityBaseUrl,
      ctx.productCode,
      qa.refNum,
      qa.target.frameworkVersion,
    );
    checkStopped(ctx);
    ctx.log(`Starting Jenkins job "${job}" with ${new URLSearchParams(params).toString()}.`);
    const { queueUrl } = await jenkinsCall(() => ctx.jenkins.trigger(job, params));
    if (queueUrl) ctx.log(`Queued: ${queueUrl}`);
  },
};

/**
 * Follows a started activity deploy every 15 seconds until it succeeds, fails, or the
 * configured minutes pass. `onUrl` gets the build's page once Jenkins has one. Returns the
 * number of the build that succeeded, or null when Jenkins gave none.
 */
async function followActivityDeploy(
  ctx: DeployStageContext,
  options: {
    match: Record<string, string>;
    after: number | null;
    onUrl(url: string): void;
    /** Named in a timeout; QA's timeouts name none, as they always have. */
    target?: DeployTarget;
  },
): Promise<number | null> {
  const job = ctx.settings.jobs.activityDeploy;
  const minutes = ctx.settings.timeouts.deployMinutes;
  const deadline = ctx.clock.now() + minutes * 60_000;
  let last: JenkinsBuildStatus["state"] | null = null;
  let url: string | null = null;
  for (;;) {
    checkStopped(ctx);
    const status = await jenkinsCall(() =>
      ctx.jenkins.status(job, options.match, { after: options.after }),
    );
    if (status.url && status.url !== url) {
      url = status.url;
      options.onUrl(status.url);
      ctx.log(`Deploy: ${status.url}`);
    }
    if (status.state !== last) {
      ctx.log(`Jenkins: ${status.state}${status.number ? ` (#${status.number})` : ""}.`);
      last = status.state;
    }
    if (status.state === "failed")
      throw new DeployStageFailure({
        code: "build_failed",
        result: status.result ?? "FAILURE",
        url: status.url ?? null,
      });
    if (status.state === "succeeded") return status.number ?? null;
    if (ctx.clock.now() >= deadline)
      throw new DeployStageFailure({
        code: "deploy_timed_out",
        minutes,
        ...(options.target ? { target: options.target } : {}),
      });
    await ctx.clock.sleep(DEPLOY_POLL_MS, ctx.signal);
  }
}

/** Whether a finished deploy stage followed the build an earlier run of it already recorded. */
function sameBuild(recorded: number | null | undefined, found: number | null): boolean {
  return typeof recorded === "number" && recorded === found;
}

const awaitActivityDeploy: DeployStageDefinition = {
  id: "await_activity_deploy",
  async run(ctx) {
    const qa = qaOf(ctx);
    // Run on its own, the stage waits on the deploy the trigger stage last started.
    const triggered =
      ctx.metadata.preDeployNumber !== undefined
        ? ctx.metadata
        : ctx.earlier.trigger_activity_deploy;
    if (!triggered || triggered.preDeployNumber === undefined)
      throw new DeployStageFailure({ code: "missing_input", stage: "trigger_activity_deploy" });
    const after = triggered.preDeployNumber ?? null;
    ctx.metadata.preDeployNumber = after;
    ctx.metadata.qaFrameworkVersion = triggered.qaFrameworkVersion ?? qa.target.frameworkVersion;
    ctx.metadata.qaActivityUrl =
      triggered.qaActivityUrl ??
      qaActivityUrl(
        qa.target.activityBaseUrl,
        ctx.productCode,
        qa.refNum,
        ctx.metadata.qaFrameworkVersion,
      );
    const number = await followActivityDeploy(ctx, {
      match: activityDeployMatch(activityDeployParams(ctx.productCode, qa.target)),
      after,
      onUrl: (url) => {
        ctx.metadata.activityDeployUrl = url;
      },
    });
    const previous = ctx.earlier.await_activity_deploy;
    ctx.metadata.activityDeployNumber = number;
    if (sameBuild(previous?.activityDeployNumber, number) && previous?.qaDeployedAt) {
      // Run again on its own, the stage found the build it had already seen finish.
      ctx.metadata.qaDeployedAt = previous.qaDeployedAt;
      ctx.metadata.alreadyRecorded = true;
    } else ctx.metadata.qaDeployedAt = new Date(ctx.clock.now()).toISOString();
    const revision =
      ctx.metadata.exportedRevision ?? ctx.earlier.export_activity_data?.exportedRevision;
    if (revision) ctx.metadata.contentRevision = revision;
    const productRevision =
      ctx.metadata.exportedProductRevision ??
      ctx.earlier.export_activity_data?.exportedProductRevision;
    if (productRevision) ctx.metadata.productRevision = productRevision;
    ctx.log(`On QA: ${ctx.metadata.qaActivityUrl}`);
  },
};

function prodOf(ctx: DeployStageContext): DeployProdContext {
  if (!ctx.prod) throw new Error("This run has no PROD settings to deploy with.");
  return ctx.prod;
}

const triggerProductionDeploy: DeployStageDefinition = {
  id: "trigger_production_deploy",
  async run(ctx) {
    const prod = prodOf(ctx);
    // PROD gets what QA has: the branch QA's deploy published, at the revision QA recorded.
    const qa = ctx.earlier.await_activity_deploy;
    if (!qa)
      throw new DeployStageFailure({ code: "missing_input", stage: "await_activity_deploy" });
    if (qa.contentRevision) ctx.metadata.contentRevision = qa.contentRevision;
    if (qa.resolvedModuleVersion) ctx.metadata.resolvedModuleVersion = qa.resolvedModuleVersion;
    const job = ctx.settings.jobs.activityDeploy;
    const params = activityDeployParams(ctx.productCode, prod.target);
    const before = await jenkinsCall(() =>
      ctx.jenkins.status(job, activityDeployMatch(params), BEFORE_TRIGGER),
    );
    ctx.metadata.preProductionDeployNumber = before.number ?? null;
    ctx.metadata.prodFrameworkVersion = prod.target.frameworkVersion;
    checkStopped(ctx);
    ctx.log(
      `Starting Jenkins job "${job}" on PROD with ${new URLSearchParams(params).toString()}.`,
    );
    const { queueUrl } = await jenkinsCall(() => ctx.jenkins.trigger(job, params));
    if (queueUrl) ctx.log(`Queued: ${queueUrl}`);
  },
};

const awaitProductionDeploy: DeployStageDefinition = {
  id: "await_production_deploy",
  async run(ctx) {
    const prod = prodOf(ctx);
    // Run on its own, the stage waits on the deploy the trigger stage last started.
    const triggered =
      ctx.metadata.preProductionDeployNumber !== undefined
        ? ctx.metadata
        : ctx.earlier.trigger_production_deploy;
    if (!triggered || triggered.preProductionDeployNumber === undefined)
      throw new DeployStageFailure({ code: "missing_input", stage: "trigger_production_deploy" });
    ctx.metadata.preProductionDeployNumber = triggered.preProductionDeployNumber ?? null;
    ctx.metadata.prodFrameworkVersion =
      triggered.prodFrameworkVersion ?? prod.target.frameworkVersion;
    if (triggered.contentRevision) ctx.metadata.contentRevision = triggered.contentRevision;
    if (triggered.resolvedModuleVersion)
      ctx.metadata.resolvedModuleVersion = triggered.resolvedModuleVersion;
    const number = await followActivityDeploy(ctx, {
      match: activityDeployMatch(activityDeployParams(ctx.productCode, prod.target)),
      after: ctx.metadata.preProductionDeployNumber,
      onUrl: (url) => {
        ctx.metadata.productionDeployUrl = url;
      },
      target: "prod",
    });
    const previous = ctx.earlier.await_production_deploy;
    ctx.metadata.productionDeployNumber = number;
    if (sameBuild(previous?.productionDeployNumber, number) && previous?.prodDeployedAt) {
      // Run again on its own, the stage found the build it had already seen finish.
      ctx.metadata.prodDeployedAt = previous.prodDeployedAt;
      ctx.metadata.alreadyRecorded = true;
    } else ctx.metadata.prodDeployedAt = new Date(ctx.clock.now()).toISOString();
    ctx.log("On PROD.");
  },
};

export const DEPLOY_STAGE_DEFINITIONS: Record<DeployStage, DeployStageDefinition> = {
  verify_module: verifyModule,
  prepare_deploy: prepareDeploy,
  trigger_module_build: triggerModuleBuild,
  await_module_build: awaitModuleBuild,
  export_activity_data: exportActivityData,
  verify_activity_data: verifyActivityData,
  verify_media_assets: verifyMediaAssets,
  publish_activity_data: publishActivityData,
  trigger_activity_deploy: triggerActivityDeploy,
  await_activity_deploy: awaitActivityDeploy,
  trigger_production_deploy: triggerProductionDeploy,
  await_production_deploy: awaitProductionDeploy,
};

/** The stages a selection runs, in order (a QA deploy's before any release is left out). */
export function stagesFor(selection: DeployStageSelection): DeployStage[] {
  if (selection === "release") return [...DEPLOY_RELEASE_STAGES];
  if (selection === "qa") return [...DEPLOY_STAGES];
  if (selection === "prod") return [...DEPLOY_PROD_STAGES];
  return [selection];
}

export function isStageSelection(value: unknown): value is DeployStageSelection {
  return (
    value === "release" ||
    value === "qa" ||
    value === "prod" ||
    (typeof value === "string" && (DEPLOY_ALL_STAGES as readonly string[]).includes(value))
  );
}

/** Whether a selection deploys to PROD: the PROD deploy, or one of its stages on its own. */
export function isProdSelection(selection: DeployStageSelection): boolean {
  return selection === "prod" || (DEPLOY_PROD_STAGES as readonly string[]).includes(selection);
}

/**
 * Whether the module's release is current, so a QA deploy can leave it out: every release
 * stage is done since the last verify, and verify checked the same assembled module (by its
 * content hash). Without an assembled module there is nothing to compare, so the release runs.
 */
export function releaseCurrent(
  stored: Partial<Record<DeployStage, { status: DeployStageStatus; metadata: DeployRunMetadata }>>,
  contentHash: string | null,
): boolean {
  if (!contentHash) return false;
  if (!DEPLOY_RELEASE_STAGES.every((stage) => stored[stage]?.status === "done")) return false;
  return (
    stored.verify_module?.metadata.moduleContentHash === contentHash &&
    Boolean(stored.await_module_build?.metadata.resolvedModuleVersion)
  );
}

/** The stages a QA deploy runs: all ten, or the six after the release when it is current. */
export function qaStages(releaseIsCurrent: boolean): DeployStage[] {
  return releaseIsCurrent ? [...DEPLOY_QA_STAGES] : [...DEPLOY_STAGES];
}

/**
 * Readiness problems every stage tolerates in the clones. The module and media clones hold
 * authored work, which the stages carry and commit; the activity-data clone is this server's
 * own, and export puts it back as origin has it. A release leaves the module clone on a
 * branch whose upstream is not there yet; an export that failed half way leaves the
 * activity-data clone with changes or commits not yet pushed.
 */
function tolerated(problem: DeployProblem): boolean {
  if (!("repo" in problem)) return false;
  if (problem.code === "clone_dirty" || problem.code === "clone_ahead") return true;
  if (problem.code !== "clone_unknown") return false;
  return problem.repo === "module" || problem.what === "status" || problem.what === "upstream";
}

/** The readiness problems that keep a stage from starting. */
export function startProblems(context: DeployContext): DeployProblem[] {
  return context.problems.filter((problem) => !tolerated(problem));
}

/**
 * Stages that work on what the stage before them left in the clone's working tree, so they run
 * once per run of that stage: running one again needs the stage before it run again first.
 */
const ONCE_PER_PREVIOUS: ReadonlySet<DeployStage> = new Set<DeployStage>(["prepare_deploy"]);

function blockerOf(problem: DeployProblem): DeployBlocker {
  if (problem.code === "settings_missing")
    return { code: "settings_missing", field: problem.field };
  if (problem.code === "clone_missing") return { code: "clone_missing", repo: problem.repo };
  if (problem.code === "clone_dirty") return { code: "clone_dirty", repo: problem.repo };
  return { code: "not_ready", problem };
}

/**
 * Why `stage` cannot run now, or null when it can: a run in progress, then the readiness
 * problems it does not tolerate, then the stage before it not done since it was last run
 * (starting a stage sets every stage after it back to pending), and for prepare_deploy, a run
 * of its own since verify_module last ran.
 */
export function stageBlocker(
  stage: DeployStage,
  context: DeployContext,
  statuses: Partial<Record<DeployStage, DeployStageStatus>>,
  runActive: boolean,
): DeployBlocker | null {
  if (runActive) return { code: "run_active" };
  const problem = startProblems(context)[0];
  if (problem) return blockerOf(problem);
  const index = DEPLOY_ALL_STAGES.indexOf(stage);
  if (index > 0) {
    const previous = DEPLOY_ALL_STAGES[index - 1]!;
    if (statuses[previous] !== "done") return { code: "previous_stage", stage: previous };
    if (ONCE_PER_PREVIOUS.has(stage) && (statuses[stage] ?? "pending") !== "pending")
      return { code: "previous_rerun", stage: previous };
  }
  return null;
}

/** A stage's stored state, as far as the PROD gate reads it. */
export interface GateStage {
  status: DeployStageStatus;
  finishedAt: string | null;
  metadata: DeployRunMetadata;
}

/**
 * Whether QA has the product as it is now, so PROD may get it: QA's deploy is done, finished
 * after the activity data was last published and its deploy last started, and recorded the
 * revision of every exported ref that the product still has — a sibling's edit counts too.
 */
export function qaCurrent(
  stored: Partial<Record<DeployStage, GateStage>>,
  currentProductRevision: string,
): boolean {
  const qa = stored.await_activity_deploy;
  if (qa?.status !== "done" || !qa.finishedAt) return false;
  const finished = Date.parse(qa.finishedAt);
  for (const stage of ["publish_activity_data", "trigger_activity_deploy"] as const) {
    const earlier = stored[stage];
    if (earlier?.status !== "done" || !earlier.finishedAt) return false;
    if (Date.parse(earlier.finishedAt) > finished) return false;
  }
  return (
    Boolean(qa.metadata.productRevision) && qa.metadata.productRevision === currentProductRevision
  );
}

/**
 * Why a PROD stage cannot run now, or null when it can: what keeps any stage from starting
 * (a run in progress, the readiness problems, the stage before it not done), then an empty
 * PROD setting, then, for the trigger, a QA deploy that is not of the activity as it is now.
 */
export function prodStageBlocker(
  stage: DeployStage,
  context: DeployContext,
  stored: Partial<Record<DeployStage, GateStage>>,
  runActive: boolean,
  facts: { currentProductRevision: string; missingSettings: readonly string[] },
): DeployBlocker | null {
  const statuses: Partial<Record<DeployStage, DeployStageStatus>> = {};
  for (const [key, value] of Object.entries(stored))
    if (value) statuses[key as DeployStage] = value.status;
  const base = stageBlocker(stage, context, statuses, runActive);
  if (base) return base;
  const field = facts.missingSettings[0];
  if (field) return { code: "settings_missing", field };
  if (stage === "trigger_production_deploy" && !qaCurrent(stored, facts.currentProductRevision))
    return { code: "qa_outdated" };
  return null;
}
