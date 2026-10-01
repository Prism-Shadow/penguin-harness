/**
 * The update job behind POST /api/version/update (services/update-job.ts): the progress it
 * reads off the CLI's output, its lifecycle over a scripted runner (nothing is ever spawned
 * here), and how a finished run is classified.
 *
 * - Progress stays "resolving" with no percentage until the installer announces the download;
 *   then it follows curl's bar (freshest value, clamped and rounded), and turns "installing"
 *   once the bundle verifies, ignoring later percentages.
 * - A job starts idle, runs the CLI entry once however often it is started while running,
 *   tracks progress, and ends updated with a restart needed.
 * - A refusal ends unsupported; a failure, a timeout and a spawn error end failed, and a failed
 *   run can be started again.
 * - With no CLI to run, the job ends at once as unsupported.
 * - The CLI's own refusal copy reads as unsupported, and any other clean exit — "already on the
 *   latest version" included — as updated with a restart needed.
 */
import { describe, expect, it } from "vitest";
import { wire } from "@prismshadow/penguin-core/kernel";
import {
  INITIAL_PROGRESS,
  UpdateJobService,
  advanceUpdateProgress,
  classifyUpdateRun,
} from "../src/services/update-job.js";
import type { UpdateRunExit, UpdateRunner } from "../src/services/update-job.js";

describe("advanceUpdateProgress", () => {
  it("stays resolving, with no percentage, until the installer announces the download", () => {
    const p = advanceUpdateProgress(INITIAL_PROGRESS, "Upgrade 0.2.9 -> 0.3.0\nSelected GitHub.\n");
    expect(p).toEqual({ phase: "resolving", percent: null });
    // A stray percentage before the download line is not a download percentage.
    expect(advanceUpdateProgress(p, "speed 100% ok\n")).toEqual({
      phase: "resolving",
      percent: null,
    });
  });

  it("reads curl's progress bar once the download line has passed, keeping the freshest percentage", () => {
    const started = advanceUpdateProgress(
      INITIAL_PROGRESS,
      "Downloading penguin-harness-0.3.0-linux-x64.tar.gz from GitHub ...\n",
    );
    expect(started).toEqual({ phase: "downloading", percent: null });
    const chunk = "\r####                        12.3%\r########                    31.9%";
    expect(advanceUpdateProgress(started, chunk)).toEqual({ phase: "downloading", percent: 32 });
    // The download line and its first redraws may arrive in one read.
    expect(
      advanceUpdateProgress(
        INITIAL_PROGRESS,
        "Downloading x.tar.gz from OSS mirror ...\n\r##     7.0%",
      ),
    ).toEqual({ phase: "downloading", percent: 7 });
  });

  it("moves to installing when the bundle verifies, dropping the percentage", () => {
    const downloading = { phase: "downloading" as const, percent: 100 };
    expect(advanceUpdateProgress(downloading, "Bundle checksum OK.\n")).toEqual({
      phase: "installing",
      percent: null,
    });
    // Installing is terminal for the bar: later percentages (a second curl) are ignored.
    expect(advanceUpdateProgress({ phase: "installing", percent: null }, "\r### 50.0%")).toEqual({
      phase: "installing",
      percent: null,
    });
  });

  it("clamps and rounds what it reads", () => {
    const downloading = { phase: "downloading" as const, percent: null };
    expect(advanceUpdateProgress(downloading, "999%")).toEqual({
      phase: "downloading",
      percent: 100,
    });
    expect(advanceUpdateProgress(downloading, "0.4%")).toEqual({
      phase: "downloading",
      percent: 0,
    });
  });
});

