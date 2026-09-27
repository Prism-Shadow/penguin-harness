/**
 * The stages of a module release, each a step over injected ports, and which of them may run
 * now.
 *
 *   verify_module         put the module clone back to main as origin has it (whatever an
 *                         earlier release left there is dropped), copy the newest assembled
 *                         module over its working tree, and run `npm ci`, `npm run buildDebug`,
 *                         `npm run lint` and `npm run buildRelease` in it
 *   prepare_deploy        make the deploy branch from main, carrying that content; write the
 *                         package name and version; compile `res/style.scss` when there is one;
 *                         commit as the configured identity (nothing to commit is not a failure)
 *   trigger_module_build  note the newest release tag and Jenkins build, push main when the
 *                         remote lacks it, push the deploy branch, and start the module build
 *   await_module_build    every 15 seconds, look for a newer release tag than the one noted,
 *                         until one appears, the build fails, or the configured minutes pass
 *
 * Everything runs in the module's deploy clone under PENGUIN_HOME; the WAF checkout is never
 * touched. git, Jenkins, the programs and the clock are ports, so a test runs every stage with
 * fakes and nothing reaches a remote.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { BASE_BRANCH, deployBranchName, moduleShortName, type DeployGit } from "./deploy-git.js";
import type { DeployJenkins, JenkinsBuildStatus } from "./deploy-jenkins.js";
import { JenkinsError } from "./deploy-jenkins.js";
import type { DeployProcess } from "./deploy-process.js";
import type { DeploySettings } from "./deploy-settings.js";
import {
  DEPLOY_RELEASE_STAGES,
  type DeployBlocker,
  type DeployContext,
  type DeployProblem,
  type DeployRunMetadata,
  type DeployStage,
  type DeployStageError,
  type DeployStageSelection,
  type DeployStageStatus,
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
  };
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
  options: { timeoutMs?: number; allowFailure?: boolean; quiet?: boolean } = {},
) {
  checkStopped(ctx);
  const command = `git ${args.join(" ")}`;
  ctx.log(`$ ${command}`);
  const result = await ctx.git.run(args, ctx.module.dir, {
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
    // The clone is this server's own. What an earlier release left in it (the files it copied
    // in, a deploy branch checked out, a stage that failed or was stopped half way) is dropped,
    // so a release can always start again from main as origin has it.
    await git(ctx, ["fetch", "origin"], { timeoutMs: PUSH_TIMEOUT_MS });
    await git(ctx, ["checkout", "-f", BASE_BRANCH]);
    const tracked = await git(
      ctx,
      ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${BASE_BRANCH}`],
      { allowFailure: true, quiet: true },
    );
    if (tracked.code === 0) await git(ctx, ["reset", "--hard", `origin/${BASE_BRANCH}`]);
    await git(ctx, ["clean", "-fd", "-e", "node_modules"]);
    if (ctx.module.source) {
      const copied = await syncModule(ctx.module.source, ctx.module.dir);
      ctx.log(`Copied ${copied} files from the newest assembled module.`);
    } else ctx.log("No assembled module: verifying the module as its repository holds it.");
    for (const args of MODULE_VERIFY_COMMANDS) await program(ctx, "npm", args);
  },
};

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

const triggerModuleBuild: DeployStageDefinition = {
  id: "trigger_module_build",
  async run(ctx) {
    const branch = deployBranchName(ctx.module.folder);
    const job = ctx.settings.jobs.moduleBuild;
    const params = { Modules: moduleBuildLine(ctx.module.folder) };
    ctx.metadata.preBuildTag = await tagsOf(ctx);
    ctx.log(`Newest release tag before the build: ${ctx.metadata.preBuildTag ?? "none"}.`);
    const before = await jenkinsCall(() => ctx.jenkins.status(job, params));
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

export const DEPLOY_STAGE_DEFINITIONS: Record<DeployStage, DeployStageDefinition> = {
  verify_module: verifyModule,
  prepare_deploy: prepareDeploy,
  trigger_module_build: triggerModuleBuild,
  await_module_build: awaitModuleBuild,
};

/** The stages a selection runs, in order. */
export function stagesFor(selection: DeployStageSelection): DeployStage[] {
  return selection === "release" ? [...DEPLOY_RELEASE_STAGES] : [selection];
}

export function isStageSelection(value: unknown): value is DeployStageSelection {
  return (
    value === "release" ||
    (typeof value === "string" && (DEPLOY_RELEASE_STAGES as readonly string[]).includes(value))
  );
}

/**
 * Readiness problems every stage tolerates in the module clone: a release leaves it with
 * changes, and on a branch whose upstream is not there yet, and verify_module puts it back to
 * main as origin has it before anything else.
 */
function toleratedInModule(problem: DeployProblem): boolean {
  return (
    "repo" in problem &&
    problem.repo === "module" &&
    (problem.code === "clone_dirty" ||
      problem.code === "clone_ahead" ||
      problem.code === "clone_unknown")
  );
}

/** The readiness problems that keep a stage from starting. */
export function startProblems(context: DeployContext): DeployProblem[] {
  return context.problems.filter((problem) => !toleratedInModule(problem));
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
  const index = DEPLOY_RELEASE_STAGES.indexOf(stage);
  if (index > 0) {
    const previous = DEPLOY_RELEASE_STAGES[index - 1]!;
    if (statuses[previous] !== "done") return { code: "previous_stage", stage: previous };
    if (ONCE_PER_PREVIOUS.has(stage) && (statuses[stage] ?? "pending") !== "pending")
      return { code: "previous_rerun", stage: previous };
  }
  return null;
}
