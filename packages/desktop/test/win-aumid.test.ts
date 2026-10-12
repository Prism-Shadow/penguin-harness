/**
 * Registering the shell's Windows AppUserModelID as a toast sender (src/win-aumid.ts). main.ts
 * starts the registration without awaiting it, so besides what gets written, these scenarios
 * hold what makes that safe: the call hands control straight back, a failure only reaches the
 * log, and a reg.exe that hangs is stopped.
 *
 * With reg.exe faked at the execFile boundary, answering the way Node's execFile does:
 * - Given a Windows launch with an icon on disk, the display name and the icon are written
 *   under HKCU\Software\Classes\AppUserModelId\<AUMID> by %SystemRoot%\System32\reg.exe, with
 *   no console window, and nothing is logged.
 * - Given an environment without SystemRoot, reg.exe still runs from C:\Windows\System32 and
 *   is never looked up on PATH.
 * - Given no icon on disk, only the display name is written.
 * - Given macOS or Linux, nothing runs and nothing is logged.
 * - Given reg.exe still running, the call has already returned and nothing is logged; the
 *   registration ends when reg.exe exits.
 * - Given reg.exe refusing the first write, one line naming the AUMID and reg.exe's error is
 *   logged, nothing more is written, and the call resolves rather than rejects.
 * - Given a reg.exe that never exits, it is stopped after five seconds, the log says so, and
 *   the call resolves.
 *
 * With the real reg.exe (Windows only, under a throwaway AUMID removed afterwards):
 * - Given a Windows host, the stored values read back exactly as written, including an icon
 *   path with spaces and CJK characters.
 * - Given values from an earlier launch, the next launch overwrites them without reg.exe
 *   stopping to ask.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appIdentity } from "../src/app-identity.js";
import { registerWindowsAumid } from "../src/win-aumid.js";
import type { ExecFile } from "../src/win-aumid.js";

const release = appIdentity("release");
const dev = appIdentity("dev");
const ICON =
  "C:\\Users\\Jane Doe\\AppData\\Local\\Programs\\PenguinHarness\\resources\\app\\dist\\icon.png";

/** Where Windows looks up a toast sender's name and icon. */
function senderKey(appUserModelId: string): string {
  return `HKCU\\Software\\Classes\\AppUserModelId\\${appUserModelId}`;
}

/** How long the fake reg.exe takes to exit, in fake time. */
const RUN_MS = 40;

/**
 * reg.exe behind the execFile seam, answering the way Node's execFile does: a clean exit calls
 * back with null; a non-zero exit with an Error whose message is the command line followed by
 * reg.exe's stderr; a process still running when `options.timeout` elapses is killed and calls
 * back with an Error flagged `killed` (with no timeout it would never call back at all).
 */
function fakeRegExe(behaviour: "exits" | "refuses" | "hangs") {
  const runs: Array<{ file: string; args: string[]; windowsHide: boolean }> = [];
  let running = 0;
  const execFile: ExecFile = (file, args, options, callback) => {
    runs.push({ file, args: [...args], windowsHide: options.windowsHide });
    running += 1;
    const command = [file, ...args].join(" ");
    const exit = (error: Error | null): void => {
      running -= 1;
      callback(error);
    };
    if (behaviour === "exits") {
      setTimeout(() => exit(null), RUN_MS);
    } else if (behaviour === "refuses") {
      const error = Object.assign(
        new Error(`Command failed: ${command}\nERROR: Access is denied.\r\n`),
        { code: 1, killed: false, signal: null },
      );
      setTimeout(() => exit(error), RUN_MS);
    } else if (options.timeout > 0) {
      const error = Object.assign(new Error(`Command failed: ${command}\n`), {
        code: null,
        killed: true,
        signal: "SIGTERM",
      });
      setTimeout(() => exit(error), options.timeout);
    }
  };
  return { execFile, runs, running: () => running };
}

