/**
 * Unit tests for the command-session shell resolver (pure function; platform, env and the
 * PATH probe are injected — no real shells are spawned here).
 */
import { describe, expect, it } from "vitest";
import { resolveShell } from "../src/environment/tools/command/shell.js";

const POWERSHELL_ARGS = ["-NoLogo", "-NoProfile", "-Command"];

/** A whichAll stub resolving only the given names (value = returned PATH matches). */
function which(table: Record<string, string[]>): (cmd: string) => string[] {
  return (cmd) => table[cmd] ?? [];
}

describe("resolveShell — POSIX", () => {
  it("uses bash -lc on linux without probing (today's behavior, unchanged)", () => {
    let probed = false;
    const shell = resolveShell({
      platform: "linux",
      env: {},
      whichAll: () => {
        probed = true;
        return [];
      },
    });
    expect(shell).toEqual({ command: "bash", args: ["-lc"], name: "bash" });
    expect(probed).toBe(false);
  });

  it("uses bash -lc on darwin", () => {
    const shell = resolveShell({ platform: "darwin", env: {} });
    expect(shell).toEqual({ command: "bash", args: ["-lc"], name: "bash" });
  });
});

describe("resolveShell — win32 probing", () => {
  it("prefers bash on PATH (Git for Windows)", () => {
    const shell = resolveShell({
      platform: "win32",
      env: {},
      whichAll: which({
        bash: ["C:\\Program Files\\Git\\bin\\bash.exe"],
        pwsh: ["C:\\Program Files\\PowerShell\\7\\pwsh.exe"],
      }),
    });
    expect(shell).toEqual({ command: "bash", args: ["-lc"], name: "bash" });
  });

  it("skips the WSL launcher bash under the system root and falls through to pwsh", () => {
    const shell = resolveShell({
      platform: "win32",
      env: { SystemRoot: "C:\\WINDOWS" },
      whichAll: which({
        bash: ["C:\\Windows\\System32\\bash.exe"],
        pwsh: ["C:\\Program Files\\PowerShell\\7\\pwsh.exe"],
      }),
    });
    expect(shell).toEqual({ command: "pwsh", args: POWERSHELL_ARGS, name: "pwsh" });
  });

  it("falls back to pwsh when bash is absent", () => {
    const shell = resolveShell({
      platform: "win32",
      env: {},
      whichAll: which({ pwsh: ["C:\\Program Files\\PowerShell\\7\\pwsh.exe"] }),
    });
    expect(shell).toEqual({ command: "pwsh", args: POWERSHELL_ARGS, name: "pwsh" });
  });

  it("falls back to powershell when neither bash nor pwsh resolve", () => {
    const shell = resolveShell({ platform: "win32", env: {}, whichAll: which({}) });
    expect(shell).toEqual({ command: "powershell", args: POWERSHELL_ARGS, name: "powershell" });
  });
});

describe("resolveShell — PENGUIN_SHELL override", () => {
  it("wins on every platform and keeps POSIX-style args for a POSIX shell path", () => {
    const shell = resolveShell({
      platform: "linux",
      env: { PENGUIN_SHELL: "/usr/bin/zsh" },
    });
    expect(shell).toEqual({ command: "/usr/bin/zsh", args: ["-lc"], name: "zsh" });
  });

  it("uses PowerShell-style args when the basename is pwsh (case/extension-insensitive)", () => {
    const shell = resolveShell({
      platform: "win32",
      env: { PENGUIN_SHELL: "C:\\Program Files\\PowerShell\\7\\pwsh.EXE" },
      whichAll: which({ bash: ["C:\\Program Files\\Git\\bin\\bash.exe"] }),
    });
    expect(shell).toEqual({
      command: "C:\\Program Files\\PowerShell\\7\\pwsh.EXE",
      args: POWERSHELL_ARGS,
      name: "pwsh",
    });
  });

  it("uses PowerShell-style args for a bare powershell name", () => {
    const shell = resolveShell({ platform: "win32", env: { PENGUIN_SHELL: "powershell" } });
    expect(shell).toEqual({ command: "powershell", args: POWERSHELL_ARGS, name: "powershell" });
  });

  it("uses cmd-style args when the basename is cmd", () => {
    const shell = resolveShell({ platform: "win32", env: { PENGUIN_SHELL: "cmd" } });
    expect(shell).toEqual({ command: "cmd", args: ["/d", "/s", "/c"], name: "cmd" });
  });

  it("ignores a blank PENGUIN_SHELL", () => {
    const shell = resolveShell({ platform: "linux", env: { PENGUIN_SHELL: "  " } });
    expect(shell).toEqual({ command: "bash", args: ["-lc"], name: "bash" });
  });
});

