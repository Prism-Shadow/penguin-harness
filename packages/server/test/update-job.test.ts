/**
 * update-job.ts unit tests: the progress read off the CLI's output, and the job's lifecycle
 * over a scripted runner (nothing is ever spawned here).
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

  it("classifyUpdateRun keeps its three verdicts", () => {
    expect(classifyUpdateRun(1, "x").status).toBe("failed");
    expect(classifyUpdateRun(0, "does not run on Windows").status).toBe("unsupported");
    expect(classifyUpdateRun(0, "installed").needsRestart).toBe(true);
  });
});
