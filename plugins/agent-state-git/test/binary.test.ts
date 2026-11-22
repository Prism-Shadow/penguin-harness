/**
 * Which Git a host gets.
 *
 * - Every host a harness installer or image targets has a build in dugite's table — Linux x64
 *   and arm64 (the two Docker images among them), macOS x64 and arm64, Windows x64 and arm64 —
 *   and a host it lacks (musl is reported as plain Linux; FreeBSD, Linux on s390x) has none.
 * - A Git an operator names with `LOCAL_GIT_DIRECTORY`, in dugite's layout, is used as it is,
 *   with nothing fetched.
 */
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { locateGit, pinFor } from "../src/binary.js";

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
});
