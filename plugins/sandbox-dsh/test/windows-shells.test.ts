// Which session shells the adaptor lets through to DSH's Windows ACL runner. Unit cases inject
// the platform and shell; the live half needs a Windows host whose runner is usable.
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import type { ConfinedArgv } from "@prismshadow/penguin-core/plugin";
import {
  assertAclRunnerCanStart as check,
  assertSessionShellConfinable,
  hostSessionShell,
  loadDshAdaptor,
} from "../src/index.js";

const REFUSED = /sandbox-dsh cannot confine .* PENGUIN_SHELL=pwsh .* PENGUIN_SHELL=powershell/;
const BASH = "C:\\Program Files\\Git\\usr\\bin\\BASH.EXE";

describe("the Windows session shell check", () => {
  // Any MSYS-runtime program aborts under the runner: its shells by name, anything in usr\bin.
  it.each(["bash", BASH, "dash.exe", "C:/msys64/usr/bin/env.exe"])("refuses %s", (program) =>
    expect(() => check([program], "win32")).toThrow(REFUSED),
  );

  it.each(["pwsh", "C:\\Program Files\\Git\\mingw64\\bin\\git.exe"])("passes %s", (program) =>
    expect(() => check([program], "win32")).not.toThrow(),
  );

  it("names PENGUIN_SHELL only when the refused program is the session shell", () => {
    // An MCP Server's launch command goes through the same confine(); PENGUIN_SHELL does not pick it.
    const mcp = () => check(["bash", "-c", "node s.js"], "win32", { command: "pwsh" });
    expect(mcp).toThrow(/does not start bash, sh or any other MSYS-runtime program/);
    expect(mcp).not.toThrow(/PENGUIN_SHELL/);
    expect(() => check([BASH], "win32", { command: BASH })).toThrow(REFUSED);
  });

  it("fails the backend's load on Windows under an MSYS shell, before DSH loads", async () => {
    const load = loadDshAdaptor({ platform: "win32", sessionShell: { command: "sh" } });
    await expect(load).rejects.toThrow(REFUSED);
  });

  it("passes a PowerShell, any shell off Windows, and a host core without the export", () => {
    expect(() => assertSessionShellConfinable({ command: "pwsh" }, "win32")).not.toThrow();
    expect(() => assertSessionShellConfinable({ command: "bash" }, "linux")).not.toThrow();
    expect(() => check(["bash"], "linux")).not.toThrow();
    expect(() => assertSessionShellConfinable(null, "win32")).not.toThrow();
  });

  it("reads the session shell from the host core, null when it has none", async () => {
    const shell = { command: "sh" };
    expect(await hostSessionShell(async () => ({ sessionShell: () => shell }))).toEqual(shell);
    expect(await hostSessionShell(async () => ({}))).toBeNull();
    expect(await hostSessionShell(() => Promise.reject(new Error("no package")))).toBeNull();
    expect(typeof (await hostSessionShell())?.command).toBe("string");
  });
});

const ws = mkdtempSync(path.join(tmpdir(), "penguin-dsh-shells-"));
afterAll(() => rmSync(ws, { recursive: true, force: true }));
// Loaded as on a host core without the session shell, so the suite reaches the per-command check.
const provider =
  process.platform === "win32"
    ? await loadDshAdaptor({ sessionShell: null }).catch(() => null)
    : null;
const confine = (argv: string[]): ConfinedArgv =>
  provider!.confine(argv, { mode: "workspace-write", workspaceRoot: ws });
const run = (c: ConfinedArgv, cwd = ws) =>
  spawnSync(c.argv[0]!, c.argv.slice(1), {
    cwd,
    env: { ...process.env, ...c.env },
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
// The gate hands over an absolute program: it measures whether the runner confines at all.
const usable = await Promise.resolve(provider)
  .then((p) => p !== null && Boolean(confine([process.execPath])))
  .catch(() => false);

describe.skipIf(!usable)("the real ACL runner (Windows, host-gated)", () => {
  // What the refusal points at: both PowerShells write inside the Workspace and are denied outside.
  const pwsh = spawnSync("where", ["pwsh"], { windowsHide: true }).status === 0;
  it.each(["powershell", ...(pwsh ? ["pwsh"] : [])])("%s runs confined", (shell) => {
    const outside = path.join(homedir(), `penguin-dsh-shells-${shell}-${process.pid}.txt`);
    try {
      const body = `Set-Content -LiteralPath in-${shell}.txt -Value ok; try { Set-Content -LiteralPath '${outside}' -Value leak -ErrorAction Stop } catch { $_.Exception.Message }`;
      const r = run(confine([shell, "-NoLogo", "-NoProfile", "-Command", body]));
      expect(r.status).toBe(0);
      expect(existsSync(path.join(ws, `in-${shell}.txt`))).toBe(true);
      expect(existsSync(outside)).toBe(false);
      expect(r.stdout).toMatch(/access to the path .* is denied/i);
    } finally {
      rmSync(outside, { force: true });
    }
  });
});
