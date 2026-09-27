/**
 * The QA deploy's six stages, each run against fakes: git and Jenkins answer from memory, the
 * clock waits no time, and the activity-data and media clones and the draft are temp dirs.
 * No test here runs git or makes a request, and nothing is written outside the temp dirs.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DeployGitResult } from "../src/activities/deploy-git.js";
import type { DeployJenkins, JenkinsBuildStatus } from "../src/activities/deploy-jenkins.js";
import { moduleContentHash } from "../src/activities/deploy-service.js";
import { defaultDeploySettings } from "../src/activities/deploy-settings.js";
import {
  DEPLOY_STAGE_DEFINITIONS,
  DeployStageFailure,
  activityDeployParams,
  qaActivityUrl,
  qaStages,
  releaseCurrent,
  stagesFor,
  type DeployActivitySnapshot,
  type DeployStageContext,
} from "../src/activities/deploy-stages.js";
import type { DeployStage } from "../src/activities/deploy-types.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

async function tempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A git that answers the QA stages' commands; `tracked` is what the media repository holds. */
function fakeGit(options: { tracked?: string[]; remoteBranch?: boolean; staged?: boolean } = {}) {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  const ok = (stdout = ""): DeployGitResult => ({ code: 0, stdout, stderr: "" });
  return {
    calls,
    git: {
      async run(args: string[], cwd: string): Promise<DeployGitResult> {
        calls.push({ args, cwd });
        const joined = args.join(" ");
        if (args[0] === "rev-parse" && args[1] === "--verify") {
          const ref = args[3]!;
          if (ref === "refs/remotes/origin/main") return ok("abc\n");
          if (ref.startsWith("refs/remotes/origin/loom/"))
            return options.remoteBranch ? ok("def\n") : { code: 1, stdout: "", stderr: "" };
          return { code: 1, stdout: "", stderr: "" };
        }
        if (joined === "rev-parse HEAD") return ok("feedface\n");
        if (joined === "diff --cached --quiet")
          return options.staged === false ? ok() : { code: 1, stdout: "", stderr: "" };
        if (joined === "sparse-checkout list") return ok("media/loom/words\n");
        if (args[0] === "ls-tree") {
          const reference = args[args.length - 1]!;
          return ok((options.tracked ?? []).includes(reference) ? `${reference}\n` : "");
        }
        return ok();
      },
    },
  };
}

function fakeJenkins(statuses: JenkinsBuildStatus[] = [{ state: "unknown" }]) {
  const triggers: Array<{ job: string; params: Record<string, string> }> = [];
  const polls: Array<{ params: Record<string, string>; after: number | null | undefined }> = [];
  const jenkins: DeployJenkins = {
    async trigger(job, params) {
      triggers.push({ job, params });
      return { queueUrl: null };
    },
    async status(_job, params, options) {
      polls.push({ params, after: options?.after });
      return statuses.length > 1 ? statuses.shift()! : statuses[0]!;
    },
  };
  return { triggers, polls, jenkins };
}

function fakeClock() {
  let now = Date.UTC(2026, 8, 28, 12, 0, 0);
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

function snapshot(draftMediaRoots: string[]): DeployActivitySnapshot {
  return {
    title: "Words",
    layout: "mainOnly",
    theme: null,
    contentRevision: "rev-42",
    draftMediaRoots,
    refs: [
      {
        refNum: 1,
        displayName: "First",
        configuration: { words: { "en-US": { edited: true } } },
        assessment: null,
        usesAssessment: false,
        assets: [{ key: "hello", type: "audio", path: "media/loom/words/hello.mp3" }],
      },
    ],
  };
}

async function setup(
  overrides: Partial<DeployStageContext> = {},
  gitOptions: Parameters<typeof fakeGit>[0] = {},
) {
  const activityData = await tempDir("penguin-qa-data-");
  const media = await tempDir("penguin-qa-media-");
  const draft = await tempDir("penguin-qa-draft-");
  const git = fakeGit(gitOptions);
  const jenkins = fakeJenkins();
  const clock = fakeClock();
  const lines: string[] = [];
  const settings = defaultDeploySettings();
  settings.git = { userName: "Deploy Bot", userEmail: "deploy@example.org" };
  settings.timeouts.deployMinutes = 1;
  const ctx: DeployStageContext = {
    git: git.git,
    jenkins: jenkins.jenkins,
    process: { run: async () => ({ code: 0, tail: "" }) },
    clock: clock.clock,
    settings,
    productCode: "words",
    module: { folder: "waf-module-words", dir: await tempDir("penguin-qa-module-"), source: null },
    moduleVersion: null,
    metadata: {},
    earlier: { await_module_build: { resolvedModuleVersion: "1.5.0" } },
    log: (text) => lines.push(text),
    signal: new AbortController().signal,
    qa: {
      activityData: { dir: activityData },
      media: { dir: media },
      refNum: 1,
      target: {
        tier: "qa",
        environment: "loom",
        frameworkVersion: "4.2.1",
        activityBaseUrl: "https://qa.example.org/play",
      },
      snapshot: async () => snapshot([draft]),
    },
    ...overrides,
  };
  return { ctx, git, jenkins, clock, lines, activityData, media, draft };
}

const run = (stage: DeployStage, ctx: DeployStageContext) =>
  DEPLOY_STAGE_DEFINITIONS[stage].run(ctx);

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(DeployStageFailure);
  return (error as DeployStageFailure).error;
}

