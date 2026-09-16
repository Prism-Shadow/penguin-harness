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
  quoteWindowsArg,
  toCommandLine,
  winUserSettingsOf,
} from "../src/index.js";
import type { WinUserState } from "../src/index.js";
import { sandboxEnvironment } from "../src/launch.js";

const STATE: WinUserState = {
  group: "PenguinSandboxUsers",
  offline: { user: "PenguinSandboxOffline", password: "secret-offline" },
  online: { user: "PenguinSandboxOnline", password: "secret-online" },
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
  it("workspace-write opens the Workspace for writing, read-only for reading", () => {
    expect(jobFor({ mode: "workspace-write", workspaceRoot: WS }, [BASH]).access).toBe("modify");
    expect(jobFor({ mode: "read-only", workspaceRoot: WS }, [BASH]).access).toBe("read");
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
    // Every process on the machine can read a command line: the secret must not be in one.
    expect(confined.argv.join(" ")).not.toContain("secret-offline");
    expect(jobOf(confined.argv)).toMatchObject({
      access: "modify",
      network: "none",
      programDir: "C:\\Users\\k\\tools\\git",
    });
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
  it("points HOME and the temp variables at the sandbox's own home, keeping the rest", () => {
    const env = sandboxEnvironment(
      { PATH: "C:\\Windows", USERPROFILE: "C:\\Users\\k", HOME: "C:\\Users\\k" },
      "C:\\ProgramData\\penguin\\sandbox-home",
    );
    expect(env.PATH).toBe("C:\\Windows");
    expect(env.HOME).toBe("C:\\ProgramData\\penguin\\sandbox-home");
    expect(env.USERPROFILE).toBe("C:\\ProgramData\\penguin\\sandbox-home");
    expect(env.TEMP).toBe("C:\\ProgramData\\penguin\\sandbox-home\\temp");
    expect(env.TMP).toBe(env.TEMP);
  });
});
