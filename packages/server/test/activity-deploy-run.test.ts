/**
 * The deploy runner over a real web.db schema and fakes for everything outward: a release runs
 * its four stages in order and keeps what it found, one run at a time, Stop kills the running
 * program and cancels the run, a restart marks a running run interrupted, and the log is read
 * after a cursor. Nothing runs git, npm or a request.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/hmr/capabilities.js";
import { SCHEMA_SQL } from "../src/db/schema.js";
import type { DeployGitResult } from "../src/activities/deploy-git.js";
import type { DeployJenkins } from "../src/activities/deploy-jenkins.js";
import type { DeployProcess, DeployProcessResult } from "../src/activities/deploy-process.js";
import { defaultDeploySettings } from "../src/activities/deploy-settings.js";
import { qaStages, releaseCurrent } from "../src/activities/deploy-stages.js";
import {
  DeployRunner,
  dbDeployStore,
  logPage,
  type DeployStageBase,
} from "../src/activities/deploy-run.js";

const sqlite = process.getBuiltinModule("node:sqlite");
const PROJECT = "proj";
const ACTIVITY = "act_1";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function database(): DatabaseSync {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  // The runs' own bookkeeping is under test, not the project and activity rows they hang from.
  db.exec("PRAGMA foreign_keys = OFF");
  return db;
}

async function home() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-deploy-run-"));
  cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, "module"));
  await fs.writeFile(
    path.join(dir, "module", "package.json"),
    JSON.stringify({ name: "waf-module-words", version: "1.0.0" }),
  );
  return dir;
}

function gitWithTags(before: string[], after: string[]) {
  let reads = 0;
  return {
    async run(args: string[]): Promise<DeployGitResult> {
      if (args[0] === "tag")
        return { code: 0, stdout: (reads++ === 0 ? before : after).join("\n"), stderr: "" };
      if (args[0] === "ls-remote") return { code: 0, stdout: "abc\trefs/heads/main\n", stderr: "" };
      if (args.join(" ") === "rev-parse HEAD") return { code: 0, stdout: "feed\n", stderr: "" };
      if (args.join(" ") === "diff --cached --quiet") return { code: 1, stdout: "", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

const jenkins: DeployJenkins = {
  trigger: async () => ({ queueUrl: null }),
  status: async () => ({
    state: "succeeded",
    number: 7,
    url: "https://jenkins.example.org/job/x/7/",
  }),
};

const quickProcess: DeployProcess = {
  async run(command, args, options) {
    options.onOutput?.(`${command} ${args.join(" ")}: fine\n`);
    return { code: 0, tail: "" };
  },
};

/** A program that runs until Stop, and says whether it was killed. */
function hangingProcess() {
  const state = { started: 0, killed: 0 };
  const process: DeployProcess = {
    run(_command, _args, options) {
      state.started++;
      return new Promise<DeployProcessResult>((resolve) => {
        options.signal?.addEventListener("abort", () => {
          state.killed++;
          resolve({ code: null, tail: "", error: "stopped" });
        });
      });
    },
  };
  return { state, process };
}

function base(dir: string, overrides: Partial<DeployStageBase> = {}): DeployStageBase {
  const settings = defaultDeploySettings();
  settings.git = { userName: "Deploy", userEmail: "deploy@example.org" };
  return {
    git: gitWithTags(["1.0.0"], ["1.0.0", "1.1.0"]),
    jenkins,
    process: quickProcess,
    clock: { now: () => 0, sleep: async () => {} },
    settings,
    productCode: "words",
    module: { folder: "waf-module-words", dir: path.join(dir, "module"), source: null },
    moduleVersion: null,
    ...overrides,
  };
}

function runnerOn(db: DatabaseSync, dir: string) {
  return new DeployRunner({
    store: dbDeployStore(db as unknown as Db),
    logDir: path.join(dir, "logs"),
  });
}

async function settled(runner: DeployRunner) {
  await vi.waitFor(() => expect(runner.latest(PROJECT, ACTIVITY)?.status).not.toBe("running"));
  return runner.latest(PROJECT, ACTIVITY)!;
}