/** A runner whose output and exit the test scripts; `finish` ends the run. */
function scriptedRunner(): {
  runner: UpdateRunner;
  emit: (chunk: string) => void;
  finish: (exit: UpdateRunExit) => Promise<void>;
  entries: string[];
} {
  let onOutput: ((chunk: string) => void) | null = null;
  let resolveExit: ((exit: UpdateRunExit) => void) | null = null;
  const entries: string[] = [];
  const runner: UpdateRunner = (cliEntry, out) => {
    entries.push(cliEntry);
    onOutput = out;
    return new Promise((resolve) => {
      resolveExit = resolve;
    });
  };
  return {
    runner,
    entries,
    emit: (chunk) => onOutput?.(chunk),
    finish: async (exit) => {
      resolveExit?.(exit);
      // Let the service's `.then` settle.
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

describe("UpdateJobService", () => {
  it("starts idle, runs the CLI entry with progress, and ends updated with needsRestart", async () => {
    const script = scriptedRunner();
    const job = wire(UpdateJobService, { runner: script.runner });
    expect(job.status()).toEqual({ state: "idle", targetVersion: null, output: "" });

    const started = job.start("/opt/penguin/cli.js", "0.3.0");
    expect(started).toMatchObject({
      state: "running",
      targetVersion: "0.3.0",
      phase: "resolving",
      percent: null,
      output: "",
    });
    expect(script.entries).toEqual(["/opt/penguin/cli.js"]);
    // A second start joins the run rather than spawning another installer over the same dir.
    expect(job.start("/opt/penguin/cli.js", "0.3.0")).toBe(job.status());
    expect(script.entries).toHaveLength(1);

    script.emit("Downloading penguin.tar.gz from GitHub ...\n\r#### 40.0%");
    expect(job.status()).toMatchObject({ phase: "downloading", percent: 40 });
    script.emit("\r######## 100.0%\nBundle checksum OK.\n");
    expect(job.status()).toMatchObject({ phase: "installing", percent: null });
    await script.finish({ exitCode: 0, timedOut: false });
    expect(job.status()).toMatchObject({
      state: "done",
      targetVersion: "0.3.0",
      result: { status: "updated", needsRestart: true },
    });
    expect(job.status().output).toContain("Bundle checksum OK.");
  });

  it("classifies a refusal, a failure, a timeout and a spawn error", async () => {
    const refused = scriptedRunner();
    const a = wire(UpdateJobService, { runner: refused.runner });
    a.start("/e", null);
    refused.emit("This penguin runs from a source checkout, so there is nothing to download.");
    await refused.finish({ exitCode: 0, timedOut: false });
    expect(a.status().result).toMatchObject({ status: "unsupported", needsRestart: false });

    const failed = scriptedRunner();
    const b = wire(UpdateJobService, { runner: failed.runner });
    b.start("/e", "0.3.0");
    await failed.finish({ exitCode: 1, timedOut: false });
    expect(b.status().result).toMatchObject({ status: "failed" });
    // A failed run can be started again: that is the retry.
    expect(b.start("/e", "0.3.0").state).toBe("running");

    const timedOut = scriptedRunner();
    const c = wire(UpdateJobService, { runner: timedOut.runner });
    c.start("/e", null);
    await timedOut.finish({ exitCode: -1, timedOut: true });
    expect(c.status().result?.status).toBe("failed");
    expect(c.status().output).toContain("killed after 10 minutes");

    const broken = scriptedRunner();
    const d = wire(UpdateJobService, { runner: broken.runner });
    d.start("/e", null);
    await broken.finish({ exitCode: -1, timedOut: false, spawnError: "ENOENT" });
    expect(d.status().result?.status).toBe("failed");
    expect(d.status().output).toContain("ENOENT");
  });

  it("ends at once as unsupported when there is no CLI to run", () => {
    const script = scriptedRunner();
    const job = wire(UpdateJobService, { runner: script.runner });
    expect(job.start(null, "0.3.0")).toMatchObject({
      state: "done",
      result: { status: "unsupported", reason: "not_launched_via_cli", needsRestart: false },
    });
    expect(script.entries).toEqual([]);
  });
});

describe("classifyUpdateRun", () => {
  it("reads the CLI's refusal copy as unsupported, and any other clean exit as updated", () => {
    // Literal CLI copy (packages/cli/src/i18n.ts, the update refusals): the classifier matches
    // fragments of these exact strings, so a reworded refusal must fail here.
    for (const refusal of [
      "This penguin runs from a source checkout, so there is nothing to download — update it with `git pull` and rebuild (`pnpm install && pnpm -r build`).",
      "Cannot tell how this penguin was installed (running from /opt/penguin/cli.js), so it will not be replaced. Re-install with the official installer, or upgrade with the package manager you used.",
      "This is a global install under /usr/lib/node_modules, but the package manager that owns it could not be identified. Upgrade it yourself with that manager, e.g. `npm install -g @prismshadow/penguin-cli@0.3.0`.",
      "The official installer is a POSIX shell script and does not run on Windows. Re-install from the GitHub Releases page, or use a global npm install instead.",
      "On Windows, penguin cannot run your package manager for you: Node will not execute an npm/pnpm/yarn `.cmd` shim without a shell.",
    ]) {
      expect(classifyUpdateRun(0, refusal), refusal).toMatchObject({
        status: "unsupported",
        needsRestart: false,
      });
    }
    // "Already on the latest version" means the INSTALL is current: only this older, in-memory
    // process is missing a restart.
    for (const output of [
      "Upgrade 0.1.2 -> 0.1.3\nPenguinHarness 0.1.3 installed. Run `penguin --version` in a new shell to confirm.",
      "Already on the latest version (0.1.3); nothing to do.",
    ]) {
      expect(classifyUpdateRun(0, output)).toEqual({
        status: "updated",
        output,
        needsRestart: true,
      });
    }
  });
});
