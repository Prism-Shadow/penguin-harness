/**
 * One agent-desktop command, one process.
 *
 * - Given a command, the program runs with exactly the arguments given and the one envelope it
 *   prints comes back with its exit code.
 * - Given text for stdin, it arrives on stdin and nowhere among the arguments.
 * - Given the server's environment, only the desktop-session names reach the program, with the
 *   variables this plugin sets — never an API key.
 * - Given a program that outlives its budget and grace, it is stopped and reported as timed out.
 * - Given a program that prints no envelope, there is none to report; given one that cannot be
 *   started, the reason comes back.
 */
import { describe, expect, it } from "vitest";
import { agentDesktopEnv } from "../src/env.js";
import { runAgentDesktop } from "../src/runner.js";
import { err, fakeAgentDesktop, ok, tempDir } from "./helpers.js";

/** What a program needs of this host to start at all. */
const hostEnv = () => agentDesktopEnv(process.env, process.platform, {});

describe("runAgentDesktop", () => {
  it("runs the arguments given and reports the envelope and the exit code", async () => {
    const fake = await fakeAgentDesktop({
      find: { stdout: err("find", "APP_NOT_FOUND", "no app named x"), exit: 1 },
    });
    const cwd = await tempDir();
    const out = await runAgentDesktop(fake.program, {
      argv: ["find", "--app", "x", "--name", "OK"],
      env: hostEnv(),
      cwd,
      budgetMs: 5_000,
    });
    expect(out.code).toBe(1);
    expect(out.envelope).toMatchObject({ ok: false, error: { code: "APP_NOT_FOUND" } });
    expect(fake.calls()[0]!.argv).toEqual(["find", "--app", "x", "--name", "OK"]);
  });

  it("sends text on stdin, never among the arguments", async () => {
    const fake = await fakeAgentDesktop({ type: { stdout: ok("type") } });
    await runAgentDesktop(fake.program, {
      argv: ["type", "@s1:e1", "--stdin"],
      env: hostEnv(),
      cwd: await tempDir(),
      stdin: "correct horse",
      budgetMs: 5_000,
    });
    const call = fake.calls()[0]!;
    expect(call.stdin).toBe("correct horse");
    expect(call.argv.join(" ")).not.toContain("correct horse");
  });

  it("passes the desktop session's names and what the plugin sets, and nothing else", () => {
    const env = agentDesktopEnv(
      {
        PATH: "/usr/bin",
        DISPLAY: ":96",
        DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/bus",
        OPENAI_API_KEY: "sk-secret",
        PENGUIN_HOME: "/data",
        AGENT_DESKTOP_SESSION: "someone-elses",
      },
      "linux",
      { AGENT_DESKTOP_HOME: "/data/computer-use/state/sessions/s1" },
    );
    expect(env).toEqual({
      PATH: "/usr/bin",
      DISPLAY: ":96",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/bus",
      AGENT_DESKTOP_HOME: "/data/computer-use/state/sessions/s1",
    });
  });

  it("starts the program with that environment and no other", async () => {
    const fake = await fakeAgentDesktop();
    const env = agentDesktopEnv({ ...process.env, OPENAI_API_KEY: "sk-secret" }, process.platform, {
      AGENT_DESKTOP_HOME: "/state",
    });
    await runAgentDesktop(fake.program, {
      argv: ["status"],
      env,
      cwd: await tempDir(),
      budgetMs: 5_000,
    });
    const seen = fake.calls()[0]!.env;
    expect(seen.AGENT_DESKTOP_HOME).toBe("/state");
    expect(seen.OPENAI_API_KEY).toBeUndefined();
  });

  it("finds a Windows variable whatever its case, under its usual name", () => {
    const env = agentDesktopEnv({ Path: "C:\\Windows", SYSTEMROOT: "C:\\Windows" }, "win32", {});
    expect(env).toEqual({ PATH: "C:\\Windows", SystemRoot: "C:\\Windows" });
  });

  it("passes the system variables a launched app expects, and no credential", () => {
    const windows = agentDesktopEnv(
      {
        HOMEDRIVE: "C:",
        HOMEPATH: "\\Users\\ann",
        ALLUSERSPROFILE: "C:\\ProgramData",
        PUBLIC: "C:\\Users\\Public",
        COMPUTERNAME: "DESK",
        ProgramW6432: "C:\\Program Files",
        "CommonProgramFiles(x86)": "C:\\Program Files (x86)\\Common Files",
        GITHUB_TOKEN: "ghp-secret",
      },
      "win32",
      {},
    );
    expect(Object.keys(windows).sort()).toEqual(
      [
        "ALLUSERSPROFILE",
        "COMPUTERNAME",
        "CommonProgramFiles(x86)",
        "HOMEDRIVE",
        "HOMEPATH",
        "PUBLIC",
        "ProgramW6432",
      ].sort(),
    );
    const linux = agentDesktopEnv(
      {
        LANG: "zh_CN.UTF-8",
        LC_TIME: "en_GB.UTF-8",
        XDG_CONFIG_HOME: "/home/ann/.config",
        SSH_AUTH_SOCK: "/run/user/1000/ssh",
      },
      "linux",
      {},
    );
    expect(linux).toEqual({
      LANG: "zh_CN.UTF-8",
      LC_TIME: "en_GB.UTF-8",
      XDG_CONFIG_HOME: "/home/ann/.config",
    });
  });

  it("stops a program that outlives its budget and grace", async () => {
    const fake = await fakeAgentDesktop({ wait: { stdout: ok("wait"), delayMs: 5_000 } });
    const out = await runAgentDesktop(fake.program, {
      argv: ["wait", "100"],
      env: hostEnv(),
      cwd: await tempDir(),
      budgetMs: 50,
      graceMs: 100,
      killMs: 200,
    });
    expect(out.timedOut).toBe(true);
    expect(out.envelope).toBeNull();
  });

  it("reports no envelope for output that is not one, and why a program could not start", async () => {
    const fake = await fakeAgentDesktop({ version: { stdout: "agent-desktop 1.3.1\n" } });
    const cwd = await tempDir();
    const plain = await runAgentDesktop(fake.program, {
      argv: ["version"],
      env: hostEnv(),
      cwd,
      budgetMs: 5_000,
    });
    expect(plain.envelope).toBeNull();
    expect(plain.stdout).toBe("agent-desktop 1.3.1\n");
    const missing = await runAgentDesktop(
      { file: `${cwd}/no-such-program` },
      { argv: ["status"], env: hostEnv(), cwd, budgetMs: 5_000 },
    );
    expect(missing.code).toBeNull();
    expect(missing.spawnError).toMatch(/ENOENT/);
  });
});
