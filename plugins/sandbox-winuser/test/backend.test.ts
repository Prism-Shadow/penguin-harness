/**
 * Unit tests for the Windows account backend: the command line the argv has to survive, the
 * job a policy becomes, and the gating at load. These run on any host — the state and the
 * platform are injected, since the real thing needs local accounts only Windows has.
 */
import { describe, expect, it } from "vitest";
import {
  createWinUserProvider,
  jobFor,
  loadWinUserProvider,
  programRoot,
  resolveProgram,
  quoteWindowsArg,
  toCommandLine,
  winUserSettingsOf,
  readState,
} from "../src/index.js";
import type { WinUserState } from "../src/index.js";
import { sandboxEnvironment, workingDirectory } from "../src/launch.js";
import {
  elevationCommand,
  powershellPath,
  runSetup,
  setupArgs,
  setupScript,
} from "../src/setup.js";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const STATE: WinUserState = {
  group: "PenguinSbxUsers",
  home: "C:\\Users\\k",
  online: { user: "PenguinSbxNet", password: "secret-online" },
  offline: { user: "PenguinSbxNoNet", password: "secret-offline" },
  fullOnline: { user: "PenguinSbxFullNet", password: "secret-full-online" },
  fullOffline: { user: "PenguinSbxFullNoNet", password: "secret-full-offline" },
};
const WS = "C:\\work\\project";
const BASH = "C:\\Users\\k\\tools\\git\\bin\\bash.exe";

/** The job the provider encoded into the launcher's one argument. */
function jobOf(argv: readonly string[]) {
  return JSON.parse(Buffer.from(argv[2]!, "base64").toString("utf8")) as Record<string, unknown>;
}

describe("windows command line", () => {
  it("quotes what needs it and leaves the rest alone", () => {
    expect(quoteWindowsArg("bash.exe")).toBe("bash.exe");
    expect(quoteWindowsArg("echo hi")).toBe('"echo hi"');
    expect(quoteWindowsArg('say "hi"')).toBe('"say \\"hi\\""');
    expect(toCommandLine([BASH, "-lc", "echo hi"])).toBe(`${BASH} -lc "echo hi"`);
  });
});