describe("deploy runner", () => {
  it("runs the release's four stages in order, records the version and keeps the stage states", async () => {
    const db = database();
    const dir = await home();
    const runner = runnerOn(db, dir);
    const started = runner.start({
      projectId: PROJECT,
      activityId: ACTIVITY,
      target: "qa",
      selection: "release",
      base: base(dir),
    });
    expect(started.stages.map((entry) => entry.stage)).toEqual([
      "verify_module",
      "prepare_deploy",
      "trigger_module_build",
      "await_module_build",
    ]);
    const run = await settled(runner);
    expect(run.status).toBe("succeeded");
    expect(run.stages.every((entry) => entry.status === "done")).toBe(true);
    expect(run.metadata).toMatchObject({
      preBuildTag: "1.0.0",
      preBuildNumber: 7,
      resolvedModuleVersion: "1.1.0",
      moduleBuildUrl: "https://jenkins.example.org/job/x/7/",
      commit: "feed",
    });
    // A new runner over the same database — a restart — sees the same stages and run.
    const again = runnerOn(db, dir);
    expect(again.latest(PROJECT, ACTIVITY)).toEqual(run);
    const stored = dbDeployStore(db as unknown as Db).stages(ACTIVITY);
    // The release's stages are done; the QA stages after them were set back to pending.
    expect(
      ["verify_module", "prepare_deploy", "trigger_module_build", "await_module_build"].map(
        (stage) => stored[stage as keyof typeof stored]?.status,
      ),
    ).toEqual(["done", "done", "done", "done"]);
    expect(stored.export_activity_data?.status).toBe("pending");
    expect(stored.await_module_build!.metadata.resolvedModuleVersion).toBe("1.1.0");
    expect(stored.await_module_build!.finishedAt).not.toBeNull();
  });

  it("leaves a current release out of a QA deploy and records the stages it left out", async () => {
    const db = database();
    const dir = await home();
    const runner = runnerOn(db, dir);
    const moduleBase = base(dir);
    moduleBase.module = { ...moduleBase.module, contentHash: "h1" };
    runner.start({
      projectId: PROJECT,
      activityId: ACTIVITY,
      target: "qa",
      selection: "release",
      base: moduleBase,
    });
    expect((await settled(runner)).status).toBe("succeeded");
    const stored = dbDeployStore(db as unknown as Db).stages(ACTIVITY);
    expect(stored.verify_module?.metadata.moduleContentHash).toBe("h1");
    expect(releaseCurrent(stored, "h1")).toBe(true);
    expect(releaseCurrent(stored, "h2")).toBe(false);

    const qa = runner.start({
      projectId: PROJECT,
      activityId: ACTIVITY,
      target: "qa",
      selection: "qa",
      stages: qaStages(true),
      // No activity-data or media side: the export cannot run, which is all this needs.
      base: base(dir),
    });
    expect(qa.skipped).toEqual([
      "verify_module",
      "prepare_deploy",
      "trigger_module_build",
      "await_module_build",
    ]);
    expect(qa.stages.map((entry) => entry.stage)[0]).toBe("export_activity_data");
    const run = await settled(runner);
    expect(run.stages[0]).toMatchObject({ status: "failed", error: { code: "unexpected" } });
    const log = runner.log(PROJECT, ACTIVITY, run.runId, 0)!.log.lines.map((line) => line.text);
    expect(log[0]).toBe(
      "The module's release is current (1.1.0): leaving out verify_module, prepare_deploy, trigger_module_build, await_module_build.",
    );
    // The release stays done: only the stages after the one that ran were set back.
    expect(dbDeployStore(db as unknown as Db).stages(ACTIVITY).await_module_build?.status).toBe(
      "done",
    );
  });

  it("fails the first stage on a failing lint, keeps its log tail and runs nothing after", async () => {
    const db = database();
    const dir = await home();
    const runner = runnerOn(db, dir);
    const lint: DeployProcess = {
      async run(command, args, options) {
        const line = `${command} ${args.join(" ")}`;
        if (line !== "npm run lint") return { code: 0, tail: "" };
        options.onOutput?.("a.js: error no-undef\n");
        return { code: 2, tail: "a.js: error no-undef\n" };
      },
    };
    const started = runner.start({
      projectId: PROJECT,
      activityId: ACTIVITY,
      target: "qa",
      selection: "release",
      base: base(dir, { process: lint }),
    });
    const run = await settled(runner);
    expect(run.status).toBe("failed");
    expect(run.stages.map((entry) => entry.status)).toEqual([
      "failed",
      "pending",
      "pending",
      "pending",
    ]);
    expect(run.stages[0]!.error).toEqual({
      code: "command_failed",
      command: "npm run lint",
      exitCode: 2,
      output: "a.js: error no-undef",
    });
    const page = runner.log(PROJECT, ACTIVITY, started.runId, 0)!.log;
    expect(page.lines.map((line) => line.text)).toContain("a.js: error no-undef");
    expect(page.done).toBe(true);
    expect(dbDeployStore(db as unknown as Db).stages(ACTIVITY).verify_module!.status).toBe(
      "failed",
    );
    // The file keeps it too, for a reader after a restart.
    const file = await fs.readFile(path.join(dir, "logs", `${started.runId}.log`), "utf8");
    expect(file).toContain("a.js: error no-undef");
  });

  it("runs one deploy at a time, and Stop kills the program and cancels the run", async () => {
    const db = database();
    const dir = await home();
    const runner = runnerOn(db, dir);
    const hang = hangingProcess();
    runner.start({
      projectId: PROJECT,
      activityId: ACTIVITY,
      target: "qa",
      selection: "release",
      base: base(dir, { process: hang.process }),
    });
    await vi.waitFor(() => expect(hang.state.started).toBe(1));
    expect(() =>
      runner.start({
        projectId: PROJECT,
        activityId: "act_2",
        target: "qa",
        selection: "verify_module",
        base: base(dir),
      }),
    ).toThrow(expect.objectContaining({ status: 409, code: "deploy_running" }));
    const stopped = await runner.stop(PROJECT, ACTIVITY);
    expect(hang.state.killed).toBe(1);
    expect(stopped?.status).toBe("cancelled");
    expect(stopped?.stages.map((entry) => entry.status)).toEqual([
      "cancelled",
      "cancelled",
      "cancelled",
      "cancelled",
    ]);
    expect(runner.current()).toBeNull();
    expect(dbDeployStore(db as unknown as Db).latestRun(PROJECT, ACTIVITY)?.status).toBe(
      "cancelled",
    );
  });

  it("marks a run a restart cut short as interrupted, its running stage failed", async () => {
    const db = database();
    const dir = await home();
    const first = runnerOn(db, dir);
    const hang = hangingProcess();
    const started = first.start({
      projectId: PROJECT,
      activityId: ACTIVITY,
      target: "qa",
      selection: "verify_module",
      base: base(dir, { process: hang.process }),
    });
    await vi.waitFor(() => expect(hang.state.started).toBe(1));
    // The process dies without winding down: the next one finds the row still running.
    const next = runnerOn(db, dir);
    const run = next.latest(PROJECT, ACTIVITY)!;
    expect(run.runId).toBe(started.runId);
    expect(run.status).toBe("interrupted");
    expect(run.stages[0]).toEqual({
      stage: "verify_module",
      status: "failed",
      error: { code: "interrupted" },
    });
    expect(dbDeployStore(db as unknown as Db).stages(ACTIVITY).verify_module!.status).toBe(
      "failed",
    );
    // Its log is read from the file.
    const page = next.log(PROJECT, ACTIVITY, started.runId, 0)!.log;
    expect(page.lines[0]!.text).toBe("== verify_module");
    expect(page.done).toBe(true);
    first.dispose();
  });

  it("interrupts the running deploy when the server stops", async () => {
    const db = database();
    const dir = await home();
    const runner = runnerOn(db, dir);
    const hang = hangingProcess();
    runner.start({
      projectId: PROJECT,
      activityId: ACTIVITY,
      target: "qa",
      selection: "release",
      base: base(dir, { process: hang.process }),
    });
    await vi.waitFor(() => expect(hang.state.started).toBe(1));
    runner.dispose();
    expect(hang.state.killed).toBe(1);
    const run = dbDeployStore(db as unknown as Db).latestRun(PROJECT, ACTIVITY)!;
    expect(run.status).toBe("interrupted");
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Nothing written after the stop overwrites it.
    expect(dbDeployStore(db as unknown as Db).latestRun(PROJECT, ACTIVITY)!.status).toBe(
      "interrupted",
    );
  });

  it("sets the stages after a re-run stage back to pending", async () => {
    const db = database();
    const dir = await home();
    const runner = runnerOn(db, dir);
    runner.start({
      projectId: PROJECT,
      activityId: ACTIVITY,
      target: "qa",
      selection: "release",
      base: base(dir),
    });
    await settled(runner);
    runner.start({
      projectId: PROJECT,
      activityId: ACTIVITY,
      target: "qa",
      selection: "prepare_deploy",
      base: base(dir),
    });
    await settled(runner);
    const stored = dbDeployStore(db as unknown as Db).stages(ACTIVITY);
    expect(stored.verify_module!.status).toBe("done");
    expect(stored.prepare_deploy!.status).toBe("done");
    expect(stored.trigger_module_build!.status).toBe("pending");
    expect(stored.await_module_build!.status).toBe("pending");
  });

  it("returns only the lines after the cursor", async () => {
    const lines = [1, 2, 3, 4].map((seq) => ({ seq, at: "now", text: `line ${seq}` }));
    expect(logPage(lines, 0, false)).toEqual({ lines, next: 4, done: false });
    expect(logPage(lines, 2, false)).toEqual({ lines: lines.slice(2), next: 4, done: false });
    expect(logPage(lines, 4, false)).toEqual({ lines: [], next: 4, done: false });
    expect(logPage(lines, 4, true)).toEqual({ lines: [], next: 4, done: true });
    expect(logPage(lines, 1, true).done).toBe(true);

    const db = database();
    const dir = await home();
    const runner = runnerOn(db, dir);
    const started = runner.start({
      projectId: PROJECT,
      activityId: ACTIVITY,
      target: "qa",
      selection: "verify_module",
      base: base(dir),
    });
    await settled(runner);
    const first = runner.log(PROJECT, ACTIVITY, started.runId, 0)!.log;
    const cut = first.lines[2]!.seq;
    const rest = runner.log(PROJECT, ACTIVITY, started.runId, cut)!.log;
    expect(rest.lines.map((line) => line.seq)).toEqual(
      first.lines.slice(3).map((line) => line.seq),
    );
    expect(runner.log(PROJECT, ACTIVITY, "dep_nope", 0)).toBeNull();
    expect(runner.log("other", ACTIVITY, started.runId, 0)).toBeNull();
  });
});