describe("QA stage sequencing", () => {
  it("runs all ten stages unless the release is current for the same module", () => {
    expect(stagesFor("qa")).toHaveLength(10);
    const done = { status: "done" as const, metadata: {} };
    const stored = {
      verify_module: { status: "done" as const, metadata: { moduleContentHash: "h1" } },
      prepare_deploy: done,
      trigger_module_build: done,
      await_module_build: { status: "done" as const, metadata: { resolvedModuleVersion: "1.5.0" } },
    };
    expect(releaseCurrent(stored, "h1")).toBe(true);
    expect(releaseCurrent(stored, "h2")).toBe(false);
    expect(releaseCurrent(stored, null)).toBe(false);
    expect(
      releaseCurrent(
        { ...stored, trigger_module_build: { status: "pending", metadata: {} } },
        "h1",
      ),
    ).toBe(false);
    expect(qaStages(true)).toEqual([
      "export_activity_data",
      "verify_activity_data",
      "verify_media_assets",
      "publish_activity_data",
      "trigger_activity_deploy",
      "await_activity_deploy",
    ]);
    expect(qaStages(false)[0]).toBe("verify_module");
  });
});

describe("moduleContentHash", () => {
  it("changes with the module's content and build configuration, not with its build output", async () => {
    const root = await tempDir("penguin-qa-hash-");
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "index.ts"), "export {};");
    await fs.writeFile(path.join(root, "package.json"), "{}");
    await fs.writeFile(path.join(root, "webpack.config.cjs"), "module.exports = {};");
    const first = await moduleContentHash(root);
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    await fs.writeFile(path.join(root, "dist", "main.js"), "built");
    expect(await moduleContentHash(root)).toBe(first);
    await fs.writeFile(path.join(root, "webpack.config.cjs"), "module.exports = { mode: 1 };");
    const second = await moduleContentHash(root);
    expect(second).not.toBe(first);
    await fs.writeFile(path.join(root, "tsconfig.build.json"), "{}");
    expect(await moduleContentHash(root)).not.toBe(second);
  });
});

describe("export_activity_data", () => {
  it("puts the clone on the product's branch and writes the data for the released version", async () => {
    const { ctx, git, activityData } = await setup();
    await run("export_activity_data", ctx);
    const commands = git.calls.map((call) => call.args.join(" "));
    expect(commands).toContain("checkout -f -B loom/words-activity-data origin/main");
    for (const call of git.calls) expect(call.cwd).toBe(activityData);
    const template = JSON.parse(
      await fs.readFile(path.join(activityData, "data/templates/loom/words.json"), "utf8"),
    );
    expect(template.layout.compartments.main.module).toBe("words@^1.5.0");
    const configuration = JSON.parse(
      await fs.readFile(path.join(activityData, "data/configurations/loom/words-1.json"), "utf8"),
    );
    expect(configuration.words["en-US"]).toEqual({
      edited: true,
      hello: "{{MEDIA}}/loom/words/hello.mp3",
    });
    expect(ctx.metadata).toMatchObject({
      resolvedModuleVersion: "1.5.0",
      deployedRefNums: [1],
      exportedRevision: "rev-42",
      exportedFiles: [
        "data/configurations/loom/words-1.json",
        "data/templates/loom/words.json",
        "deployLists/loom-words.txt",
      ],
    });
  });

  it("follows the branch origin already has, and needs a released version", async () => {
    const { ctx, git } = await setup({}, { remoteBranch: true });
    await run("export_activity_data", ctx);
    expect(git.calls.map((call) => call.args.join(" "))).toContain(
      "checkout -f -B loom/words-activity-data origin/loom/words-activity-data",
    );
    const none = await setup({ earlier: {} });
    expect(await failure(run("export_activity_data", none.ctx))).toEqual({
      code: "missing_input",
      stage: "await_module_build",
    });
  });
});

