import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUILD_LOG_MAX,
  clampLog,
  moduleBuildScript,
  spawnModuleBuild,
} from "../src/activities/sandbox-build-runner.js";

describe("keeping a build log readable", () => {
  it("leaves a log that fits", () => {
    expect(clampLog("short")).toBe("short");
  });

  it("keeps the end, because that is where the error is", () => {
    // Truncating from the end throws away the only part anyone reads.
    const log = `${"a".repeat(100)}ERROR: the real problem`;
    const clamped = clampLog(log, 30);
    expect(clamped).toContain("ERROR: the real problem");
    expect(clamped).toContain("earlier characters omitted");
    expect(clamped.length).toBeLessThan(log.length);
  });

  it("has a bound a webpack failure fits inside", () => {
    expect(BUILD_LOG_MAX).toBeGreaterThan(64 * 1024);
  });
});

describe("running a module's own build", () => {
  const cleanups: (() => Promise<unknown>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  /** A workspace whose `npm run build` is a node script we control. */
  async function workspace(script: string) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-build-"));
    cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
    await fs.writeFile(path.join(dir, "build.js"), script, "utf8");
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "m", version: "1.0.0", scripts: { build: "node build.js" } }),
      "utf8",
    );
    return dir;
  }

  it("reports a build that succeeded, with its output", async () => {
    const dir = await workspace('console.log("compiled 3 modules");');
    const outcome = await spawnModuleBuild(dir);
    expect(outcome.ok).toBe(true);
    expect(outcome.log).toContain("compiled 3 modules");
  });

  it("reports a build that failed, with its output and its exit code", async () => {
    const dir = await workspace('console.error("Module not found: ./missing"); process.exit(2);');
    const outcome = await spawnModuleBuild(dir);
    expect(outcome.ok).toBe(false);
    expect(outcome.log).toContain("Module not found");
    expect(outcome.log).toContain("exited with code 2");
  });

  it("treats a build that cannot start as a failed build with a reason", async () => {
    // The author asked to see their activity; "there is no build script" answers that, and
    // an exception thrown at whoever requested the preview does not.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-build-"));
    cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
    const outcome = await spawnModuleBuild(dir);
    expect(outcome.ok).toBe(false);
    expect(outcome.log.length).toBeGreaterThan(0);
  });

  it("falls back to the scaffold's buildDebug when there is no build script", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-build-"));
    cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
    await fs.writeFile(path.join(dir, "build.js"), 'console.log("debug bundle");', "utf8");
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "m", version: "1.0.0", scripts: { buildDebug: "node build.js" } }),
      "utf8",
    );
    expect(moduleBuildScript(dir)).toBe("buildDebug");
    const outcome = await spawnModuleBuild(dir);
    expect(outcome.ok).toBe(true);
    expect(outcome.log).toContain("debug bundle");
  });

  it("says so when the module has neither script", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-build-"));
    cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ scripts: {} }), "utf8");
    expect(moduleBuildScript(dir)).toBeNull();
    const outcome = await spawnModuleBuild(dir);
    expect(outcome.ok).toBe(false);
    expect(outcome.log).toContain("no build or buildDebug script");
  });

  it("compiles res/style.scss to the style.css the definition requires before building", async () => {
    // WAF's builder copies res/ as is: without this the build ships style.scss, the player
    // fails on the missing style.css, and the layout never mounts.
    const dir = await workspace(
      'const fs = require("fs"); console.log("saw css: " + fs.readFileSync("res/style.css", "utf8").includes(".a .b"));',
    );
    await fs.mkdir(path.join(dir, "res"));
    await fs.writeFile(path.join(dir, "res", "style.scss"), ".a { .b { color: red; } }", "utf8");
    const outcome = await spawnModuleBuild(dir);
    expect(outcome.ok).toBe(true);
    expect(outcome.log).toContain("Compiled res/style.scss");
    expect(outcome.log).toContain("saw css: true");
  });

  it("does not build when the stylesheet does not compile", async () => {
    const dir = await workspace('console.log("built anyway");');
    await fs.mkdir(path.join(dir, "res"));
    await fs.writeFile(path.join(dir, "res", "style.scss"), ".a { color: ", "utf8");
    const outcome = await spawnModuleBuild(dir);
    expect(outcome.ok).toBe(false);
    expect(outcome.log).not.toContain("built anyway");
  });

  it("stops a build that takes too long and says so", async () => {
    const dir = await workspace("setTimeout(() => {}, 60000);");
    const outcome = await spawnModuleBuild(dir, { timeoutMs: 300 });
    expect(outcome.ok).toBe(false);
    expect(outcome.log).toContain("taking too long");
  });
});