describe("policy as a job", () => {
  it("maps each mode to a Workspace grant and whether the home is writable (full)", () => {
    const j = (mode: "read-only" | "workspace-write" | "danger-full-access") =>
      jobFor({ mode, workspaceRoot: WS }, [BASH]);
    expect(j("read-only")).toMatchObject({ access: "read", full: false });
    expect(j("workspace-write")).toMatchObject({ access: "modify", full: false });
    // Full access writes the Workspace like workspace-write, and ALSO gets a home-writable account.
    expect(j("danger-full-access")).toMatchObject({ access: "modify", full: true });
  });

  it("carries the network choice and the masked paths, and nothing it was not given", () => {
    const job = jobFor(
      { mode: "workspace-write", workspaceRoot: WS, network: "none", maskPaths: ["C:\\secrets"] },
      [BASH, "-lc", "true"],
    );
    expect(job).toMatchObject({
      network: "none",
      maskPaths: ["C:\\secrets"],
      workspaceRoot: WS,
      commandLine: `${BASH} -lc true`,
    });
    expect(jobFor({ mode: "read-only", workspaceRoot: WS }, [BASH])).not.toHaveProperty("network");
    expect(jobFor({ mode: "read-only", workspaceRoot: WS }, [BASH])).not.toHaveProperty(
      "maskPaths",
    );
  });

  it("resolves a BARE shell name through PATH, or the install is never opened", () => {
    // core's shell.ts hands Windows the name "bash", not a path. Left unresolved, programRoot
    // answers "" , nothing is granted, and CreateProcessWithLogonW refuses every command with
    // ACCESS_DENIED — which is exactly how this failed on a live host.
    const env = {
      PATH: "C:\\Windows\\System32;C:\\Users\\k\\Software\\packages\\git-2.49.0\\bin",
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
    } as NodeJS.ProcessEnv;
    // Windows resolves paths case-insensitively, and PATHEXT is spelled in capitals.
    const onDisk = (f: string) =>
      f.toLowerCase() === "c:\\users\\k\\software\\packages\\git-2.49.0\\bin\\bash.exe";
    expect(resolveProgram("bash", env, onDisk).toLowerCase()).toBe(
      "c:\\users\\k\\software\\packages\\git-2.49.0\\bin\\bash.exe",
    );
    expect(programRoot(resolveProgram("bash", env, onDisk))).toBe(
      "C:\\Users\\k\\Software\\packages\\git-2.49.0",
    );
    // An absolute command is taken as it stands; an unfindable name opens nothing.
    expect(resolveProgram(BASH, env, () => true)).toBe(BASH);
    expect(resolveProgram("nosuchshell", env, () => false)).toBe("");
  });

  it("the program's directory is its install ROOT, since a shell loads DLLs beside bin", () => {
    expect(programRoot(BASH)).toBe("C:\\Users\\k\\tools\\git");
    expect(programRoot("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toBe(
      "C:\\Program Files\\PowerShell\\7",
    );
    expect(programRoot("bash")).toBe("");
  });
});

describe("confining", () => {
  it("rewrites the command into the launcher, with the policy and NO password", () => {
    const provider = createWinUserProvider({
      state: STATE,
      node: "C:\\node\\node.exe",
      launcher: "C:\\plugin\\launch.js",
    });
    const confined = provider.confine([BASH, "-lc", "echo hi"], {
      mode: "workspace-write",
      workspaceRoot: WS,
      network: "none",
    });
    expect(confined.argv.slice(0, 2)).toEqual(["C:\\node\\node.exe", "C:\\plugin\\launch.js"]);
    expect(confined.enforcement).toBe("full");
    // The interpreter may be the desktop app's own binary, which runs a script only when told.
    expect(confined.env).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
    // Every process on the machine can read a command line: the secret must not be in one.
    expect(confined.argv.join(" ")).not.toContain("secret-offline");
    expect(jobOf(confined.argv)).toMatchObject({
      access: "modify",
      full: false,
      network: "none",
      programDir: "C:\\Users\\k\\tools\\git",
    });
  });

  it("full access + network off asks for a home-writable, network-cut account", () => {
    const provider = createWinUserProvider({ state: STATE, node: "node", launcher: "launch.js" });
    const job = jobOf(
      provider.confine([BASH, "-lc", "true"], {
        mode: "danger-full-access",
        workspaceRoot: WS,
        network: "none",
      }).argv,
    );
    expect(job).toMatchObject({ access: "modify", full: true, network: "none" });
  });

  it("the setting withholds the shell's directory when a deployment wants it withheld", () => {
    const provider = createWinUserProvider(
      { state: STATE, node: "node", launcher: "launch.js" },
      () => winUserSettingsOf({ grantProgramDir: false }),
    );
    const job = jobOf(
      provider.confine([BASH, "-lc", "true"], { mode: "read-only", workspaceRoot: WS }).argv,
    );
    expect(job.programDir).toBeUndefined();
  });

  it("implements every dimension of the sandbox interface", () => {
    expect(createWinUserProvider({ state: STATE }).dimensions).toEqual([
      "fs-write",
      "network",
      "mask-paths",
    ]);
  });
});

describe("loading", () => {
  it("declines off Windows, and refuses with the setup command when the accounts are absent", async () => {
    await expect(loadWinUserProvider({ platform: "linux", state: STATE })).resolves.toBeNull();
    await expect(loadWinUserProvider({ platform: "win32", state: null })).rejects.toThrow(
      /no sandbox accounts yet/,
    );
    await expect(loadWinUserProvider({ platform: "win32", state: null })).rejects.toThrow(
      /penguin-sandbox-setup\.ps1/,
    );
    await expect(loadWinUserProvider({ platform: "win32", state: STATE })).resolves.toBeDefined();
  });
});

describe("the confined environment", () => {
  const REAL = {
    PATH: "C:\\Windows",
    USERPROFILE: "C:\\Users\\k",
    HOME: "C:\\Users\\k",
    APPDATA: "C:\\Users\\k\\AppData\\Roaming",
    ELECTRON_RUN_AS_NODE: "1",
  };
  const TEMP = "C:\\ProgramData\\penguin\\sandbox-temp";

  it("keeps HOME and USERPROFILE real, and only redirects TEMP to the writable sandbox temp", () => {
    const env = sandboxEnvironment(REAL, TEMP);
    // The home is NOT remapped: the setup granted the accounts access to the real one.
    expect(env.HOME).toBe("C:\\Users\\k");
    expect(env.USERPROFILE).toBe("C:\\Users\\k");
    expect(env.APPDATA).toBe("C:\\Users\\k\\AppData\\Roaming");
    expect(env.PATH).toBe("C:\\Windows");
    // The launcher's own interpreter switch stays with the launcher.
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    // Only the temp is redirected, and to the shared sandbox temp, not a remapped home.
    expect(env.TEMP).toBe(TEMP);
    expect(env.TMP).toBe(TEMP);
  });

  it("leaves the real temp in place when the policy grants no writable temp", () => {
    const env = sandboxEnvironment({ ...REAL, TEMP: "C:\\Users\\k\\AppData\\Local\\Temp" }, null);
    expect(env.HOME).toBe("C:\\Users\\k");
    expect(env.TEMP).toBe("C:\\Users\\k\\AppData\\Local\\Temp");
  });
});

describe("asking Windows for the accounts", () => {
  it("reports success once the accounts exist, not on the prompt's exit code", async () => {
    let asked = 0;
    let created = false;
    const outcome = await runSetup({
      raise: () => {
        asked++;
        created = true; // the elevated run left its state behind
        return { failure: "" };
      },
      state: () => created,
      waitMs: 1_000,
      pollMs: 10,
    });
    expect(asked).toBe(1);
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/accounts are ready/);
    expect(outcome.messageZh).toMatch(/沙盒账户已就绪/);
  });

  it("an unanswered prompt does not hold the page: it reports and lets the person answer", async () => {
    const started = Date.now();
    const outcome = await runSetup({
      raise: () => ({ failure: "" }),
      state: () => false,
      waitMs: 60,
      pollMs: 10,
    });
    // The prompt may still be open on the machine's screen; this call is already back.
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/asking for permission/);
    expect(outcome.message).toMatch(/penguin-sandbox-setup\.ps1/);
  });

  it("ships the script the prompt runs", () => {
    expect(existsSync(setupScript())).toBe(true);
  });
});

