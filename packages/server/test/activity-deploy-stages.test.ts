/**
 * The module release's four stages, each run on its own against fakes: git, npm, Jenkins and
 * the clock answer from memory, and the module clone is a temp directory. No test here runs
 * git, npm or a request, and nothing is written outside the temp directory.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { spawnGit, type DeployGitResult } from "../src/activities/deploy-git.js";
import type { DeployJenkins, JenkinsBuildStatus } from "../src/activities/deploy-jenkins.js";
import { JenkinsError } from "../src/activities/deploy-jenkins.js";
import type { DeployProcessResult } from "../src/activities/deploy-process.js";
import { defaultDeploySettings } from "../src/activities/deploy-settings.js";
import {
  DEPLOY_STAGE_DEFINITIONS,
  DeployStageFailure,
  DeployStopped,
  isModuleVersion,
  latestSemver,
  moduleBuildLine,
  modulePackageName,
  stageBlocker,
  type DeployStageContext,
} from "../src/activities/deploy-stages.js";
import type { DeployContext, DeployStage } from "../src/activities/deploy-types.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

async function tempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A git that answers from a script: tags, the remote's branches, whether anything is staged. */
function fakeGit(
  state: {
    tags?: string[][];
    remoteMain?: boolean;
    staged?: boolean;
    fail?: string;
    /** What git says when `fail` matches; a refusal naming the command by default. */
    failWith?: string;
    /** The working tree has authored work in it. */
    dirty?: boolean;
    /** Whether main exists locally, and as origin/main. */
    localMain?: boolean;
    originMain?: boolean;
  } = {},
) {
  const calls: string[][] = [];
  let tagRead = 0;
  const ok = (stdout = ""): DeployGitResult => ({ code: 0, stdout, stderr: "" });
  return {
    calls,
    git: {
      async run(args: string[]): Promise<DeployGitResult> {
        calls.push(args);
        const joined = args.join(" ");
        if (state.fail && joined.startsWith(state.fail))
          return { code: 1, stdout: "", stderr: state.failWith ?? `fatal: ${state.fail} refused` };
        if (args[0] === "tag") {
          const lists = state.tags ?? [[]];
          const list = lists[Math.min(tagRead, lists.length - 1)]!;
          tagRead++;
          return ok(list.join("\n"));
        }
        if (args[0] === "ls-remote")
          return ok(state.remoteMain === false ? "" : "abc\trefs/heads/main\n");
        if (joined === "diff --cached --quiet")
          return state.staged === false ? ok() : { code: 1, stdout: "", stderr: "" };
        if (joined === "rev-parse HEAD") return ok("0123abcd\n");
        if (joined === "status --porcelain") return ok(state.dirty ? "?? src/new.js\n" : "");
        if (joined === "rev-parse --verify --quiet refs/heads/main" && state.localMain === false)
          return { code: 1, stdout: "", stderr: "" };
        if (
          joined === "rev-parse --verify --quiet refs/remotes/origin/main" &&
          state.originMain === false
        )
          return { code: 1, stdout: "", stderr: "" };
        return ok();
      },
    },
  };
}

function fakeProcess(
  answer: (line: string) => Partial<DeployProcessResult> & { output?: string } = () => ({}),
) {
  const calls: { line: string; cwd: string }[] = [];
  return {
    calls,
    process: {
      async run(
        command: string,
        args: string[],
        options: { cwd: string; onOutput?: (text: string) => void },
      ): Promise<DeployProcessResult> {
        const line = `${command} ${args.join(" ")}`;
        calls.push({ line, cwd: options.cwd });
        const reply = answer(line);
        const output = reply.output ?? `${line} ok\n`;
        options.onOutput?.(output);
        return {
          code: reply.code ?? 0,
          tail: output,
          ...(reply.error ? { error: reply.error } : {}),
        };
      },
    },
  };
}

