/**
 * Driving npm for a registry fetch (src/plugin/install.ts): which npm runs, how it is started
 * on each platform, and which line of its stderr a failure shows.
 */
import { describe, expect, it } from "vitest";
import { npmInvocation, npmReason, PluginInstallError } from "../src/plugin/install.js";

describe("npmReason", () => {
  const err = new Error("Command failed: npm install");

  it("answers the first npm error line, not warnings before it nor the log pointer after it", () => {
    const stderr = [
      "npm warn deprecated glob@7.2.3: Glob versions prior to v9 are no longer supported",
      "npm error code E404",
      "npm error 404 Not Found - GET https://registry.npmjs.org/@acme%2fnope - Not found",
      "npm error 404",
      "npm error 404  '@acme/nope@*' is not in this registry.",
      "npm error A complete log of this run can be found in: /home/u/.npm/_logs/x-debug-0.log",
    ].join("\n");
    expect(npmReason(stderr, err)).toBe(
      "404 Not Found - GET https://registry.npmjs.org/@acme%2fnope - Not found",
    );
  });

  it("reads the Windows line ends and the older `npm ERR!` prefix", () => {
    const stderr =
      "npm ERR! code ETARGET\r\nnpm ERR! notarget No matching version found for x@9.\r\n";
    expect(npmReason(stderr, err)).toBe("notarget No matching version found for x@9.");
  });

  it("answers a shell's own message when npm never started, and the error when stderr is empty", () => {
    expect(
      npmReason("'npm.cmd' is not recognized as an internal or external command,\r\n", err),
    ).toBe("'npm.cmd' is not recognized as an internal or external command,");
    expect(npmReason("", err)).toBe(err.message);
    expect(npmReason(undefined, err)).toBe(err.message);
  });
});

describe("npmInvocation", () => {
  const args = ["install", "--", "@acme/x@>=1 <2"];

  it("runs the npm beside the node that runs the server, with that node leading PATH", () => {
    const cli = "/opt/penguin/node/lib/node_modules/npm/bin/npm-cli.js";
    const npm = npmInvocation(args, {
      execPath: "/opt/penguin/node/bin/node",
      platform: "linux",
      env: { PATH: "/usr/bin" },
      electron: false,
      exists: (f) => f === cli,
    });
    expect(npm).toEqual({
      command: "/opt/penguin/node/bin/node",
      args: [cli, ...args],
      shell: false,
      env: { PATH: "/opt/penguin/node/bin:/usr/bin" },
    });
  });

  it("finds the Windows runtime's npm next to node.exe, and keeps the environment's own `Path` key", () => {
    const cli = "C:\\penguin\\node\\node_modules\\npm\\bin\\npm-cli.js";
    const npm = npmInvocation(args, {
      execPath: "C:\\penguin\\node\\node.exe",
      platform: "win32",
      env: { Path: "C:\\Windows" },
      electron: false,
      exists: (f) => f === cli,
    });
    expect(npm.command).toBe("C:\\penguin\\node\\node.exe");
    expect(npm.args).toEqual([cli, ...args]);
    expect(npm.shell).toBe(false);
    expect(npm.env).toEqual({ Path: "C:\\penguin\\node;C:\\Windows" });
  });

  it("falls back to the npm on PATH: npm.cmd through a shell on Windows, every argument quoted", () => {
    const npm = npmInvocation(args, {
      execPath: "C:\\Program Files\\App\\app.exe",
      platform: "win32",
      env: {},
      electron: true,
      exists: () => true, // Electron runs no npm-cli.js, whatever sits beside it
    });
    expect(npm).toEqual({
      command: "npm.cmd",
      args: ['"install"', '"--"', '"@acme/x@>=1 <2"'],
      shell: true,
      env: {},
    });
    const posix = npmInvocation(args, {
      execPath: "/usr/bin/node",
      platform: "linux",
      env: {},
      electron: false,
      exists: () => false,
    });
    expect(posix).toEqual({ command: "npm", args, shell: false, env: {} });
  });

  it("refuses what cmd.exe would expand or split rather than hand it to a shell", () => {
    const host = { platform: "win32" as const, exists: () => false, electron: false, env: {} };
    for (const bad of ['a"b', "%PATH%", "a\r\nb"]) {
      expect(() => npmInvocation(["install", bad], host)).toThrow(PluginInstallError);
    }
  });
});
