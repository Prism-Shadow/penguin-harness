/**
 * Driving npm for a registry fetch (src/plugin/install.ts): how npm is started on each
 * platform and with which PATH, and which line of its stderr a failure shows.
 */
import { describe, expect, it } from "vitest";
import { npmCommand, npmEnv, npmReason, PluginInstallError } from "../src/plugin/install.js";

describe("npmReason", () => {
  const err = new Error("Command failed: npm install");

  it("answers the first npm error line, not the warnings, codes or log pointer around it", () => {
    const stderr = [
      "npm warn deprecated glob@7.2.3: no longer supported",
      "npm error code E404",
      "npm error 404 Not Found - GET https://registry.npmjs.org/@acme%2fnope - Not found",
      "npm error A complete log of this run can be found in: /home/u/.npm/_logs/x-debug-0.log",
    ].join("\r\n");
    expect(npmReason(stderr, err)).toBe(
      "404 Not Found - GET https://registry.npmjs.org/@acme%2fnope - Not found",
    );
  });

  it("answers a shell's own message when npm never started, else the error", () => {
    expect(npmReason("'npm.cmd' is not recognized as a command\r\n", err)).toBe(
      "'npm.cmd' is not recognized as a command",
    );
    expect(npmReason(undefined, err)).toBe(err.message);
  });
});

describe("npmCommand", () => {
  it("runs npm without a shell, and npm.cmd through cmd.exe on Windows, every argument quoted", () => {
    const args = ["install", "--", "@acme/x@>=1 <2"];
    expect(npmCommand(args, "linux")).toEqual({ command: "npm", args, shell: false });
    expect(npmCommand(args, "win32")).toEqual({
      command: "npm.cmd",
      args: ['"install"', '"--"', '"@acme/x@>=1 <2"'],
      shell: true,
    });
    expect(() => npmCommand(["install", "%PATH%"], "win32")).toThrow(PluginInstallError);
  });
});

describe("npmEnv", () => {
  it("appends the running runtime's directory to PATH, after the user's own, once", () => {
    const env = { PATH: "/usr/bin", HOME: "/home/u" };
    expect(npmEnv(env, "/opt/node/bin", ":")).toEqual({
      PATH: "/usr/bin:/opt/node/bin",
      HOME: "/home/u",
    });
    expect(env.PATH).toBe("/usr/bin");
    expect(npmEnv({ Path: "C:\\Windows" }, "C:\\node", ";")).toEqual({
      Path: "C:\\Windows;C:\\node",
    });
    expect(npmEnv({ PATH: "/a:/rt" }, "/rt", ":")).toEqual({ PATH: "/a:/rt" });
  });
});