function fakeJenkins(statuses: Array<JenkinsBuildStatus | Error> = [{ state: "unknown" }]) {
  const triggers: Array<{ job: string; params: Record<string, string> }> = [];
  const polls: Array<{ after: number | null | undefined; skipQueue?: boolean }> = [];
  const jenkins: DeployJenkins = {
    async trigger(job, params) {
      triggers.push({ job, params });
      return { queueUrl: "https://jenkins.example.org/queue/item/7/" };
    },
    async status(_job, _params, options) {
      polls.push({ after: options?.after, ...(options?.skipQueue ? { skipQueue: true } : {}) });
      const next = statuses.length > 1 ? statuses.shift()! : statuses[0]!;
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { triggers, polls, jenkins };
}

function fakeClock() {
  let now = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    clock: {
      now: () => now,
      async sleep(ms: number) {
        sleeps.push(ms);
        now += ms;
      },
    },
  };
}

async function moduleClone() {
  const dir = await tempDir("penguin-deploy-module-");
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "waf-module-words", version: "1.0.0" }, null, 2),
  );
  return dir;
}

function settings() {
  const value = defaultDeploySettings();
  value.git = { userName: "Deploy Bot", userEmail: "deploy@example.org" };
  value.timeouts.buildMinutes = 1;
  return value;
}

function context(
  overrides: Partial<DeployStageContext> & { dir: string; source?: string | null },
): { ctx: DeployStageContext; lines: string[]; controller: AbortController } {
  const lines: string[] = [];
  const controller = new AbortController();
  const { dir, source, ...rest } = overrides;
  return {
    lines,
    controller,
    ctx: {
      git: fakeGit().git,
      jenkins: fakeJenkins().jenkins,
      process: fakeProcess().process,
      clock: fakeClock().clock,
      settings: settings(),
      productCode: "words",
      module: { folder: "waf-module-words", dir, source: source ?? null },
      moduleVersion: null,
      metadata: {},
      earlier: {},
      log: (text) => lines.push(text),
      signal: controller.signal,
      ...rest,
    },
  };
}

const run = (stage: DeployStage, ctx: DeployStageContext) =>
  DEPLOY_STAGE_DEFINITIONS[stage].run(ctx);

describe("deploy names and versions", () => {
  it("names the package, the build line and the newest plain release tag", () => {
    expect(modulePackageName("waf-module-Words")).toBe("wafmodule-words");
    expect(moduleBuildLine("waf-module-words")).toBe("words loom/words-deploy");
    expect(latestSemver(["v1.2.0", "1.10.0", "1.11.0-beta.1", "release", "1.9.9"])).toBe("1.10.0");
    expect(latestSemver(["main"])).toBeNull();
    expect(isModuleVersion("2.0.1")).toBe(true);
    for (const bad of ["v2.0.1", "2.0", "02.0.1", "2.0.1-rc.1"])
      expect(isModuleVersion(bad)).toBe(false);
  });
});

