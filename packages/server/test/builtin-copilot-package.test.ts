import { describe, expect, it, vi } from "vitest";
import {
  COPILOT_VERSION,
  binaryFromManifest,
  copilotPackageName,
  isMuslLinux,
} from "../src/coding-agents/builtin/copilot-package.js";

describe("copilot package facts", () => {
  it("pins a version", () => expect(COPILOT_VERSION).toMatch(/^\d+\.\d+\.\d+$/));

  it("names the platform package, musl included, and nothing for unknown platforms", () => {
    expect(copilotPackageName("win32", "x64", false)).toBe("@github/copilot-win32-x64");
    expect(copilotPackageName("darwin", "arm64", false)).toBe("@github/copilot-darwin-arm64");
    expect(copilotPackageName("linux", "x64", false)).toBe("@github/copilot-linux-x64");
    expect(copilotPackageName("linux", "arm64", true)).toBe("@github/copilot-linuxmusl-arm64");
    expect(copilotPackageName("linux", "ia32", false)).toBeNull();
    expect(copilotPackageName("freebsd", "x64", false)).toBeNull();
  });

  it("reads the program from the manifest's exports, else its bin", () => {
    expect(binaryFromManifest({ exports: { ".": "./copilot.exe" } })).toBe("copilot.exe");
    expect(binaryFromManifest({ bin: { "copilot-linux-x64": "copilot" } })).toBe("copilot");
    expect(() => binaryFromManifest({})).toThrow(/program/);
  });

  describe("isMuslLinux", () => {
    it("returns false off Linux", () => {
      expect(isMuslLinux()).toBe(false);
    });

    it("returns true when the report header has no glibcVersionRuntime", () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
      const originalReport = Object.getOwnPropertyDescriptor(process, "report");

      try {
        Object.defineProperty(process, "platform", { value: "linux", configurable: true });
        Object.defineProperty(process, "report", {
          value: { getReport: () => ({ header: {} }) },
          configurable: true,
        });

        expect(isMuslLinux()).toBe(true);
      } finally {
        if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
        else delete (process as any).platform;
        if (originalReport) Object.defineProperty(process, "report", originalReport);
        else delete (process as any).report;
      }
    });

    it("returns false when the header has glibcVersionRuntime", () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
      const originalReport = Object.getOwnPropertyDescriptor(process, "report");

      try {
        Object.defineProperty(process, "platform", { value: "linux", configurable: true });
        Object.defineProperty(process, "report", {
          value: { getReport: () => ({ header: { glibcVersionRuntime: "2.31" } }) },
          configurable: true,
        });

        expect(isMuslLinux()).toBe(false);
      } finally {
        if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
        else delete (process as any).platform;
        if (originalReport) Object.defineProperty(process, "report", originalReport);
        else delete (process as any).report;
      }
    });

    it("returns false without throwing when process.report is undefined", () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
      const originalReport = Object.getOwnPropertyDescriptor(process, "report");

      try {
        Object.defineProperty(process, "platform", { value: "linux", configurable: true });
        Object.defineProperty(process, "report", { value: undefined, configurable: true });

        expect(isMuslLinux()).toBe(false);
      } finally {
        if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
        else delete (process as any).platform;
        if (originalReport) Object.defineProperty(process, "report", originalReport);
        else delete (process as any).report;
      }
    });
  });
});