describe("resolveShell — the bundled MinGit bash (PENGUIN_BUNDLED_SHELL)", () => {
  const BUNDLED = "C:\\Users\\u\\.penguin\\git\\usr\\bin\\sh.exe";
  /** An exists() stub answering true only for the bundled path. */
  const bundledExists = (p: string) => p === BUNDLED;

  it("is used when the machine has no bash of its own, and reports itself as bash", () => {
    // MinGit installs GNU bash under the name `sh`; the model is told "bash" because that is
    // what it is and what the Skill ecosystem targets — "sh" would understate it.
    const shell = resolveShell({
      platform: "win32",
      env: { PENGUIN_BUNDLED_SHELL: BUNDLED },
      whichAll: which({ pwsh: ["C:\\pwsh.exe"] }),
      exists: bundledExists,
    });
    expect(shell).toEqual({ command: BUNDLED, args: ["-lc"], name: "bash" });
  });

  it("yields to a real Git for Windows on PATH (its MSYS userland is the fuller one)", () => {
    const shell = resolveShell({
      platform: "win32",
      env: { PENGUIN_BUNDLED_SHELL: BUNDLED },
      whichAll: which({ bash: ["C:\\Program Files\\Git\\bin\\bash.exe"] }),
      exists: bundledExists,
    });
    expect(shell).toEqual({ command: "bash", args: ["-lc"], name: "bash" });
  });

  it("beats pwsh and powershell — the point of bundling is that neither is reached", () => {
    const shell = resolveShell({
      platform: "win32",
      env: { PENGUIN_BUNDLED_SHELL: BUNDLED },
      whichAll: which({ pwsh: ["C:\\pwsh.exe"], powershell: ["C:\\powershell.exe"] }),
      exists: bundledExists,
    });
    expect(shell.command).toBe(BUNDLED);
  });

  it("still loses to an explicit PENGUIN_SHELL", () => {
    const shell = resolveShell({
      platform: "win32",
      env: { PENGUIN_SHELL: "pwsh", PENGUIN_BUNDLED_SHELL: BUNDLED },
      exists: bundledExists,
    });
    expect(shell).toEqual({ command: "pwsh", args: POWERSHELL_ARGS, name: "pwsh" });
  });

  it("a stale path (dir deleted) falls through to pwsh rather than spawning a missing exe", () => {
    const shell = resolveShell({
      platform: "win32",
      env: { PENGUIN_BUNDLED_SHELL: BUNDLED },
      whichAll: which({ pwsh: ["C:\\pwsh.exe"] }),
      exists: () => false,
    });
    expect(shell).toEqual({ command: "pwsh", args: POWERSHELL_ARGS, name: "pwsh" });
  });

  it("is ignored on POSIX (npm installs and source checkouts never set it anyway)", () => {
    const shell = resolveShell({
      platform: "linux",
      env: { PENGUIN_BUNDLED_SHELL: BUNDLED },
      exists: bundledExists,
    });
    expect(shell).toEqual({ command: "bash", args: ["-lc"], name: "bash" });
  });

  it("a blank value is ignored (unset-but-defined shims must not win)", () => {
    const shell = resolveShell({
      platform: "win32",
      env: { PENGUIN_BUNDLED_SHELL: "  " },
      whichAll: which({ powershell: ["C:\\powershell.exe"] }),
      exists: () => true,
    });
    expect(shell.name).toBe("powershell");
  });
});