describe("verify_module", () => {
  it("copies the assembled module over the clone and runs the four npm checks in order", async () => {
    const dir = await moduleClone();
    const source = await tempDir("penguin-deploy-source-");
    await fs.mkdir(path.join(source, "src"), { recursive: true });
    await fs.writeFile(path.join(source, "src", "index.js"), "export {};");
    await fs.writeFile(path.join(source, "package.json"), '{"name":"built"}');
    await fs.mkdir(path.join(source, "node_modules", "left"), { recursive: true });
    await fs.writeFile(path.join(source, "node_modules", "left", "x.js"), "");
    const git = fakeGit();
    const npm = fakeProcess();
    const { ctx, lines } = context({ dir, source, git: git.git, process: npm.process });
    await run("verify_module", ctx);
    expect(await fs.readFile(path.join(dir, "src", "index.js"), "utf8")).toBe("export {};");
    expect(await fs.readFile(path.join(dir, "package.json"), "utf8")).toBe('{"name":"built"}');
    await expect(fs.stat(path.join(dir, "node_modules"))).rejects.toThrow();
    expect(npm.calls.map((call) => call.line)).toEqual([
      "npm ci",
      "npm run buildDebug",
      "npm run lint",
      "npm run buildRelease",
    ]);
    expect(npm.calls.every((call) => call.cwd === dir)).toBe(true);
    // Main is brought up to origin, never reset, and the copied module is committed on it.
    expect(git.calls).toEqual([
      ["fetch", "origin"],
      ["status", "--porcelain"],
      ["rev-parse", "--verify", "--quiet", "refs/heads/main"],
      ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main"],
      ["checkout", "main"],
      ["merge", "--ff-only", "origin/main"],
      ["add", "--all"],
      ["diff", "--cached", "--quiet"],
      [
        "-c",
        "user.name=Deploy Bot",
        "-c",
        "user.email=deploy@example.org",
        "commit",
        "-m",
        "Penguin Harness: words as authored",
      ],
      ["rev-parse", "HEAD"],
    ]);
    expect(git.calls.some((call) => ["reset", "clean"].includes(call[0]!))).toBe(false);
    expect(lines).toContain("Committed the authored module on main: 0123abcd.");
    expect(lines).toContain("$ npm run lint");
  });

  it("carries authored work in the clone onto main and commits it, rather than dropping it", async () => {
    const dir = await moduleClone();
    await fs.writeFile(path.join(dir, "authored.js"), "export const kept = true;");
    const git = fakeGit({ dirty: true, localMain: false });
    const { ctx } = context({ dir, git: git.git });
    await run("verify_module", ctx);
    // The work is set aside, main is made from origin's, and the work is put back on it.
    expect(git.calls.slice(0, 8)).toEqual([
      ["fetch", "origin"],
      ["status", "--porcelain"],
      ["stash", "push", "--include-untracked", "-m", "penguin-harness deploy"],
      ["rev-parse", "--verify", "--quiet", "refs/heads/main"],
      ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main"],
      ["checkout", "-b", "main", "origin/main"],
      ["merge", "--ff-only", "origin/main"],
      ["stash", "pop"],
    ]);
    expect(git.calls[8]).toEqual(["add", "--all"]);
    expect(await fs.readFile(path.join(dir, "authored.js"), "utf8")).toBe(
      "export const kept = true;",
    );
  });

  it("starts main where a new module's clone is when neither it nor origin has one", async () => {
    const dir = await moduleClone();
    const git = fakeGit({ localMain: false, originMain: false, staged: false });
    const { ctx, lines } = context({ dir, git: git.git });
    await run("verify_module", ctx);
    expect(git.calls).toContainEqual(["checkout", "-B", "main"]);
    expect(git.calls.some((call) => call[0] === "merge")).toBe(false);
    expect(git.calls.some((call) => call.includes("commit"))).toBe(false);
    expect(lines).toContain("Main already had everything authored.");
  });

  it("commits a new module's first work, which git cannot stash before a first commit", async () => {
    const dir = await moduleClone();
    await fs.writeFile(path.join(dir, "authored.js"), "export const kept = true;");
    const git = fakeGit({
      dirty: true,
      localMain: false,
      originMain: false,
      fail: "stash push",
      failWith: "You do not have the initial commit yet",
    });
    const { ctx, lines } = context({ dir, git: git.git });
    await run("verify_module", ctx);
    expect(git.calls).toContainEqual(["symbolic-ref", "HEAD", "refs/heads/main"]);
    expect(git.calls.some((call) => call[0] === "checkout" || call[0] === "reset")).toBe(false);
    expect(git.calls.some((call) => call.join(" ") === "stash pop")).toBe(false);
    expect(git.calls).toContainEqual(["add", "--all"]);
    expect(lines).toContain("No commit yet: the new module's work stays in place.");
    expect(await fs.readFile(path.join(dir, "authored.js"), "utf8")).toBe(
      "export const kept = true;",
    );
  });

  it("names the repository to create when a new module's has not been made", async () => {
    const dir = await moduleClone();
    const git = fakeGit({ fail: "fetch origin", failWith: "ERROR: Repository not found." });
    const { ctx } = context({ dir, git: git.git });
    const failure = await run("verify_module", ctx).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(DeployStageFailure);
    expect((failure as DeployStageFailure).error.code).toBe("module_repository_missing");
    expect(git.calls.some((call) => call[0] === "add")).toBe(false);
  });

  it("fails on a failing lint with the end of its output, and runs nothing after it", async () => {
    const dir = await moduleClone();
    const npm = fakeProcess((line) =>
      line === "npm run lint" ? { code: 1, output: "src/a.js\n  3:1  error  no-undef\n" } : {},
    );
    const { ctx, lines } = context({ dir, process: npm.process });
    const failure = await run("verify_module", ctx).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(DeployStageFailure);
    expect((failure as DeployStageFailure).error).toEqual({
      code: "command_failed",
      command: "npm run lint",
      exitCode: 1,
      output: "src/a.js\n  3:1  error  no-undef",
    });
    expect(npm.calls.map((call) => call.line)).not.toContain("npm run buildRelease");
    expect(lines).toContain("  3:1  error  no-undef");
  });

  it("says npm is missing rather than failing on an exit code", async () => {
    const dir = await moduleClone();
    const npm = fakeProcess(() => ({ code: null, error: "not_found" }));
    const { ctx } = context({ dir, process: npm.process });
    await expect(run("verify_module", ctx)).rejects.toMatchObject({
      error: { code: "command_missing", command: "npm" },
    });
  });
});

