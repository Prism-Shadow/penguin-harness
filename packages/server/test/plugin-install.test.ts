/**
 * Driving npm for a registry fetch (src/plugin/install.ts): how the npm on PATH is started on
 * each platform, and which line of its stderr a failure shows.
 */
import { describe, expect, it } from "vitest";
import { npmCommand, npmEnv, npmReason, PluginInstallError } from "../src/plugin/install.js";

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

describe("npmCommand", () => {
  const args = ["install", "--", "@acme/x@>=1 <2"];

  it("runs the npm on PATH as it is, without a shell, off Windows", () => {
    expect(npmCommand(args, "linux")).toEqual({ command: "npm", args, shell: false });
  });

  it("runs npm.cmd through a shell on Windows, every argument quoted", () => {
    expect(npmCommand(args, "win32")).toEqual({
      command: "npm.cmd",
      args: ['"install"', '"--"', '"@acme/x@>=1 <2"'],
      shell: true,
    });
  });

  it("refuses what cmd.exe would expand or split rather than hand it to a shell", () => {
    for (const bad of ['a"b', "%PATH%", "a\r\nb"]) {
      expect(() => npmCommand(["install", bad], "win32")).toThrow(PluginInstallError);
    }
  });
});

describe("npmEnv", () => {
  it("appends the running runtime's directory to PATH, after the user's own", () => {
    const env = { PATH: "/usr/local/bin:/usr/bin", HOME: "/home/u" };
    expect(npmEnv(env, "/opt/penguin/node/bin", ":")).toEqual({
      PATH: "/usr/local/bin:/usr/bin:/opt/penguin/node/bin",
      HOME: "/home/u",
    });
    expect(env.PATH).toBe("/usr/local/bin:/usr/bin");
  });

  it("extends the key Windows spells, and adds nothing already there", () => {
    expect(npmEnv({ Path: "C:\\Windows" }, "C:\\penguin\\node", ";")).toEqual({
      Path: "C:\\Windows;C:\\penguin\\node",
    });
    expect(npmEnv({ PATH: "/a:/rt" }, "/rt", ":")).toEqual({ PATH: "/a:/rt" });
    expect(npmEnv({}, "/rt", ":")).toEqual({ PATH: "/rt" });
  });
});
