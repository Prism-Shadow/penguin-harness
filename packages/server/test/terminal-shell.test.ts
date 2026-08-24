/**
 * Shell selection for interactive terminals. The rule under test is the one that broke on
 * Windows: the shell a terminal opens must run the user's profile, and %ComSpec% (cmd.exe)
 * never does.
 */
import { describe, expect, it } from "vitest";
import { resolveDefaultShell, shellArgs } from "../src/terminal/shell.js";

const NO_PATH = { onPath: () => false };
const HAS = (...names: string[]) => ({ onPath: (cmd: string) => names.includes(cmd) });

describe("resolveDefaultShell", () => {
  it("takes the user's login shell on POSIX", () => {
    expect(resolveDefaultShell({ SHELL: "/bin/zsh" }, "linux")).toBe("/bin/zsh");
    expect(resolveDefaultShell({}, "darwin")).toBe("/bin/sh");
  });

  it("prefers PowerShell over cmd.exe on Windows, since cmd reads no profile", () => {
    const env = { ComSpec: "C:\\Windows\\System32\\cmd.exe" };
    expect(resolveDefaultShell(env, "win32", HAS("pwsh", "powershell"))).toBe("pwsh.exe");
    expect(resolveDefaultShell(env, "win32", HAS("powershell"))).toBe("powershell.exe");
  });

  it("falls back to %ComSpec% only when no PowerShell is installed", () => {
    expect(resolveDefaultShell({ ComSpec: "C:\\cmd.exe" }, "win32", NO_PATH)).toBe("C:\\cmd.exe");
    expect(resolveDefaultShell({}, "win32", NO_PATH)).toBe("C:\\Windows\\System32\\cmd.exe");
  });

  it("honours PENGUIN_SHELL on every platform, without probing", () => {
    const env = { PENGUIN_SHELL: "C:\\Program Files\\Git\\bin\\bash.exe", SHELL: "/bin/zsh" };
    const explode = {
      onPath: (): boolean => {
        throw new Error("must not probe");
      },
    };
    expect(resolveDefaultShell(env, "win32", explode)).toBe(env.PENGUIN_SHELL);
    expect(resolveDefaultShell(env, "linux", explode)).toBe(env.PENGUIN_SHELL);
  });
});

describe("shellArgs", () => {
  it("makes POSIX shells login shells, so the profile chain runs", () => {
    expect(shellArgs("/bin/zsh")).toEqual(["-l"]);
    expect(shellArgs("C:\\Program Files\\Git\\bin\\bash.exe")).toEqual(["-l"]);
  });

  it("passes PowerShell no -l (an error there) and no -NoProfile", () => {
    for (const shell of ["pwsh.exe", "powershell.EXE", "C:\\pwsh\\pwsh.exe"]) {
      expect(shellArgs(shell)).toEqual(["-NoLogo"]);
    }
  });

  it("passes cmd.exe nothing, having neither concept", () => {
    expect(shellArgs("C:\\Windows\\System32\\cmd.exe")).toEqual([]);
  });
});