describe("prepare_deploy", () => {
  it("makes the deploy branch from main, writes the package, compiles the stylesheet and commits", async () => {
    const dir = await moduleClone();
    await fs.writeFile(
      path.join(dir, "package-lock.json"),
      JSON.stringify({
        name: "old",
        version: "1.0.0",
        packages: { "": { name: "old", version: "1.0.0" } },
      }),
    );
    await fs.mkdir(path.join(dir, "res"));
    await fs.writeFile(path.join(dir, "res", "style.scss"), "a { b: c }");
    const git = fakeGit();
    const npx = fakeProcess();
    const { ctx } = context({ dir, git: git.git, process: npx.process, moduleVersion: "2.3.4" });
    await run("prepare_deploy", ctx);
    expect(git.calls[0]).toEqual(["checkout", "-B", "loom/words-deploy", "main"]);
    const pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8"));
    expect(pkg).toEqual({ name: "wafmodule-words", version: "2.3.4" });
    const lock = JSON.parse(await fs.readFile(path.join(dir, "package-lock.json"), "utf8"));
    expect(lock).toEqual({
      name: "wafmodule-words",
      version: "2.3.4",
      packages: { "": { name: "wafmodule-words", version: "2.3.4" } },
    });
    expect(npx.calls.map((call) => call.line)).toEqual([
      "npx --yes -p sass@1.54.0 sass res/style.scss res/style.css --no-source-map",
    ]);
    expect(git.calls).toContainEqual([
      "-c",
      "user.name=Deploy Bot",
      "-c",
      "user.email=deploy@example.org",
      "commit",
      "-m",
      "Prepare module deploy for words",
    ]);
    expect(ctx.metadata).toEqual({ moduleVersion: "2.3.4", commit: "0123abcd" });
  });

  it("keeps the version, skips a missing stylesheet and commits nothing when nothing changed", async () => {
    const dir = await moduleClone();
    const git = fakeGit({ staged: false });
    const npx = fakeProcess();
    const { ctx } = context({ dir, git: git.git, process: npx.process });
    await run("prepare_deploy", ctx);
    expect(npx.calls).toEqual([]);
    expect(git.calls.some((args) => args.includes("commit"))).toBe(false);
    expect(ctx.metadata).toEqual({ moduleVersion: "1.0.0" });
  });
});