describe("verify_activity_data and verify_media_assets", () => {
  it("passes exported data, and fails naming the media found nowhere", async () => {
    const { ctx, lines } = await setup();
    await run("export_activity_data", ctx);
    await run("verify_activity_data", ctx);
    expect(ctx.metadata.preflight?.errors).toEqual([]);
    expect(ctx.metadata.preflight?.counts.media).toBe(1);
    expect(await failure(run("verify_media_assets", ctx))).toEqual({
      code: "media_missing",
      paths: ["media/loom/words/hello.mp3"],
      count: 1,
    });
    expect(lines).toContain("Missing: media/loom/words/hello.mp3");
  });

  it("fails the check when the data names another module", async () => {
    const { ctx } = await setup();
    await run("export_activity_data", ctx);
    ctx.metadata.resolvedModuleVersion = "1.6.0";
    expect(await failure(run("verify_activity_data", ctx))).toEqual({
      code: "preflight_failed",
      errors: 1,
    });
    expect(ctx.metadata.preflight?.errors[0]).toMatchObject({ code: "layout_module_mismatch" });
  });

  it("copies a file only the draft holds into the media clone, commits and pushes main", async () => {
    const { ctx, git, media, draft } = await setup();
    await fs.mkdir(path.join(draft, "loom", "words"), { recursive: true });
    await fs.writeFile(path.join(draft, "loom", "words", "hello.mp3"), "hello");
    await run("export_activity_data", ctx);
    await run("verify_media_assets", ctx);
    expect(await fs.readFile(path.join(media, "media/loom/words/hello.mp3"), "utf8")).toBe("hello");
    const commands = git.calls
      .filter((call) => call.cwd === media)
      .map((call) => call.args.join(" "));
    expect(commands).toEqual(
      expect.arrayContaining([
        "checkout -f main",
        "reset --hard origin/main",
        "add -- media/loom/words/hello.mp3",
        "-c user.name=Deploy Bot -c user.email=deploy@example.org commit -m Publish media for words",
        "push origin main",
      ]),
    );
    expect(ctx.metadata).toMatchObject({
      mediaChecked: 1,
      mediaCopied: ["media/loom/words/hello.mp3"],
      mediaCopiedCount: 1,
      mediaCommit: "feedface",
    });
  });

  it("stages several hundred copied files in batches the command line can hold", async () => {
    const count = 450;
    const paths = Array.from(
      { length: count },
      (_, i) =>
        `media/loom/words/audios/english/scene-${i}-an-audio-file-with-a-long-name-${i}.mp3`,
    );
    const { ctx, git, media, draft } = await setup();
    const many = snapshot([draft]);
    many.refs[0]!.assets = paths.map((file, i) => ({ key: `clip${i}`, type: "audio", path: file }));
    ctx.qa!.snapshot = async () => many;
    for (const file of paths) {
      const target = path.join(draft, file.slice("media/".length));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, "clip");
    }
    await run("export_activity_data", ctx);
    await run("verify_media_assets", ctx);
    const adds = git.calls.filter((call) => call.cwd === media && call.args[0] === "add");
    expect(adds.length).toBeGreaterThan(1);
    for (const add of adds) expect(add.args.join(" ").length).toBeLessThan(10_000);
    expect(adds.flatMap((add) => add.args.slice(2)).sort()).toEqual([...paths].sort());
    expect(ctx.metadata.mediaCopiedCount).toBe(count);
  });

  it("pushes nothing when the repository already has every file", async () => {
    const { ctx, git, media } = await setup({}, { tracked: ["media/loom/words/hello.mp3"] });
    await run("export_activity_data", ctx);
    await run("verify_media_assets", ctx);
    const commands = git.calls
      .filter((call) => call.cwd === media)
      .map((call) => call.args.join(" "));
    expect(commands.some((command) => command.startsWith("push"))).toBe(false);
    expect(ctx.metadata.mediaCopiedCount).toBe(0);
  });
});

