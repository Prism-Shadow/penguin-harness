/**
 * Unit tests for putting a directory at the front of PATH: the child-environment half
 * (pure), the per-shell command statement (pure), and one real `bash -lc` spawn proving the
 * statement actually decides which of two same-named executables a command resolves.
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  pathPrependPrefix,
  prependPathEnv,
} from "../src/environment/tools/command/path-prepend.js";

describe("prependPathEnv", () => {
  it("puts the directories in front of the inherited PATH, in order", () => {
    const env = prependPathEnv({ PATH: "/usr/bin:/bin" }, ["/a", "/b"]);
    expect(env.PATH).toBe(`/a${path.delimiter}/b${path.delimiter}/usr/bin:/bin`);
  });

  it("does not touch the environment it was given", () => {
    const original = { PATH: "/usr/bin" };
    prependPathEnv(original, ["/a"]);
    expect(original.PATH).toBe("/usr/bin");
  });

  it("writes back through the entry's OWN spelling, so Windows does not end up with two", () => {
    // Windows resolves environment names case-insensitively but stores the casing it was
    // given: writing `PATH` beside an inherited `Path` would leave the child with two
    // entries and no say in which one it reads.
    const env = prependPathEnv({ Path: "C:\\Windows", SystemRoot: "C:\\Windows" }, ["C:\\shim"]);
    expect(env.Path).toBe(`C:\\shim${path.delimiter}C:\\Windows`);
    expect(env.PATH).toBeUndefined();
  });

  it("sets PATH when the environment carries none, or an empty one", () => {
    expect(prependPathEnv({}, ["/a"]).PATH).toBe("/a");
    expect(prependPathEnv({ PATH: "" }, ["/a"]).PATH).toBe("/a");
  });

  it("an empty list changes nothing", () => {
    expect(prependPathEnv({ PATH: "/usr/bin" }, []).PATH).toBe("/usr/bin");
  });
});

describe("pathPrependPrefix", () => {
  it("Bourne-family shells get an `export`, with the directory quoted", () => {
    for (const shell of ["bash", "sh", "zsh", "dash", "ksh", "ash", "mksh", "ksh93"]) {
      expect(pathPrependPrefix(shell, ["/opt/penguin/bin"]), shell).toBe(
        `export PATH='/opt/penguin/bin':"$PATH"; `,
      );
    }
  });

  it("several directories keep their order, each its own quoted word", () => {
    expect(pathPrependPrefix("bash", ["/a", "/b"])).toBe(`export PATH='/a':'/b':"$PATH"; `);
  });

  it("a quote in the directory cannot break out of the word", () => {
    expect(pathPrependPrefix("bash", ["/home/anne's/bin"])).toBe(
      `export PATH='/home/anne'\\''s/bin':"$PATH"; `,
    );
  });

  it("pwsh and powershell get an $env:PATH assignment with `;` as the separator", () => {
    for (const shell of ["pwsh", "powershell"]) {
      expect(pathPrependPrefix(shell, ["C:\\shim"]), shell).toBe(
        `$env:PATH = 'C:\\shim' + ';' + $env:PATH; `,
      );
    }
    // PowerShell escapes a quote inside a literal by doubling it.
    expect(pathPrependPrefix("pwsh", ["C:\\it's"])).toBe(
      `$env:PATH = 'C:\\it''s' + ';' + $env:PATH; `,
    );
  });

  it("cmd gets a `set` joined with && so the command still reports its own errorlevel", () => {
    expect(pathPrependPrefix("cmd", ["C:\\shim"])).toBe(`set "PATH=C:\\shim;%PATH%" && `);
  });

  it("a shell whose PATH syntax is not one of those gets nothing at all", () => {
    // fish has no `export`; an unrecognized PENGUIN_SHELL basename is anyone's guess. A
    // prefix in the wrong dialect would fail every command, so neither gets one — the
    // child-environment prepend still applies to both.
    expect(pathPrependPrefix("fish", ["/a"])).toBe("");
    expect(pathPrependPrefix("nu", ["/a"])).toBe("");
  });

  it("an empty list produces no prefix for any shell", () => {
    for (const shell of ["bash", "pwsh", "cmd", "fish"]) {
      expect(pathPrependPrefix(shell, []), shell).toBe("");
    }
  });
});

describe.skipIf(process.platform === "win32")(
  "the Bourne prefix decides which executable a command resolves",
  () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "penguin-path-prepend-"));
    const shimDir = path.join(tmp, "shim");
    const globalDir = path.join(tmp, "global");

    for (const [dir, word] of [
      [shimDir, "shim"],
      [globalDir, "global"],
    ] as const) {
      mkdirSync(dir, { recursive: true });
      const script = path.join(dir, "penguin");
      writeFileSync(script, `#!/bin/sh\necho ${word}\nexit 7\n`);
      chmodSync(script, 0o755);
    }

    afterAll(() => rmSync(tmp, { recursive: true, force: true }));

    /** Runs `cmd` the way a command session does: the resolved shell, `-lc`, one string. */
    function run(cmd: string, dirs: string[]): { stdout: string; status: number | null } {
      const res = spawnSync("bash", ["-lc", pathPrependPrefix("bash", dirs) + cmd], {
        env: { ...process.env, PATH: `${globalDir}${path.delimiter}${process.env.PATH ?? ""}` },
        encoding: "utf8",
      });
      return { stdout: res.stdout, status: res.status };
    }

    it("the child environment alone does not decide it", () => {
      // `-lc` reads the login profile, which is free to rewrite PATH over whatever the
      // child environment carried — on a Debian-family box /etc/profile replaces it
      // outright, so the shim directory is not merely demoted, it is gone. Whatever the
      // profile did, what a bare command resolves is not the harness's copy.
      expect(run("penguin", []).stdout.trim()).not.toBe("shim");
    });

    it("with the prefix the prepended directory wins, however the profile left PATH", () => {
      expect(run("penguin", [shimDir]).stdout.trim()).toBe("shim");
    });

    it("the command's own stdout and exit status pass through untouched", () => {
      const res = run("penguin", [shimDir]);
      expect(res.stdout.trim()).toBe("shim");
      // The prefix is a statement, not a wrapper: the command is still last, so the shell
      // reports ITS status.
      expect(res.status).toBe(7);
    });
  },
);