describe("trigger_module_build", () => {
  it("notes the newest tag and build, pushes main when absent, pushes the branch and starts the job", async () => {
    const dir = await moduleClone();
    const git = fakeGit({ tags: [["v1.2.0", "1.10.0-beta", "1.1.9"]], remoteMain: false });
    const jenkins = fakeJenkins([{ state: "succeeded", number: 41 }]);
    const { ctx } = context({ dir, git: git.git, jenkins: jenkins.jenkins });
    await run("trigger_module_build", ctx);
    expect(ctx.metadata).toEqual({ preBuildTag: "1.2.0", preBuildNumber: 41 });
    // A queued build has no number; the floor is the newest build Jenkins has.
    expect(jenkins.polls).toEqual([{ after: undefined, skipQueue: true }]);
    expect(git.calls).toContainEqual(["fetch", "--tags", "origin"]);
    const pushes = git.calls.filter((args) => args[0] === "push");
    expect(pushes).toEqual([
      ["push", "origin", "main"],
      ["push", "--force-with-lease", "-u", "origin", "loom/words-deploy"],
    ]);
    expect(jenkins.triggers).toEqual([
      { job: "Build WAF Modules", params: { Modules: "words loom/words-deploy" } },
    ]);
  });

  it("leaves main alone when the remote has it, and stops at a refused push", async () => {
    const dir = await moduleClone();
    const git = fakeGit({ fail: "push --force-with-lease" });
    const jenkins = fakeJenkins();
    const { ctx } = context({ dir, git: git.git, jenkins: jenkins.jenkins });
    await expect(run("trigger_module_build", ctx)).rejects.toMatchObject({
      error: {
        code: "command_failed",
        command: "git push --force-with-lease -u origin loom/words-deploy",
      },
    });
    expect(git.calls.some((args) => args.join(" ") === "push origin main")).toBe(false);
    expect(jenkins.triggers).toEqual([]);
  });

  it("names Jenkins's status when it refuses the build", async () => {
    const dir = await moduleClone();
    const jenkins = fakeJenkins();
    jenkins.jenkins.trigger = async () => {
      throw new JenkinsError(401);
    };
    const { ctx } = context({ dir, jenkins: jenkins.jenkins });
    await expect(run("trigger_module_build", ctx)).rejects.toMatchObject({
      error: { code: "jenkins_failed", status: 401 },
    });
  });
});

