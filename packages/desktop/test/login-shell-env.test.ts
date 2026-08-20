/**
 * Login-shell environment import (#351): the pure parts (launch gate, dump parsing,
 * fill-missing merge) everywhere, and the probe orchestration against fake shell
 * scripts where a POSIX /bin/sh exists (skipped on Windows, where the import never
 * runs anyway).
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  applyLoginShellEnv,
  mergeLoginShellEnv,
  parseLoginShellEnvDump,
  probeShell,
  resolveLoginShellEnv,
  shouldImportLoginShellEnv,
} from "../src/login-shell-env.js";

const SENTINEL = "__PENGUIN_LOGIN_SHELL_ENV__";

describe("shouldImportLoginShellEnv", () => {
  it("imports only on a GUI launch of a POSIX platform", () => {
    expect(shouldImportLoginShellEnv({ platform: "darwin", env: {} })).toBe(true);
    expect(shouldImportLoginShellEnv({ platform: "linux", env: {} })).toBe(true);
    expect(shouldImportLoginShellEnv({ platform: "win32", env: {} })).toBe(false);
  });

  it("skips a terminal launch (TERM set) — that environment is already the shell's", () => {
    expect(shouldImportLoginShellEnv({ platform: "darwin", env: { TERM: "xterm-256color" } })).toBe(
      false,
    );
  });

  it("honors the PENGUIN_NO_LOGIN_SHELL_ENV escape hatch", () => {
    expect(
      shouldImportLoginShellEnv({ platform: "linux", env: { PENGUIN_NO_LOGIN_SHELL_ENV: "1" } }),
    ).toBe(false);
  });
});

describe("probeShell", () => {
  it("uses an absolute $SHELL and falls back per platform otherwise", () => {
    expect(probeShell("/usr/local/bin/fish", "linux")).toBe("/usr/local/bin/fish");
    expect(probeShell(undefined, "darwin")).toBe("/bin/zsh");
    expect(probeShell(undefined, "linux")).toBe("/bin/bash");
    expect(probeShell("zsh", "linux")).toBe("/bin/bash");
  });
});

describe("parseLoginShellEnvDump", () => {
  const frame = (dump: string): string => `${SENTINEL}${dump}${SENTINEL}`;

  it("parses NUL-separated entries, keeping values that contain newlines", () => {
    const parsed = parseLoginShellEnvDump(frame("A=1\0MULTI=line1\nline2\0PATH=/usr/bin:/bin\0"));
    expect(parsed).toEqual({ A: "1", MULTI: "line1\nline2", PATH: "/usr/bin:/bin" });
  });

  it("ignores rc-file noise outside the frame, including output after the close", () => {
    const parsed = parseLoginShellEnvDump(`motd banner\n${frame("KEY=value\0")}\nzlogout says bye`);
    expect(parsed).toEqual({ KEY: "value" });
  });

  it("closes the frame at the next sentinel, not the last one", () => {
    // A zlogout that echoes the sentinel again must not extend the frame.
    const parsed = parseLoginShellEnvDump(`${frame("K=v\0")}noise ${SENTINEL}`);
    expect(parsed).toEqual({ K: "v" });
  });

  it("drops malformed entries and non-POSIX names (exported bash functions)", () => {
    const parsed = parseLoginShellEnvDump(
      frame("=nokey\0noequals\0BASH_FUNC_f%%=() { :; }\0OK=1\0"),
    );
    expect(parsed).toEqual({ OK: "1" });
  });

  it("returns null without a frame or without a single valid entry", () => {
    expect(parseLoginShellEnvDump("no sentinels at all")).toBeNull();
    expect(parseLoginShellEnvDump(`${SENTINEL}unclosed`)).toBeNull();
    // `env` without -0 support prints nothing between the frames.
    expect(parseLoginShellEnvDump(frame(""))).toBeNull();
  });
});

describe("mergeLoginShellEnv", () => {
  it("fills only variables the current environment leaves unset", () => {
    const patch = mergeLoginShellEnv(
      { PRESENT: "keep" },
      { PRESENT: "ignored", ANTHROPIC_API_KEY: "sk-from-zshrc" },
    );
    expect(patch).toEqual({ ANTHROPIC_API_KEY: "sk-from-zshrc" });
  });

  it("never imports the excluded bookkeeping keys", () => {
    const patch = mergeLoginShellEnv(
      {},
      {
        _: "/usr/bin/env",
        SHLVL: "2",
        PWD: "/home/user",
        OLDPWD: "/",
        TERM: "dumb",
        ELECTRON_RUN_AS_NODE: "1",
        KEEP: "yes",
      },
    );
    expect(patch).toEqual({ KEEP: "yes" });
  });

  it("merges PATH with the login shell's ordering first and current-only entries appended", () => {
    const patch = mergeLoginShellEnv(
      { PATH: "/usr/bin:/bin:/only/current" },
      { PATH: "/home/user/.local/bin:/usr/bin:/bin" },
    );
    expect(patch["PATH"]).toBe("/home/user/.local/bin:/usr/bin:/bin:/only/current");
  });

  it("adopts the imported PATH outright when none is set, and leaves an equal PATH alone", () => {
    expect(mergeLoginShellEnv({}, { PATH: "/a:/b" })).toEqual({ PATH: "/a:/b" });
    expect(mergeLoginShellEnv({ PATH: "/a:/b" }, { PATH: "/a:/b" })).toEqual({});
  });
});

describe.skipIf(process.platform === "win32")("resolveLoginShellEnv (fake shells)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "penguin-login-shell-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function fakeShell(name: string, script: string): string {
    const file = path.join(dir, name);
    writeFileSync(file, `#!/bin/sh\n${script}\n`);
    chmodSync(file, 0o755);
    return file;
  }

  it("returns the parsed environment from a well-behaved shell", async () => {
    const shell = fakeShell(
      "good.sh",
      `printf '%s' '${SENTINEL}'; printf 'FROM_LOGIN=1\\0MULTI=a\\nb\\0'; printf '%s' '${SENTINEL}'`,
    );
    const resolved = await resolveLoginShellEnv({ shell, env: {} });
    expect(resolved).toEqual({ FROM_LOGIN: "1", MULTI: "a\nb" });
  });

  it("accepts a dump despite a non-zero exit code", async () => {
    const shell = fakeShell(
      "grumpy.sh",
      `printf '%s' '${SENTINEL}'; printf 'OK=1\\0'; printf '%s' '${SENTINEL}'; exit 3`,
    );
    const resolved = await resolveLoginShellEnv({ shell, env: {} });
    expect(resolved).toEqual({ OK: "1" });
  });

  it("returns null for output without a frame", async () => {
    const shell = fakeShell("garbage.sh", `echo 'not an env dump'`);
    await expect(resolveLoginShellEnv({ shell, env: {} })).resolves.toBeNull();
  });

  it("returns null when the shell hangs past the timeout", async () => {
    const shell = fakeShell("hang.sh", "sleep 30");
    const started = Date.now();
    const resolved = await resolveLoginShellEnv({ shell, env: process.env, timeoutMs: 300 });
    expect(resolved).toBeNull();
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("returns null when the shell cannot be spawned at all", async () => {
    const resolved = await resolveLoginShellEnv({
      shell: path.join(dir, "does-not-exist"),
      env: {},
    });
    expect(resolved).toBeNull();
  });

  it("applyLoginShellEnv merges into the given env and reports the count", async () => {
    const shell = fakeShell(
      "apply.sh",
      `printf '%s' '${SENTINEL}'; printf 'NEW_KEY=v\\0PRESENT=other\\0'; printf '%s' '${SENTINEL}'`,
    );
    const env: NodeJS.ProcessEnv = { SHELL: shell, PRESENT: "keep" };
    const lines: string[] = [];
    const count = await applyLoginShellEnv({
      platform: "linux",
      env,
      shell,
      log: (line) => lines.push(line),
    });
    expect(count).toBe(1);
    expect(env.NEW_KEY).toBe("v");
    expect(env.PRESENT).toBe("keep");
    expect(lines.some((l) => l.includes("imported 1 environment variable"))).toBe(true);
  });

  it("applyLoginShellEnv is a no-op with a log line when the probe fails", async () => {
    const shell = fakeShell("fail.sh", "exit 1");
    const env: NodeJS.ProcessEnv = {};
    const lines: string[] = [];
    const count = await applyLoginShellEnv({
      platform: "linux",
      env,
      shell,
      log: (line) => lines.push(line),
    });
    expect(count).toBe(0);
    expect(env).toEqual({});
    expect(lines.some((l) => l.includes("unavailable"))).toBe(true);
  });
});
