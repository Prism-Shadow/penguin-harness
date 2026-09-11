/**
 * Unit tests for the MXC Windows backend: the dimension mapping, the Windows
 * command-line quoting the argv must survive, the runner invocation shape, and the
 * platform/probe gating. These run on any host — the SDK is injected where the test is
 * about our mapping, and exercised for real where the test is about the SDK contract.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  createMxcProvider,
  loadMxcProvider,
  mxcPolicyFor,
  quoteWindowsArg,
  resolveRunner,
  toCommandLine,
  type MxcSdk,
} from "../src/index.js";

const RUNNER = "C:\\app\\node_modules\\@microsoft\\mxc-sdk\\bin\\x64\\wxc-exec.exe";
const WS = "C:\\work\\project";
const ARGV = ["cmd.exe", "/d", "/s", "/c", "echo hi"] as const;

/** Records what the backend asks the SDK to build. */
function recordingSdk(): { sdk: MxcSdk; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  const sdk: MxcSdk = {
    buildSandboxPayload(script, policy, workingDirectory, _name, containment) {
      calls.push({ script, policy, workingDirectory, containment });
      return { process: { commandLine: script }, containment };
    },
  };
  return { sdk, calls };
}

function decodeConfig(argv: readonly string[]): Record<string, unknown> {
  expect(argv[1]).toBe("--config-base64");
  return JSON.parse(Buffer.from(argv[2]!, "base64").toString("utf8")) as Record<string, unknown>;
}

