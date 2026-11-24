/**
 * Which Git the CLI engine runs: the host's `git`, probed once.
 *
 * - The probe runs `git version` once and remembers the answer; every later call in the process
 *   answers the same thing without another process.
 * - A host whose `git` is not on the `PATH` has none, and the remembered answer says so.
 */
import { describe, expect, it, vi } from "vitest";

/** The binary module fresh of its memo, so each case probes for itself. */
const freshProbe = async () => {
  vi.resetModules();
  return (await import("../src/binary.js")).probeGit;
};

describe("the Git the CLI engine runs", () => {
  it("is probed once, and one answer serves the whole process", async () => {
    const probeGit = await freshProbe();
    const first = probeGit();
    expect(probeGit()).toBe(first);
    const found = await first;
    if (found !== null) expect(found.version).toMatch(/^\d/);
  });

  it("is none on a host whose PATH has no git, and stays none", async () => {
    const probeGit = await freshProbe();
    const PATH = process.env.PATH;
    process.env.PATH = "/nonexistent";
    try {
      expect(await probeGit()).toBeNull();
      expect(await probeGit()).toBeNull();
    } finally {
      process.env.PATH = PATH;
    }
  });
});