describe("registering the AUMID, reg.exe faked", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Starts registering the release identity on Windows as main.ts does, plus `overrides`. */
  function start(
    reg: ReturnType<typeof fakeRegExe>,
    overrides: Partial<Parameters<typeof registerWindowsAumid>[0]> = {},
  ) {
    const logs: string[] = [];
    let settled = false;
    const done = registerWindowsAumid({
      platform: "win32",
      env: { SystemRoot: "D:\\Windows" },
      appUserModelId: release.appUserModelId,
      displayName: release.name,
      iconPath: ICON,
      execFile: reg.execFile,
      log: (line) => logs.push(line),
      ...overrides,
    }).then(() => {
      settled = true;
    });
    return { done, logs, settled: () => settled };
  }

  it("writes the display name and the icon under the AUMID's HKCU key with the system's reg.exe, hidden", async () => {
    const reg = fakeRegExe("exits");
    const run = start(reg);
    await vi.runAllTimersAsync();
    await run.done;

    const key = senderKey(release.appUserModelId);
    const file = "D:\\Windows\\System32\\reg.exe";
    expect(reg.runs).toEqual([
      {
        file,
        args: ["add", key, "/v", "DisplayName", "/t", "REG_SZ", "/d", release.name, "/f"],
        windowsHide: true,
      },
      {
        file,
        args: ["add", key, "/v", "IconUri", "/t", "REG_SZ", "/d", ICON, "/f"],
        windowsHide: true,
      },
    ]);
    expect(run.logs).toEqual([]);
  });

  it("runs C:\\Windows\\System32\\reg.exe when the environment has no SystemRoot, never one on PATH", async () => {
    const reg = fakeRegExe("exits");
    const run = start(reg, { env: { PATH: "C:\\tools;C:\\Windows\\System32" } });
    await vi.runAllTimersAsync();
    await run.done;

    expect(reg.runs.map((r) => r.file)).toEqual([
      "C:\\Windows\\System32\\reg.exe",
      "C:\\Windows\\System32\\reg.exe",
    ]);
  });

  it("writes only the display name when there is no icon on disk", async () => {
    const reg = fakeRegExe("exits");
    const run = start(reg, {
      appUserModelId: dev.appUserModelId,
      displayName: dev.name,
      iconPath: null,
    });
    await vi.runAllTimersAsync();
    await run.done;

    const key = senderKey(dev.appUserModelId);
    expect(reg.runs.map((r) => r.args)).toEqual([
      ["add", key, "/v", "DisplayName", "/t", "REG_SZ", "/d", dev.name, "/f"],
    ]);
    expect(run.logs).toEqual([]);
  });

  it.each(["darwin", "linux"] as const)("runs nothing and logs nothing on %s", async (platform) => {
    const reg = fakeRegExe("exits");
    const run = start(reg, { platform });
    await vi.runAllTimersAsync();
    await run.done;

    expect(reg.runs).toEqual([]);
    expect(run.logs).toEqual([]);
  });

  it("hands control back while reg.exe is still running, and ends when reg.exe exits", async () => {
    const reg = fakeRegExe("exits");
    const run = start(reg);
    // Straight after the call, where main.ts carries on with startup.
    expect(reg.running()).toBe(1);
    expect(run.settled()).toBe(false);
    expect(run.logs).toEqual([]);

    await vi.runAllTimersAsync();
    await run.done;
    expect(reg.running()).toBe(0);
    expect(run.logs).toEqual([]);
  });

  it("logs one line naming the AUMID and reg.exe's error when a write is refused, and writes nothing more", async () => {
    const reg = fakeRegExe("refuses");
    const run = start(reg);
    await vi.runAllTimersAsync();

    await expect(run.done).resolves.toBeUndefined();
    expect(reg.runs).toHaveLength(1);
    expect(run.logs).toHaveLength(1);
    expect(run.logs[0]).toContain(`'${release.appUserModelId}'`);
    expect(run.logs[0]).toContain("ERROR: Access is denied.");
    expect(run.logs[0]).not.toMatch(/[\r\n]/);
  });

  it("stops a reg.exe that has not exited after five seconds, and logs that it did", async () => {
    const reg = fakeRegExe("hangs");
    const run = start(reg);
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(run.done).resolves.toBeUndefined();
    expect(reg.running()).toBe(0);
    expect(reg.runs).toHaveLength(1);
    expect(run.logs).toEqual([
      expect.stringMatching(
        /^Windows AppUserModelID '.+' could not be registered: reg\.exe did not exit within/,
      ),
    ]);
  });
});

describe.skipIf(process.platform !== "win32")("registering the AUMID with the real reg.exe", () => {
  // This run's own throwaway AUMID, so no identity the app registers is touched.
  const appUserModelId = `com.prismshadow.penguinharness.test-${process.pid}`;
  const key = senderKey(appUserModelId);
  // A per-user install under a Windows account named in Chinese, with a space in it.
  const icon =
    "C:\\Users\\企鹅 用户\\AppData\\Local\\Programs\\PenguinHarness\\resources\\app\\dist\\icon.png";
  let dir = "";

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "penguin-aumid-"));
  });
  afterAll(() => {
    spawnSync("reg", ["delete", key, "/f"], { windowsHide: true });
    rmSync(dir, { recursive: true, force: true });
  });

  /** Registers `displayName` and the icon as a launch would; returns what it logged. */
  async function launch(displayName: string): Promise<string[]> {
    const logs: string[] = [];
    await registerWindowsAumid({
      platform: "win32",
      env: process.env,
      appUserModelId,
      displayName,
      iconPath: icon,
      log: (line) => logs.push(line),
    });
    return logs;
  }

  /**
   * The key's values as Windows stored them. `reg export` writes UTF-16, which survives the
   * CJK characters that `reg query`'s console code page would garble.
   */
  function storedValues(): Record<string, string> {
    const file = path.join(dir, "sender.reg");
    execFileSync("reg", ["export", key, file, "/y"], { windowsHide: true });
    const values: Record<string, string> = {};
    for (const match of readFileSync(file, "utf16le").matchAll(/^"(.+?)"="(.*)"\r?$/gm)) {
      values[match[1] ?? ""] = (match[2] ?? "").replace(/\\(.)/g, "$1");
    }
    return values;
  }

  it("stores the display name and the icon path exactly as given", async () => {
    expect(await launch("PenguinHarness Test")).toEqual([]);
    expect(storedValues()).toEqual({ DisplayName: "PenguinHarness Test", IconUri: icon });
  });

  it("overwrites an earlier launch's values without reg.exe stopping to ask", async () => {
    expect(await launch("PenguinHarness Test")).toEqual([]);
    expect(await launch("PenguinHarness Test 2")).toEqual([]);
    expect(storedValues()).toEqual({ DisplayName: "PenguinHarness Test 2", IconUri: icon });
  });
});