describe("who the setup grants access to", () => {
  it("names the harness's own user and home, not the elevated administrator's", () => {
    const args = setupArgs({
      USERDOMAIN: "PRISM",
      USERNAME: "k",
      USERPROFILE: "C:\\Users\\k",
    } as NodeJS.ProcessEnv);
    expect(args).toEqual(["-ServerUser", "PRISM\\k", "-UserProfile", "C:\\Users\\k"]);
  });
});

describe("the elevation request", () => {
  it("quotes each argument exactly once, so PowerShell can parse it", () => {
    const command = elevationCommand("C:\\plugin\\setup\\penguin-sandbox-setup.ps1");
    expect(command).toContain(
      "-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','C:\\plugin\\setup\\penguin-sandbox-setup.ps1')",
    );
    // The bug this replaces: a doubled quote, which parses as nothing and prompts for nothing.
    expect(command).not.toContain("''C:");
    expect(command).not.toContain("ps1''");
  });

  it("survives a path with a quote in it, the way PowerShell escapes one", () => {
    expect(elevationCommand("C:\\it's\\setup.ps1")).toContain("'C:\\it''s\\setup.ps1'");
  });
});

describe("the setup script this package ships", () => {
  /**
   * PowerShell reads `$Name:` inside a string as a SCOPE reference, not as a variable and a
   * colon — so `"account $Name: created"` is a parse error, and a script that cannot parse dies
   * before its first line, leaving no transcript and no accounts. That is exactly how it failed
   * on a real host: the elevated process started and vanished. Nothing here can run PowerShell,
   * so the shape that bit us is the thing asserted.
   */
  it("never interpolates a bare variable before a colon", () => {
    const text = readFileSync(setupScript(), "utf8");
    const offenders = text
      .split(/\r?\n/)
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) =>
        /\$(?!\{)(?!env:)(?!script:)(?!global:)(?!using:)[A-Za-z_]\w*:/.test(line),
      );
    expect(offenders.map(([n, line]) => `${n}: ${line.trim()}`)).toEqual([]);
  });

  it("is what the elevation request runs", () => {
    expect(setupScript()).toMatch(/setup[\\/]penguin-sandbox-setup\.ps1$/);
    expect(readFileSync(setupScript(), "utf8")).toContain("New-LocalUser");
  });
});

