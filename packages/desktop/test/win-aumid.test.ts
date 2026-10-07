/**
 * Windows AppUserModelID registry registration (src/win-aumid.ts):
 *
 * - Given a release or dev identity on win32, when `registerWindowsAumid` runs with an icon
 *   path, then both `DisplayName` and `IconUri` are written under
 *   `HKCU\Software\Classes\AppUserModelId\<AUMID>`.
 * - Given a missing icon asset (`iconPath: null`), when `registerWindowsAumid` runs, then
 *   `DisplayName` is still registered and `IconUri` is omitted.
 * - Given a non-Windows platform (`darwin`, `linux`), when `registerWindowsAumid` runs,
 *   then no registry command is executed.
 * - Given `reg.exe` failing on Windows, when `registerWindowsAumid` runs, then it logs the
 *   failure and resolves `false` without throwing.
 */
import { describe, expect, it } from "vitest";
import {
  registerWindowsAumid,
  winAumidRegCommands,
  winAumidRegistryKey,
} from "../src/win-aumid.js";

describe("winAumidRegCommands", () => {
  it("writes DisplayName and IconUri under HKCU\\Software\\Classes\\AppUserModelId\\<id>", () => {
    const key = winAumidRegistryKey("com.prismshadow.penguinharness");
    expect(key).toBe("HKCU\\Software\\Classes\\AppUserModelId\\com.prismshadow.penguinharness");
    expect(
      winAumidRegCommands({
        appUserModelId: "com.prismshadow.penguinharness",
        displayName: "PenguinHarness",
        iconPath: "D:\\PenguinHarness\\resources\\app\\dist\\icon.png",
      }),
    ).toEqual([
      ["add", key, "/v", "DisplayName", "/t", "REG_SZ", "/d", "PenguinHarness", "/f"],
      [
        "add",
        key,
        "/v",
        "IconUri",
        "/t",
        "REG_SZ",
        "/d",
        "D:\\PenguinHarness\\resources\\app\\dist\\icon.png",
        "/f",
      ],
    ]);
  });

  it("omits IconUri when no icon file is available", () => {
    const key = winAumidRegistryKey("com.prismshadow.penguinharness.dev");
    expect(
      winAumidRegCommands({
        appUserModelId: "com.prismshadow.penguinharness.dev",
        displayName: "PenguinHarness-Dev",
        iconPath: null,
      }),
    ).toEqual([
      ["add", key, "/v", "DisplayName", "/t", "REG_SZ", "/d", "PenguinHarness-Dev", "/f"],
    ]);
  });
});

describe("registerWindowsAumid", () => {
  it("is a no-op off Windows", async () => {
    const calls: Array<readonly string[]> = [];
    const logs: string[] = [];
    for (const platform of ["darwin", "linux"] as const) {
      const ok = await registerWindowsAumid({
        platform,
        appUserModelId: "com.prismshadow.penguinharness",
        displayName: "PenguinHarness",
        iconPath: "/opt/penguin/icon.png",
        runReg: async (args) => {
          calls.push(args);
        },
        log: (line) => logs.push(line),
      });
      expect(ok).toBe(false);
    }
    expect(calls).toEqual([]);
    expect(logs).toEqual([]);
  });

  it("executes the registry writes in order on win32", async () => {
    const calls: Array<readonly string[]> = [];
    const logs: string[] = [];
    const ok = await registerWindowsAumid({
      platform: "win32",
      appUserModelId: "com.prismshadow.penguinharness",
      displayName: "PenguinHarness",
      iconPath: "D:\\PenguinHarness\\dist\\icon.png",
      runReg: async (args) => {
        calls.push(args);
      },
      log: (line) => logs.push(line),
    });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(logs).toEqual([]);
  });

  it("logs and returns false without throwing when reg.exe fails", async () => {
    const logs: string[] = [];
    const ok = await registerWindowsAumid({
      platform: "win32",
      appUserModelId: "com.prismshadow.penguinharness",
      displayName: "PenguinHarness",
      iconPath: null,
      runReg: async () => {
        throw new Error("access denied");
      },
      log: (line) => logs.push(line),
    });
    expect(ok).toBe(false);
    expect(logs).toEqual([
      "Windows AppUserModelID 'com.prismshadow.penguinharness' could not be registered: Error: access denied",
    ]);
  });
});
