/**
 * Which Git a host gets.
 *
 * - Every host a harness installer or image targets has a build in dugite's table — Linux x64
 *   and arm64 (the two Docker images among them), macOS x64 and arm64, Windows x64 and arm64 —
 *   and a host it lacks (musl is reported as plain Linux; FreeBSD, Linux on s390x) has none.
 * - A Git an operator names with `LOCAL_GIT_DIRECTORY`, in dugite's layout, is used as it is,
 *   with nothing fetched.
 * - A payload a host ships as files (the macOS desktop app, which has to sign every program it
 *   carries) runs from where it lies; nothing is extracted.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { keptFiles, locateGit, pinFor } from "../src/binary.js";

describe("the Git a host gets", () => {
  it.each([
    ["linux", "x64"],
    ["linux", "arm64"],
    ["darwin", "x64"],
    ["darwin", "arm64"],
    ["win32", "x64"],
    ["win32", "arm64"],
  ] as const)("%s-%s has a pinned build", (platform, arch) => {
    const pin = pinFor(platform, arch);
    expect(pin?.url).toMatch(
      /^https:\/\/github\.com\/desktop\/dugite-native\/releases\/download\//,
    );
    expect(pin?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["freebsd", "x64"],
    ["linux", "s390x"],
  ] as const)("%s-%s has none", (platform, arch) => {
    expect(pinFor(platform, arch)).toBeNull();
  });

  it("uses a Git named by LOCAL_GIT_DIRECTORY without fetching anything", async () => {
    const own = path.join(os.tmpdir(), "operators-git");
    const found = await locateGit({
      cacheDir: path.join(os.tmpdir(), "never-written"),
      env: { LOCAL_GIT_DIRECTORY: own },
    });

    expect(found?.source).toBe("LOCAL_GIT_DIRECTORY");
    expect(found?.git.program.startsWith(own)).toBe(true);
  });

  it.skipIf(pinFor() === null)("runs a payload shipped as files in place", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-unpacked-git-"));
    try {
      const target = process.platform + "-" + process.arch;
      const program = path.join(
        root,
        "native",
        target,
        keptFiles(process.platform, process.arch)[0]!,
      );
      await fs.mkdir(path.dirname(program), { recursive: true });
      await fs.writeFile(program, "");
      const cacheDir = path.join(root, "cache");

      const found = await locateGit({ cacheDir, env: {}, nativeDir: path.join(root, "native") });

      expect(found?.git).toEqual({ program, execPath: path.dirname(program) });
      await expect(fs.access(cacheDir)).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