describe("windows command-line quoting", () => {
  it("leaves simple arguments alone", () => {
    expect(quoteWindowsArg("cmd.exe")).toBe("cmd.exe");
    expect(quoteWindowsArg("/c")).toBe("/c");
  });

  it("quotes anything containing whitespace", () => {
    expect(quoteWindowsArg("echo hi")).toBe('"echo hi"');
    expect(quoteWindowsArg("")).toBe('""');
  });

  it("escapes embedded quotes and the backslashes that precede them", () => {
    // CommandLineToArgvW: a backslash run doubles only before a quote.
    expect(quoteWindowsArg('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteWindowsArg('a\\"b')).toBe('"a\\\\\\"b"');
    // Inside quotes a trailing backslash run doubles, because the closing quote follows it.
    expect(quoteWindowsArg("C:\\dir\\ x")).toBe('"C:\\dir\\ x"');
    expect(quoteWindowsArg("a b\\")).toBe('"a b\\\\"');
  });

  it("a path without whitespace or quotes passes through, trailing backslash included", () => {
    // CommandLineToArgvW only treats backslashes specially when a quote follows them,
    // and arguments are joined with spaces — so an unquoted trailing backslash round
    // trips exactly. Quoting it would be harmless but is not required, and the simpler
    // rule is the one with fewer ways to be wrong.
    expect(quoteWindowsArg("C:\\Windows\\System32")).toBe("C:\\Windows\\System32");
    expect(quoteWindowsArg("C:\\dir\\")).toBe("C:\\dir\\");
  });

  it("joins an argv into one command line", () => {
    expect(toCommandLine(ARGV)).toBe('cmd.exe /d /s /c "echo hi"');
  });
});

describe("dimension mapping", () => {
  it("workspace-write grants the workspace and nothing else", () => {
    const policy = mxcPolicyFor({ mode: "workspace-write", workspaceRoot: WS });
    expect(policy.filesystem).toMatchObject({
      readwritePaths: [WS],
      readonlyPaths: [path.parse(path.resolve(WS)).root],
      deniedPaths: [],
    });
  });

  it("read-only grants nothing writable", () => {
    expect(mxcPolicyFor({ mode: "read-only", workspaceRoot: WS }).filesystem).toMatchObject({
      readwritePaths: [],
    });
  });

  it("network: none maps to allowOutbound false; absent leaves the network alone", () => {
    expect(mxcPolicyFor({ mode: "read-only", workspaceRoot: WS, network: "none" })).toMatchObject({
      network: { allowOutbound: false },
    });
    expect(mxcPolicyFor({ mode: "read-only", workspaceRoot: WS })).toMatchObject({
      network: { allowOutbound: true },
    });
  });

  it("mask-paths map to deniedPaths", () => {
    expect(
      mxcPolicyFor({
        mode: "workspace-write",
        workspaceRoot: WS,
        maskPaths: ["C:\\Users\\me\\.ssh"],
      }).filesystem,
    ).toMatchObject({ deniedPaths: ["C:\\Users\\me\\.ssh"] });
  });
});

describe("runner invocation", () => {
  it("implements every dimension of the sandbox interface", () => {
    const { sdk } = recordingSdk();
    expect(createMxcProvider(sdk, RUNNER, () => true).dimensions).toEqual([
      "fs-write",
      "network",
      "mask-paths",
    ]);
  });

  it("wraps as [runner, --config-base64, <config>] with the command INSIDE the config", () => {
    const { sdk, calls } = recordingSdk();
    const confined = createMxcProvider(sdk, RUNNER, () => true).confine([...ARGV], {
      mode: "workspace-write",
      workspaceRoot: WS,
      network: "none",
      maskPaths: ["C:\\secrets"],
    });
    expect(confined.argv[0]).toBe(RUNNER);
    expect(confined.argv).toHaveLength(3);
    // No trailing argv: MXC takes the command through the config, which is what lets an
    // argv-rewriting seam host it at all.
    expect(decodeConfig(confined.argv)).toMatchObject({
      process: { commandLine: 'cmd.exe /d /s /c "echo hi"' },
      containment: "process",
    });
    expect(calls[0]).toMatchObject({ workingDirectory: WS, containment: "process" });
    expect(confined.enforcement).toBe("full");
  });

  it("an unusable runner fails closed, and the probe runs once", () => {
    const { sdk } = recordingSdk();
    let probes = 0;
    const provider = createMxcProvider(sdk, RUNNER, () => {
      probes++;
      return false;
    });
    const policy = { mode: "read-only", workspaceRoot: WS } as const;
    expect(() => provider.confine([...ARGV], policy)).toThrow(/cannot confine on this host/);
    expect(() => provider.confine([...ARGV], policy)).toThrow(/refusing to run/);
    expect(probes).toBe(1);
  });
});

describe("platform gating and SDK contract", () => {
  it("declines on every non-Windows host instead of pretending", async () => {
    expect(await loadMxcProvider({ platform: "linux" })).toBeNull();
    expect(await loadMxcProvider({ platform: "darwin" })).toBeNull();
  });

  it("the runner path is bin/<arch>/wxc-exec.exe inside the installed SDK", () => {
    // One of the two MXC internals this backend depends on (see its module doc).
    const runner = resolveRunner();
    expect(runner.endsWith(path.join("bin", process.arch, "wxc-exec.exe"))).toBe(true);
    expect(runner).toContain(path.join("@microsoft", "mxc-sdk"));
  });

  it("the REAL SDK still maps our policy onto the fields this backend relies on", async () => {
    // Drift guard: MXC is Public Preview, so this asserts against the installed SDK
    // rather than a fake — if the schema moves, this fails here instead of on Windows.
    const sdk = (await import("@microsoft/mxc-sdk")) as unknown as MxcSdk;
    const config = sdk.buildSandboxPayload(
      toCommandLine(ARGV),
      mxcPolicyFor({
        mode: "workspace-write",
        workspaceRoot: WS,
        network: "none",
        maskPaths: ["C:\\secrets"],
      }),
      WS,
      undefined,
      "process",
    );
    expect(config).toMatchObject({
      process: { commandLine: 'cmd.exe /d /s /c "echo hi"' },
      filesystem: {
        readwritePaths: [WS],
        deniedPaths: ["C:\\secrets"],
      },
      network: { defaultPolicy: "block" },
      // No containment assertion: the backend passes "process" in but never reads the
      // echo, and the SDK resolves that field per HOST (seatbelt on darwin) — on the
      // only host this backend runs, Windows, it is the process containment requested.
    });
  });
});