describe("await_module_build", () => {
  it("polls every 15 seconds until a newer tag appears, and records it", async () => {
    const dir = await moduleClone();
    const git = fakeGit({ tags: [["1.2.0"], ["1.2.0"], ["1.2.0", "1.3.0"]] });
    const jenkins = fakeJenkins([
      { state: "queued", url: "https://jenkins.example.org/queue/item/7/" },
      { state: "building", number: 42, url: "https://jenkins.example.org/job/x/42/" },
      { state: "succeeded", number: 42, url: "https://jenkins.example.org/job/x/42/" },
    ]);
    const time = fakeClock();
    const { ctx } = context({
      dir,
      git: git.git,
      jenkins: jenkins.jenkins,
      clock: time.clock,
      earlier: { trigger_module_build: { preBuildTag: "1.2.0", preBuildNumber: 41 } },
    });
    await run("await_module_build", ctx);
    expect(ctx.metadata.resolvedModuleVersion).toBe("1.3.0");
    expect(ctx.metadata.moduleBuildUrl).toBe("https://jenkins.example.org/job/x/42/");
    expect(time.sleeps).toEqual([15_000, 15_000]);
    expect(jenkins.polls.every((poll) => poll.after === 41)).toBe(true);
  });

  it("takes a first tag as new when the module had none", async () => {
    const dir = await moduleClone();
    const git = fakeGit({ tags: [["0.1.0"]] });
    const { ctx } = context({
      dir,
      git: git.git,
      metadata: { preBuildTag: null, preBuildNumber: null },
    });
    await run("await_module_build", ctx);
    expect(ctx.metadata.resolvedModuleVersion).toBe("0.1.0");
  });

  it("fails when the build fails, when it succeeds with no new tag, and when time runs out", async () => {
    const dir = await moduleClone();
    const earlier = { trigger_module_build: { preBuildTag: "1.2.0", preBuildNumber: null } };
    const failed = context({
      dir,
      git: fakeGit({ tags: [["1.2.0"]] }).git,
      jenkins: fakeJenkins([{ state: "failed", result: "FAILURE", url: "https://j/x/1/" }]).jenkins,
      earlier,
    });
    await expect(run("await_module_build", failed.ctx)).rejects.toMatchObject({
      error: { code: "build_failed", result: "FAILURE", url: "https://j/x/1/" },
    });
    const untagged = context({
      dir,
      git: fakeGit({ tags: [["1.2.0", "1.1.0"]] }).git,
      jenkins: fakeJenkins([{ state: "succeeded" }]).jenkins,
      earlier,
    });
    await expect(run("await_module_build", untagged.ctx)).rejects.toMatchObject({
      error: { code: "no_newer_tag", before: "1.2.0", after: "1.2.0" },
    });
    const time = fakeClock();
    const slow = context({
      dir,
      git: fakeGit({ tags: [["1.2.0"]] }).git,
      jenkins: fakeJenkins([{ state: "building" }]).jenkins,
      clock: time.clock,
      earlier,
    });
    await expect(run("await_module_build", slow.ctx)).rejects.toMatchObject({
      error: { code: "build_timed_out", minutes: 1 },
    });
    expect(time.sleeps).toHaveLength(4);
  });

  it("needs the trigger stage's note of the tag before the build", async () => {
    const dir = await moduleClone();
    const { ctx } = context({ dir });
    await expect(run("await_module_build", ctx)).rejects.toMatchObject({
      error: { code: "missing_input", stage: "trigger_module_build" },
    });
  });

  it("stops when the engineer presses Stop while it waits", async () => {
    const dir = await moduleClone();
    const holder: { controller?: AbortController } = {};
    const made = context({
      dir,
      git: fakeGit({ tags: [["1.2.0"]] }).git,
      jenkins: fakeJenkins([{ state: "building" }]).jenkins,
      earlier: { trigger_module_build: { preBuildTag: "1.2.0" } },
      clock: {
        now: () => 0,
        async sleep() {
          holder.controller!.abort();
        },
      },
    });
    holder.controller = made.controller;
    await expect(run("await_module_build", made.ctx)).rejects.toBeInstanceOf(DeployStopped);
  });
});

describe("Stop during git", () => {
  it("hands git the run's signal, so Stop ends a push that is still going", async () => {
    const dir = await moduleClone();
    const seen: Array<AbortSignal | undefined> = [];
    const made = context({
      dir,
      git: {
        run(args, _cwd, opts) {
          seen.push(opts?.signal);
          if (args[0] !== "push") return Promise.resolve({ code: 0, stdout: "", stderr: "" });
          // A push that only ends when its signal aborts, as spawnGit stops its child.
          return new Promise<DeployGitResult>((resolve) =>
            opts?.signal?.addEventListener("abort", () =>
              resolve({ code: null, stdout: "", stderr: "", error: "stopped" }),
            ),
          );
        },
      },
    });
    const pending = run("trigger_module_build", made.ctx);
    await new Promise((resolve) => setTimeout(resolve, 10));
    made.controller.abort();
    await expect(pending).rejects.toBeInstanceOf(DeployStopped);
    expect(seen.every((signal) => signal === made.controller.signal)).toBe(true);
  });

  it("stops the real git at once when the signal has already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await spawnGit.run(["--version"], os.tmpdir(), { signal: controller.signal });
    expect(result).toMatchObject({ code: null, error: "stopped" });
  });
});

