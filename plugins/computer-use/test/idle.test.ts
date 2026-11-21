/**
 * How long ago the person at this computer last used the keyboard or mouse. The system's readers
 * are the one fake (the program boundary: which file runs with which arguments, and what it
 * prints or how it exits).
 *
 * - Given macOS, the idle time is ioreg's HIDIdleTime; given Windows, GetLastInputInfo's age
 *   through Windows PowerShell; given X11, xprintidle when it is installed, else Python over
 *   libXss.
 * - Given X11 without libXss, without the screen-saver extension, or a display that will not
 *   open, the answer is unknown and says why; given Wayland, unknown.
 * - Given a reader the server's user could have planted (it fails the system-only check), it is
 *   never run.
 * - Given only the desktop session's variables are passed, a secret in the server's environment
 *   never reaches a reader.
 */
import { describe, expect, it } from "vitest";
import { readIdle } from "../src/idle.js";
import type { ExecFile } from "../src/idle.js";

/** Records each run; answers by the program's base name. */
function system(answers: Record<string, string | { exit: number }>) {
  const runs: Array<{ file: string; args: readonly string[]; env: Record<string, string> }> = [];
  const exec: ExecFile = async (file, args, env) => {
    runs.push({ file, args, env });
    const base = file.split(/[\\/]/).at(-1)!;
    const answer = answers[base];
    if (answer === undefined)
      throw Object.assign(new Error(`${base}: not found`), { code: "ENOENT" });
    if (typeof answer === "string") return answer;
    throw Object.assign(new Error(`${base} exited ${answer.exit}`), { code: answer.exit });
  };
  return { exec, runs };
}

const everywhere = async () => true;
const env = { DISPLAY: ":95", HOME: "/home/u", OPENAI_API_KEY: "sk-secret" };

describe("the input idle time", () => {
  it("reads macOS's HIDIdleTime", async () => {
    const sys = system({ ioreg: '  | |   "HIDIdleTime" = 2500000000\n' });
    expect(
      await readIdle({ platform: "darwin", env, exec: sys.exec, trusted: everywhere }),
    ).toEqual({ seconds: 2.5, source: "HIDIdleTime" });
    expect(sys.runs[0]!.file).toBe("/usr/sbin/ioreg");
  });

  it("reads Windows' GetLastInputInfo through Windows PowerShell", async () => {
    const sys = system({ "powershell.exe": "1250\r\n" });
    const reading = await readIdle({
      platform: "win32",
      env: { SystemRoot: "C:\\Windows", OPENAI_API_KEY: "sk-secret" },
      exec: sys.exec,
      trusted: everywhere,
    });
    expect(reading).toEqual({ seconds: 1.25, source: "GetLastInputInfo" });
    expect(sys.runs[0]!.file).toBe(
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    );
    expect(sys.runs[0]!.args).toContain("-NoProfile");
    // The script travels encoded, so no command-line quoting can break it.
    const encoded = sys.runs[0]!.args[sys.runs[0]!.args.indexOf("-EncodedCommand") + 1]!;
    expect(Buffer.from(encoded, "base64").toString("utf16le")).toContain("GetLastInputInfo");
  });

  it("asks the service's long-running PowerShell first on Windows, and runs one of its own if it fails", async () => {
    const sys = system({ "powershell.exe": "900\r\n" });
    const winEnv = { SystemRoot: "C:\\Windows" };
    expect(
      await readIdle({
        platform: "win32",
        env: winEnv,
        exec: sys.exec,
        trusted: everywhere,
        windows: { read: async () => 4200 },
      }),
    ).toEqual({ seconds: 4.2, source: "GetLastInputInfo" });
    expect(sys.runs).toEqual([]);
    expect(
      await readIdle({
        platform: "win32",
        env: winEnv,
        exec: sys.exec,
        trusted: everywhere,
        windows: {
          read: async () => {
            throw new Error("PowerShell did not answer within 20 s");
          },
        },
      }),
    ).toEqual({ seconds: 0.9, source: "GetLastInputInfo" });
    expect(sys.runs).toHaveLength(1);
  });

  it("reads X11's idle time with xprintidle when installed, else Python over libXss", async () => {
    const withTool = system({ xprintidle: "4200\n" });
    expect(
      await readIdle({ platform: "linux", env, exec: withTool.exec, trusted: everywhere }),
    ).toEqual({ seconds: 4.2, source: "XScreenSaver" });
    const noTool = system({ python3: "800\n" });
    const onlyPython = async (file: string) => !file.endsWith("xprintidle");
    expect(
      await readIdle({ platform: "linux", env, exec: noTool.exec, trusted: onlyPython }),
    ).toEqual({ seconds: 0.8, source: "XScreenSaver" });
    expect(noTool.runs[0]!.file).toBe("/usr/bin/python3");
    expect(noTool.runs[0]!.args.slice(0, 3)).toEqual(["-I", "-S", "-c"]);
    // Only the display's variables reach a reader.
    for (const run of [...withTool.runs, ...noTool.runs]) {
      expect(Object.keys(run.env).sort()).toEqual(["DISPLAY", "HOME"]);
    }
  });

  it("says why X11's idle time is unknown, and that Wayland has none", async () => {
    const onlyPython = async (file: string) => !file.endsWith("xprintidle");
    for (const [exit, why] of [
      [5, /libXss/],
      [4, /MIT-SCREEN-SAVER/],
      [3, /could not be opened/],
    ] as const) {
      const sys = system({ python3: { exit } });
      expect(
        await readIdle({ platform: "linux", env, exec: sys.exec, trusted: onlyPython }),
      ).toEqual({ seconds: null, source: null, reason: expect.stringMatching(why) });
    }
    const wayland = system({});
    expect(
      await readIdle({
        platform: "linux",
        env: { WAYLAND_DISPLAY: "wayland-0" },
        exec: wayland.exec,
        trusted: everywhere,
      }),
    ).toEqual({ seconds: null, source: null, reason: expect.stringMatching(/Wayland/) });
    expect(wayland.runs).toEqual([]);
  });

  it("never runs a reader the server's user could have planted", async () => {
    const sys = system({ xprintidle: "1", python3: "1", ioreg: '"HIDIdleTime" = 1' });
    const nowhere = async () => false;
    for (const platform of ["linux", "darwin"] as const) {
      expect(
        (await readIdle({ platform, env, exec: sys.exec, trusted: nowhere })).seconds,
      ).toBeNull();
    }
    expect(sys.runs).toEqual([]);
  });
});