describe("what Windows will accept", () => {
  /**
   * A local account name may be at most 20 characters. The first names here were 21, and
   * New-LocalUser's refusal named neither the account nor the rule — the setup simply exited 1
   * with nothing written anywhere, which from the page looked like an unanswered prompt.
   */
  it("the account names the script defaults to fit", () => {
    const text = readFileSync(setupScript(), "utf8");
    const defaults = [...text.matchAll(/\$(?:Offline|Online)User = '([^']+)'/g)].map((m) => m[1]!);
    expect(defaults.length).toBe(2);
    for (const name of defaults) expect(name.length).toBeLessThanOrEqual(20);
  });

  it("and the account description fits too", () => {
    const text = readFileSync(setupScript(), "utf8");
    const description = /\$accountDescription = '([^']+)'/.exec(text)?.[1];
    expect(description).toBeDefined();
    expect(description!.length).toBeLessThanOrEqual(48);
  });

  it("the script states both limits itself, so its refusal explains them", () => {
    const text = readFileSync(setupScript(), "utf8");
    expect(text).toContain("$accountNameLimit = 20");
    expect(text).toContain("$accountDescriptionLimit = 48");
  });
});

describe("raising the prompt at all", () => {
  it("names Windows PowerShell by its full path, never by a PATH lookup", () => {
    expect(powershellPath({ SystemRoot: "D:\\Windows" })).toBe(
      "D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    );
  });

  it("a request that could not be made is reported as that, not as a waiting prompt", async () => {
    const outcome = await runSetup({
      raise: () => ({ failure: "the elevation request could not be started: spawn ENOENT" }),
      state: () => false,
      waitMs: 30,
      pollMs: 10,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/could not be started/);
    expect(outcome.message).not.toMatch(/asking for permission/);
  });
});

describe("reading what the setup wrote", () => {
  /**
   * Windows PowerShell's UTF8 encoding writes a byte-order mark, and `JSON.parse` refuses one.
   * The setup then leaves a correct file that reads as no setup at all — accounts on the
   * machine, a card insisting there are none. Both sides are fixed; this holds the read side.
   */
  it("accepts a state file with a byte-order mark", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "penguin-winuser-state-"));
    const file = path.join(dir, "sandbox-winuser.json");
    try {
      writeFileSync(file, `﻿${JSON.stringify(STATE)}`, "utf8");
      expect(readState(file)).toEqual(STATE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("and still refuses a file that is not a state", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "penguin-winuser-state-"));
    const file = path.join(dir, "sandbox-winuser.json");
    try {
      writeFileSync(file, '{"group":"x"}', "utf8");
      expect(readState(file)).toBeNull();
      expect(readState(path.join(dir, "absent.json"))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("a cut network stays cut", () => {
  it("strips proxy variables, which a local proxy would otherwise route around", () => {
    const parent = {
      http_proxy: "http://127.0.0.1:10809",
      HTTPS_PROXY: "http://127.0.0.1:10809",
      all_proxy: "socks5://127.0.0.1:10808",
      no_proxy: "localhost",
      PATH: "C:\\Windows",
    };
    const cut = sandboxEnvironment(parent, "C:\\temp", true);
    expect(cut.http_proxy).toBeUndefined();
    expect(cut.HTTPS_PROXY).toBeUndefined();
    expect(cut.all_proxy).toBeUndefined();
    // no_proxy names what to bypass; without a proxy it says nothing, and PATH is untouched.
    expect(cut.PATH).toBe("C:\\Windows");
  });

  it("leaves them alone when the policy did not ask for isolation", () => {
    const open = sandboxEnvironment({ http_proxy: "http://127.0.0.1:10809" }, "C:\\temp", false);
    expect(open.http_proxy).toBe("http://127.0.0.1:10809");
  });
});

describe("where a confined command runs", () => {
  it("is the directory the harness gave the launcher, not the Workspace root", () => {
    const job = { access: "modify" as const, full: false, workspaceRoot: WS, commandLine: "x" };
    expect(workingDirectory(job, "C:\\work\\project\\sub", () => true)).toBe(
      "C:\\work\\project\\sub",
    );
  });

  it("falls back to the Workspace when that directory is gone", () => {
    const job = { access: "modify" as const, full: false, workspaceRoot: WS, commandLine: "x" };
    expect(workingDirectory(job, "C:\\work\\project\\deleted", () => false)).toBe(WS);
  });
});