describe("stage blockers", () => {
  const ready: DeployContext = {
    ready: true,
    problems: [],
    remoteChecked: false,
    module: {
      folder: "waf-module-words",
      remote: "git@github.com:org/waf-module-words.git",
      clone: { present: true, branch: "main", clean: true, ahead: 0, remoteUrlMatches: true },
    },
    activityData: {
      clone: { present: true, branch: "main", clean: true, ahead: 0, remoteUrlMatches: true },
    },
    media: {
      clone: { present: true, branch: "main", clean: true, ahead: 0, remoteUrlMatches: true },
    },
    branches: { deploy: "loom/words-deploy", activityData: "loom/words-activity-data" },
    branchState: {
      deploy: { local: null, remote: null },
      activityData: { local: null, remote: null },
    },
  };

  it("lets the first stage run on a ready deploy, and each later one after the one before", () => {
    expect(stageBlocker("verify_module", ready, {}, false)).toBeNull();
    expect(stageBlocker("trigger_module_build", ready, { verify_module: "done" }, false)).toEqual({
      code: "previous_stage",
      stage: "prepare_deploy",
    });
    expect(
      stageBlocker("trigger_module_build", ready, { prepare_deploy: "done" }, false),
    ).toBeNull();
    expect(stageBlocker("prepare_deploy", ready, { verify_module: "failed" }, false)).toEqual({
      code: "previous_stage",
      stage: "verify_module",
    });
    expect(stageBlocker("verify_module", ready, {}, true)).toEqual({ code: "run_active" });
  });

  it("runs prepare once per verify: its content is what verify left in the working tree", () => {
    for (const status of ["done", "failed", "cancelled"] as const)
      expect(
        stageBlocker(
          "prepare_deploy",
          ready,
          { verify_module: "done", prepare_deploy: status },
          false,
        ),
      ).toEqual({ code: "previous_rerun", stage: "verify_module" });
    expect(
      stageBlocker(
        "prepare_deploy",
        ready,
        { verify_module: "done", prepare_deploy: "pending" },
        false,
      ),
    ).toBeNull();
    // The stages after it may run again as often as needed.
    expect(
      stageBlocker(
        "trigger_module_build",
        ready,
        { prepare_deploy: "done", trigger_module_build: "failed" },
        false,
      ),
    ).toBeNull();
  });

  it("names the readiness problem, and lets every stage past the module clone's own changes", () => {
    const dirty: DeployContext = {
      ...ready,
      ready: false,
      problems: [
        { code: "clone_dirty", repo: "module" },
        { code: "clone_ahead", repo: "module", count: 1 },
        { code: "clone_unknown", repo: "module", what: "upstream" },
      ],
    };
    // A failed or stopped verify leaves its copied files behind; verify itself clears them.
    expect(stageBlocker("verify_module", dirty, { verify_module: "failed" }, false)).toBeNull();
    expect(stageBlocker("prepare_deploy", dirty, { verify_module: "done" }, false)).toBeNull();
    // The activity-data and media clones are put back as origin has them by the stages that
    // work in them, so what a failed export or media copy left there does not block either.
    const otherDirty: DeployContext = {
      ...ready,
      ready: false,
      problems: [
        { code: "clone_dirty", repo: "activityData" },
        { code: "clone_ahead", repo: "media", count: 2 },
      ],
    };
    expect(stageBlocker("verify_module", otherDirty, {}, false)).toBeNull();
    const otherRemote: DeployContext = {
      ...ready,
      ready: false,
      problems: [{ code: "clone_remote_mismatch", repo: "activityData" }],
    };
    expect(stageBlocker("verify_module", otherRemote, {}, false)).toEqual({
      code: "not_ready",
      problem: { code: "clone_remote_mismatch", repo: "activityData" },
    });
    const unset: DeployContext = {
      ...ready,
      ready: false,
      problems: [{ code: "settings_missing", field: "qa.token" }, { code: "not_canonical" }],
    };
    expect(stageBlocker("await_module_build", unset, {}, false)).toEqual({
      code: "settings_missing",
      field: "qa.token",
    });
    expect(
      stageBlocker(
        "verify_module",
        { ...ready, ready: false, problems: [{ code: "not_canonical" }] },
        {},
        false,
      ),
    ).toEqual({ code: "not_ready", problem: { code: "not_canonical" } });
  });
});
