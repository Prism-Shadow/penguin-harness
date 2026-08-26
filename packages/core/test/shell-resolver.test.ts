/**
 * Unit tests for the command-session shell resolver (pure function; platform, env and the
 * existence/PATH probes are injected) plus one real spawn proving the POSIX fallback
 * chain resolves to something that actually runs a command.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveShell } from "../src/environment/tools/command/shell.js";

const POWERSHELL_ARGS = ["-NoLogo", "-NoProfile", "-Command"];

/** A whichAll stub resolving only the given names (value = returned PATH matches). */
function which(table: Record<string, string[]>): (cmd: string) => string[] {
  return (cmd) => table[cmd] ?? [];
}

/** An exists stub answering true for exactly the listed absolute paths. */
function has(...paths: string[]): (filePath: string) => boolean {
  const set = new Set(paths);
  return (filePath) => set.has(filePath);
}

describe("resolveShell — POSIX", () => {
  it("uses bash -lc on linux without probing (today's behavior, unchanged)", () => {
    let probed = false;
    const shell = resolveShell({
      platform: "linux",
      env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
      exists: has("/usr/bin/bash"),
      whichAll: () => {
        probed = true;
        return [];
      },
    });
    // A bare name, not the resolved path: the child resolves it against its own PATH.
    expect(shell).toEqual({ command: "bash", args: ["-lc"], name: "bash" });
    // The POSIX branch must never cost a subprocess — it walks PATH itself.
    expect(probed).toBe(false);
  });

  it("uses bash -lc on darwin", () => {
    const shell = resolveShell({
      platform: "darwin",
      env: { PATH: "/usr/bin:/bin" },
      exists: has("/bin/bash"),
    });
    expect(shell).toEqual({ command: "bash", args: ["-lc"], name: "bash" });
  });

  // A GUI-launched desktop app inherits the session's PATH, not a login shell's. When
  // that PATH omits bash, spawn("bash") dies with ENOENT before the command runs — every
  // exec_command on that machine, from every surface. The chain below is what stops it.
  it("falls back to an absolute bash when PATH omits it (the GUI-launch PATH)", () => {
    const shell = resolveShell({
      platform: "linux",
      env: { PATH: "/usr/games:/snap/bin" },
      exists: has("/bin/bash", "/bin/sh"),
    });
    expect(shell).toEqual({ command: "/bin/bash", args: ["-lc"], name: "bash" });
  });

  it("finds a Homebrew bash on a macOS PATH that has none", () => {
    const shell = resolveShell({
      platform: "darwin",
      env: { PATH: "/usr/sbin:/sbin" },
      exists: has("/opt/homebrew/bin/bash"),
    });
    expect(shell).toEqual({ command: "/opt/homebrew/bin/bash", args: ["-lc"], name: "bash" });
  });

  it("uses the user's own login shell when no bash exists anywhere", () => {
    const shell = resolveShell({
      platform: "linux",
      env: { PATH: "/usr/bin:/bin", SHELL: "/usr/bin/zsh" },
      exists: has("/usr/bin/zsh", "/bin/sh"),
    });
    // Named honestly: the model is told zsh, because that is the syntax it must write.
    expect(shell).toEqual({ command: "/usr/bin/zsh", args: ["-lc"], name: "zsh" });
  });

  it("skips a $SHELL that is not a shell at all", () => {
    // A service account's login shell field is routinely /usr/sbin/nologin or /bin/false.
    // Both exist; neither runs a command, and `-lc` would make every command exit silently.
    for (const login of ["/usr/sbin/nologin", "/bin/false"]) {
      const shell = resolveShell({
        platform: "linux",
        env: { PATH: "/usr/games", SHELL: login },
        exists: has(login, "/bin/sh"),
      });
      expect(shell).toEqual({ command: "/bin/sh", args: ["-lc"], name: "sh" });
    }
  });

  it("falls back to sh when there is neither a bash nor a usable $SHELL", () => {
    const shell = resolveShell({
      platform: "linux",
      env: { PATH: "/usr/games" },
      exists: has("/bin/sh"),
    });
    expect(shell).toEqual({ command: "/bin/sh", args: ["-lc"], name: "sh" });
  });

  it("prefers an sh on PATH over the absolute one", () => {
    const shell = resolveShell({
      platform: "linux",
      env: { PATH: "/busybox/bin" },
      exists: has("/busybox/bin/sh", "/bin/sh"),
    });
    expect(shell).toEqual({ command: "sh", args: ["-lc"], name: "sh" });
  });

  it("keeps the historical bash invocation when nothing at all resolves", () => {
    const shell = resolveShell({
      platform: "linux",
      env: { PATH: "/nowhere" },
      exists: () => false,
    });
    expect(shell).toEqual({ command: "bash", args: ["-lc"], name: "bash" });
  });

  it("PENGUIN_SHELL still wins over the whole POSIX chain", () => {
    const shell = resolveShell({
      platform: "linux",
      env: { PENGUIN_SHELL: "/usr/bin/fish", PATH: "/bin" },
      exists: has("/bin/bash"),
    });
    expect(shell).toEqual({ command: "/usr/bin/fish", args: ["-lc"], name: "fish" });
  });
});

describe("resolveShell — POSIX, real spawn", () => {
  /** A PATH directory carrying a POSIX sh and a few coreutils, but deliberately no bash. */
  function bashlessBin(): string {
    const bin = path.join(mkdtempSync(path.join(tmpdir(), "penguin-nobash-")), "bin");
    mkdirSync(bin);
    for (const tool of ["sh", "env", "cat", "echo", "printf"]) {
      try {
        symlinkSync(`/bin/${tool}`, path.join(bin, tool));
      } catch {
        // A tool this box does not have; the shell itself is what matters.
      }
    }
    return bin;
  }

  it.skipIf(process.platform === "win32")(
    "resolves to a shell that really runs a command when PATH has no bash",
    () => {
      const bin = bashlessBin();
      const shell = resolveShell({ platform: process.platform, env: { PATH: bin } });
      const res = spawnSync(shell.command, [...shell.args, "echo test"], {
        env: { PATH: bin },
        encoding: "utf8",
      });
      // Before the fallback chain this was spawn("bash") against a bashless PATH:
      // res.error was `spawn bash ENOENT` and the command never ran.
      expect(res.error).toBeUndefined();
      expect(res.stdout).toContain("test");
    },
  );
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
    const shell = resolveShell({
      platform: "linux",
      env: { PENGUIN_SHELL: "  ", PATH: "/usr/bin:/bin" },
      exists: has("/bin/bash"),
    });
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
