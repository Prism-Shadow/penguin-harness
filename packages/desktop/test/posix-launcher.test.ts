/**
 * POSIX launcher execution scenarios (shell runtime stand-ins, not a Windows install):
 * - Given each packaged layout under a path with spaces and Chinese characters, launching
 *   directly or through relative symlinks runs the bundled CLI as Node, preserves arguments
 *   and the exit code, and leaves macOS/Linux paths alone even when cygpath is available.
 * - Given a Windows runtime and cygpath, launching with or without MSYSTEM passes a Windows
 *   CLI entry path to the runtime while preserving the user's arguments.
 * - Given a failed Windows path conversion, launching fails without starting the runtime.
 * - Given no executable runtime, launching reports the missing runtime and exits unsuccessfully.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { posixLauncherScript, shellQuote } from "../src/launcher.js";

// A .exe shell stand-in exercises discovery on POSIX hosts; it is not a native PE executable.
describe.skipIf(process.platform === "win32")("POSIX launcher execution", () => {
  let root: string;
  let appDir: string;
  let launcher: string;
  let toolsDir: string;

  function executable(file: string, body: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  }

  function runtime(relativePath: string) {
    executable(
      path.resolve(appDir, relativePath),
      'printf "%s\\0" "$ELECTRON_RUN_AS_NODE" "$@"\nexit 37',
    );
  }

  function launch(command = launcher, msystem?: string) {
    return spawnSync(command, ["--help", "two words", "中文", "", "*.json", "--flag=literal"], {
      // Only the launcher's utilities are on PATH, so the host cannot supply cygpath by accident.
      env: { PATH: toolsDir, MSYSTEM: msystem },
      cwd: root,
      encoding: "utf8",
    });
  }

  function expectRuntime(result: ReturnType<typeof launch>, entry: string) {
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(37);
    expect(result.stderr).toBe("");
    expect(result.stdout.split("\0")).toEqual([
      "1",
      entry,
      "--help",
      "two words",
      "中文",
      "",
      "*.json",
      "--flag=literal",
      "",
    ]);
  }

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penguin-launcher-")));
    appDir = path.join(root, "选题日历 PenguinHarness", "resources", "app");
    launcher = path.join(appDir, "bin", "penguin");
    fs.mkdirSync(path.dirname(launcher), { recursive: true });
    fs.writeFileSync(launcher, posixLauncherScript(), { mode: 0o755 });
    toolsDir = path.join(root, "tools");
    fs.mkdirSync(toolsDir);
    for (const tool of ["dirname", "readlink"]) {
      fs.symlinkSync(`/usr/bin/${tool}`, path.join(toolsDir, tool));
    }
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const layouts = [
    { platform: "macOS", runtimePath: "../../MacOS/PenguinHarness" },
    { platform: "Linux", runtimePath: "../../penguin-harness" },
    { platform: "Windows", runtimePath: "../../PenguinHarness.exe" },
  ];

  it.each(
    layouts.flatMap((layout) => [
      { ...layout, invocation: "directly" },
      { ...layout, invocation: "through relative symlinks" },
    ]),
  )(
    "runs the $platform CLI $invocation with its arguments and exit code",
    ({ platform, runtimePath, invocation }) => {
      runtime(runtimePath);
      if (platform !== "Windows") executable(path.join(toolsDir, "cygpath"), "exit 73");
      let command = launcher;
      if (invocation !== "directly") {
        const alias = path.join(root, "penguin-alias");
        fs.symlinkSync(path.relative(root, launcher), alias);
        command = path.join(root, "penguin");
        fs.symlinkSync(path.basename(alias), command);
      }
      expectRuntime(launch(command), path.join(appDir, "dist", "penguin.js"));
    },
  );

  it.each([
    { shell: "Git Bash", msystem: "MINGW64" },
    { shell: "MSYS2", msystem: "MSYS" },
    { shell: "Cygwin", msystem: undefined },
  ])("passes the converted CLI path to Windows under $shell", ({ msystem }) => {
    runtime("../../PenguinHarness.exe");
    const entry = path.join(appDir, "dist", "penguin.js");
    const windowsEntry = "D:\\选题日历 PenguinHarness\\resources\\app\\dist\\penguin.js";
    executable(
      path.join(toolsDir, "cygpath"),
      `[ "$#" -eq 2 ] && [ "$1" = "-w" ] && [ "$2" = ${shellQuote(entry)} ] || exit 72\n` +
        `printf '%s\\n' ${shellQuote(windowsEntry)}`,
    );
    expectRuntime(launch(launcher, msystem), windowsEntry);
  });

  it("does not start the runtime when Windows path conversion fails", () => {
    runtime("../../PenguinHarness.exe");
    executable(path.join(toolsDir, "cygpath"), "echo 'conversion failed' >&2\nexit 73");
    const result = launch();
    expect(result.status).toBe(73);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("conversion failed");
  });

  it.each(["absent", "not executable"])("reports a runtime that is $0", (state) => {
    if (state === "not executable") {
      fs.writeFileSync(path.resolve(appDir, "../../PenguinHarness.exe"), "not executable");
    }
    const result = launch();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("could not find the PenguinHarness runtime");
    expect(result.stderr).toContain(appDir);
  });
});
