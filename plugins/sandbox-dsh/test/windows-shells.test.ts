/**
 * Which session shells the adaptor lets through to DSH's Windows ACL runner. The unit half
 * runs everywhere (the platform and the session shell are injected); the live half runs only on
 * a Windows host whose ACL chain is usable, against the real runner — the host the refusal
 * exists for.
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { CommandSessionManager } from "@prismshadow/penguin-core";
import type { SandboxProvider } from "@prismshadow/penguin-core/plugin";
import {
  assertAclRunnerCanStart,
  assertSessionShellConfinable,
  hostSessionShell,
  loadDshAdaptor,
} from "../src/index.js";

const REFUSED = /sandbox-dsh cannot confine .* PENGUIN_SHELL=pwsh .* PENGUIN_SHELL=powershell/;

describe("assertAclRunnerCanStart", () => {
  it.each([
    "bash",
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\BASH.EXE",
    "C:\\Users\\u\\AppData\\Local\\penguin\\git\\usr\\bin\\sh.exe",
    "C:\\Windows\\System32\\bash.exe",
    // Other shells on the same MSYS runtime abort the same way.
    "zsh",
    "dash.exe",
    "C:\\Program Files\\Git\\git-bash.exe",
    "C:\\msys64\\usr\\bin\\fish.exe",
    // Any program in an MSYS usr\bin links that runtime, whatever its name.
    "C:\\msys64\\usr\\bin\\tcsh.exe",
    "C:/Program Files/Git/usr/bin/env.exe",
  ])("refuses %s on Windows, naming the setting that fixes it", (program) => {
    expect(() => assertAclRunnerCanStart([program, "-lc", "echo hi"], "win32")).toThrow(REFUSED);
  });

  it.each([
    "pwsh",
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    "cmd",
    // Git for Windows' own git is a native MinGW build, not an MSYS one.
    "C:\\Program Files\\Git\\mingw64\\bin\\git.exe",
    "C:\\Program Files\\nodejs\\node.exe",
  ])("lets %s through on Windows", (program) => {
    expect(() => assertAclRunnerCanStart([program, "-Command", "'hi'"], "win32")).not.toThrow();
  });

  it("is Windows-only: bash is the shell every other rung runs", () => {
    expect(() => assertAclRunnerCanStart(["bash", "-lc", "echo hi"], "linux")).not.toThrow();
    expect(() => assertAclRunnerCanStart(["/bin/bash", "-lc", "echo hi"], "darwin")).not.toThrow();
  });

  // The same confine() carries a stdio MCP Server's launch command, which PENGUIN_SHELL does not
  // choose; only the session shell itself is pointed at that setting.
  it.each(["bash", "C:\\Program Files\\Git\\usr\\bin\\sh.exe"])(
    "refuses bash that is not the session shell without naming PENGUIN_SHELL (%s)",
    (program) => {
      let message = "";
      try {
        assertAclRunnerCanStart([program, "-c", "node server.js"], "win32", { command: "pwsh" });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toMatch(
        /cannot confine .* its ACL runner does not start bash, sh or any other MSYS-runtime program/,
      );
      expect(message).not.toContain("PENGUIN_SHELL");
    },
  );

  it("names PENGUIN_SHELL when the refused program is the session shell", () => {
    const bundled = "C:\\Users\\u\\AppData\\Local\\penguin\\git\\usr\\bin\\sh.exe";
    expect(() =>
      assertAclRunnerCanStart([bundled, "-lc", "echo hi"], "win32", { command: bundled }),
    ).toThrow(REFUSED);
  });
});

describe("the session shell check", () => {
  it.each([
    "bash",
    "sh",
    "zsh",
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Users\\u\\AppData\\Local\\penguin\\git\\usr\\bin\\sh.exe",
    "C:\\msys64\\usr\\bin\\dash.exe",
  ])(
    "fails the backend's load on Windows under %s, naming the setting that fixes it",
    async (command) => {
      // Refused before any DSH module loads, so this runs on every host.
      await expect(
        loadDshAdaptor({ platform: "win32", sessionShell: { command } }),
      ).rejects.toThrow(REFUSED);
    },
  );

  it.each(["pwsh", "powershell", "C:\\Program Files\\PowerShell\\7\\pwsh.exe"])(
    "passes %s on Windows",
    (command) => {
      expect(() => assertSessionShellConfinable({ command }, "win32")).not.toThrow();
    },
  );

  it("is Windows-only", () => {
    expect(() => assertSessionShellConfinable({ command: "bash" }, "linux")).not.toThrow();
    expect(() => assertSessionShellConfinable({ command: "/bin/sh" }, "darwin")).not.toThrow();
  });

  it("checks nothing when the host core does not export the session shell (an older runtime)", async () => {
    expect(await hostSessionShell(async () => ({ Bind: () => {} }))).toBeNull();
    expect(
      await hostSessionShell(() => Promise.reject(new Error("Cannot find package"))),
    ).toBeNull();
    expect(() => assertSessionShellConfinable(null, "win32")).not.toThrow();
  });

  it("reads the session shell from the host core's plugin contract", async () => {
    expect(
      await hostSessionShell(async () => ({ sessionShell: () => ({ command: "sh" }) })),
    ).toEqual({ command: "sh" });
    // The real specifier, as this checkout's core resolves it: the export is there.
    expect(typeof (await hostSessionShell())?.command).toBe("string");
  });
});

const win32 = process.platform === "win32";
const ws = mkdtempSync(path.join(tmpdir(), "penguin-dsh-shells-"));
// Loaded as on a host core without the session shell: the load check is skipped, so the suite
// reaches the runner — and the per-command refusal — whatever this host's session shell is.
const provider: SandboxProvider | null = win32
  ? await loadDshAdaptor({ sessionShell: null }).catch(() => null)
  : null;
// The gate hands over an absolute program: it measures whether the runner confines, not
// whether a bare name resolves.
const usable =
  provider !== null &&
  (() => {
    try {
      provider.confine([process.execPath], { mode: "workspace-write", workspaceRoot: ws });
      return true;
    } catch {
      return false;
    }
  })();

afterAll(() => {
  rmSync(ws, { recursive: true, force: true });
});

describe.skipIf(!usable)("the real ACL runner (Windows, host-gated)", () => {
  it("a bash session shell is refused before the runner, with the fix named", async () => {
    // The backend's load names the fix — the Session view's reason for the unavailable tier.
    await expect(loadDshAdaptor({ sessionShell: { command: "bash" } })).rejects.toThrow(REFUSED);
    // And per command, on this host's real platform, before the runner is involved.
    expect(() =>
      provider!.confine(["bash", "-lc", "echo hi"], { mode: "workspace-write", workspaceRoot: ws }),
    ).toThrow(REFUSED);
  });

  it("the harness's default shell is refused through the product path", async (ctx) => {
    const shell = await hostSessionShell();
    // A host whose PENGUIN_SHELL already names a PowerShell has nothing to refuse.
    if (!/^(bash|sh)(\.exe)?$/i.test(path.win32.basename(shell?.command ?? ""))) ctx.skip();
    await expect(loadDshAdaptor()).rejects.toThrow(REFUSED);
    const mgr = new CommandSessionManager({
      confineSpawn: () => (argv, opts) =>
        provider!.confine(argv, { mode: "workspace-write", workspaceRoot: opts.workspaceDir }),
      workspaceDir: ws,
    });
    try {
      expect(() => mgr.spawn({ cmd: "echo hi", cwd: ws }).kill()).toThrow(REFUSED);
    } finally {
      mgr.dispose();
    }
  });

  // What the refusal points at: both PowerShells run confined — a write inside the Workspace
  // lands, a write outside it is denied. Windows PowerShell 5.1 ships with Windows; pwsh is
  // an install, so its leg skips where it is absent.
  const pwshInstalled = win32 && spawnSync("where", ["pwsh"], { windowsHide: true }).status === 0;
  it.for([
    ["powershell", true],
    ["pwsh", pwshInstalled],
  ] as const)("%s runs confined", ([shell, present], ctx) => {
    if (!present) ctx.skip();
    const outside = path.join(homedir(), `penguin-dsh-shells-${shell}-${process.pid}.txt`);
    const inside = `${shell}-inside.txt`;
    try {
      const body = `Set-Content -LiteralPath ${inside} -Value ok; try { Set-Content -LiteralPath '${outside}' -Value leak -ErrorAction Stop } catch { $_.Exception.Message }`;
      const confined = provider!.confine([shell, "-NoLogo", "-NoProfile", "-Command", body], {
        mode: "workspace-write",
        workspaceRoot: ws,
      });
      const r = spawnSync(confined.argv[0]!, confined.argv.slice(1), {
        cwd: ws,
        env: { ...process.env, ...confined.env },
        encoding: "utf8",
        timeout: 60_000,
        windowsHide: true,
      });
      expect(r.status).toBe(0);
      expect(existsSync(path.join(ws, inside))).toBe(true);
      expect(existsSync(outside)).toBe(false);
      expect(r.stdout).toMatch(/access to the path .* is denied/i);
    } finally {
      rmSync(outside, { force: true });
    }
  });
});