describe("publish_activity_data", () => {
  it("commits the exported files and pushes the branch", async () => {
    const { ctx, git, activityData } = await setup();
    await run("export_activity_data", ctx);
    git.calls.length = 0;
    await run("publish_activity_data", ctx);
    expect(git.calls.map((call) => call.args.join(" "))).toEqual([
      "add --all -- data/configurations/loom/words-1.json data/templates/loom/words.json deployLists/loom-words.txt",
      "diff --cached --quiet",
      "-c user.name=Deploy Bot -c user.email=deploy@example.org commit -m Deploy activity data for words (words@^1.5.0)",
      "rev-parse HEAD",
      "push -u origin loom/words-activity-data",
    ]);
    for (const call of git.calls) expect(call.cwd).toBe(activityData);
    expect(ctx.metadata.activityDataCommit).toBe("feedface");
  });

  it("needs an export to publish", async () => {
    const { ctx } = await setup();
    expect(await failure(run("publish_activity_data", ctx))).toEqual({
      code: "missing_input",
      stage: "export_activity_data",
    });
  });
});

describe("trigger_activity_deploy and await_activity_deploy", () => {
  it("starts the deploy job with the activity deploy parameters and records the QA address", async () => {
    const { ctx, jenkins } = await setup();
    await run("trigger_activity_deploy", ctx);
    expect(jenkins.triggers).toEqual([
      {
        job: "WAF Activity Deploy",
        params: {
          branch: "loom/words-activity-data",
          framework_version: "4.2.1",
          tier: "qa",
          deploy_environment: "loom",
          add_activities_to_catalog: "false",
          template_names: "words",
        },
      },
    ]);
    expect(jenkins.polls[0]!.params).toEqual({
      branch: "loom/words-activity-data",
      tier: "qa",
      deploy_environment: "loom",
      template_names: "words",
    });
    expect(ctx.metadata).toMatchObject({
      preDeployNumber: null,
      qaFrameworkVersion: "4.2.1",
      qaActivityUrl:
        "https://qa.example.org/play?productCode=words&refNum=1&frameworkVersion=4.2.1",
    });
    expect(qaActivityUrl("https://qa.example.org", "a b", 2, "4")).toBe(
      "https://qa.example.org?productCode=a+b&refNum=2&frameworkVersion=4",
    );
    expect(activityDeployParams("words", ctx.qa!.target).template_names).toBe("words");
  });

  it("waits for the deploy build it started, then records when and what went to QA", async () => {
    const { ctx, jenkins, clock } = await setup({
      earlier: {
        export_activity_data: { exportedRevision: "rev-41" },
        trigger_activity_deploy: {
          preDeployNumber: 6,
          qaActivityUrl: "https://qa.example.org/play?productCode=words",
          qaFrameworkVersion: "4.2.1",
        },
      },
    });
    jenkins.polls.length = 0;
    const statuses: JenkinsBuildStatus[] = [
      { state: "queued" },
      { state: "building", number: 7, url: "https://jenkins.example.org/job/d/7/" },
      { state: "succeeded", number: 7, url: "https://jenkins.example.org/job/d/7/" },
    ];
    ctx.jenkins = fakeJenkins(statuses).jenkins;
    await run("await_activity_deploy", ctx);
    expect(clock.sleeps).toEqual([15_000, 15_000]);
    expect(ctx.metadata).toMatchObject({
      preDeployNumber: 6,
      activityDeployUrl: "https://jenkins.example.org/job/d/7/",
      qaActivityUrl: "https://qa.example.org/play?productCode=words",
      qaDeployedAt: "2026-09-28T12:00:30.000Z",
      contentRevision: "rev-41",
    });
  });

  it("fails a deploy that fails or runs past its minutes, and one never started", async () => {
    const failed = await setup({ earlier: { trigger_activity_deploy: { preDeployNumber: null } } });
    failed.ctx.jenkins = fakeJenkins([{ state: "failed", result: "FAILURE", url: "u" }]).jenkins;
    expect(await failure(run("await_activity_deploy", failed.ctx))).toEqual({
      code: "build_failed",
      result: "FAILURE",
      url: "u",
    });
    const slow = await setup({ earlier: { trigger_activity_deploy: { preDeployNumber: null } } });
    slow.ctx.jenkins = fakeJenkins([{ state: "building" }]).jenkins;
    expect(await failure(run("await_activity_deploy", slow.ctx))).toEqual({
      code: "deploy_timed_out",
      minutes: 1,
    });
    const never = await setup();
    expect(await failure(run("await_activity_deploy", never.ctx))).toEqual({
      code: "missing_input",
      stage: "trigger_activity_deploy",
    });
  });
});
