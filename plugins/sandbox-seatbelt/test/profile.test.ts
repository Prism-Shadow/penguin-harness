/**
 * Unit tests for the Seatbelt backend: the exact SBPL it generates per dimension, the
 * rule ORDER that makes masking outrank the write allowances, and its fail-closed
 * behavior where sandbox-exec is unusable. The probe is injected, so these run on any
 * host — a macOS box also runs live.test.ts.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  canonicalPath,
  createSeatbeltProvider,
  defaultRunner,
  loadSeatbeltProvider,
  seatbeltProfile,
  SYSTEM_RUNNER,
  writableRoots,
} from "../src/index.js";

const ARGV = ["bash", "-lc", "echo hi"] as const;
const WS = "/work/project";

// skipIf(win32): the SBPL path rules echo host path canonicalization (drive letters,
// backslash escaping), and Seatbelt never runs there anyway.
describe.skipIf(process.platform === "win32")("seatbelt profile", () => {
  it("read-only: writes are denied except the required sinks; no network rule", () => {
    const profile = seatbeltProfile({ mode: "read-only", workspaceRoot: WS });
    expect(profile).toContain("(version 1)");
    expect(profile).toContain("(allow default)");
    expect(profile).toContain("(deny file-write*)");
    expect(profile).toContain('(literal "/dev/null")');
    expect(profile).not.toContain("(deny network*)");
    expect(profile).not.toContain(`(subpath "${WS}")`);
  });

  it("workspace-write: the workspace becomes writable, and the temp areas only when temp is", () => {
    const profile = seatbeltProfile({ mode: "workspace-write", workspaceRoot: WS });
    expect(profile).toContain(`(allow file-write* (subpath "${canonicalPath(WS)}")`);
    expect(profile).not.toContain(`(subpath "${canonicalPath(tmpdir())}")`);
    const withTemp = seatbeltProfile({
      mode: "workspace-write",
      workspaceRoot: WS,
      writableTemp: true,
    });
    expect(withTemp).toContain(`(subpath "${canonicalPath(tmpdir())}")`);
  });

  it("read-only with writable temp: the temp areas are the only writable roots", () => {
    expect(writableRoots({ mode: "read-only", workspaceRoot: WS, writableTemp: true })).toEqual([
      ...new Set(["/tmp", tmpdir()].map(canonicalPath)),
    ]);
  });

  it("full access denies no writes, yet still cuts the network when asked", () => {
    const profile = seatbeltProfile({
      mode: "danger-full-access",
      workspaceRoot: WS,
      network: "none",
    });
    // No write denial at all — "(allow default)" already permits every file write.
    expect(profile).not.toContain("(deny file-write*)");
    // The network cut still applies.
    expect(profile).toContain("(deny network*)");
  });

  it("network: local denies every socket, then lets the host's localhost back in", () => {
    const profile = seatbeltProfile({
      mode: "workspace-write",
      workspaceRoot: WS,
      network: "local",
    });
    const deny = profile.indexOf("(deny network*)");
    expect(deny).toBeGreaterThan(-1);
    for (const form of [
      '(allow network-outbound (remote ip "localhost:*"))',
      '(allow network-bind (local ip "localhost:*"))',
      '(allow network-inbound (local ip "localhost:*"))',
    ]) {
      // Later rules win in SBPL: each allowance comes after the blanket denial.
      expect(profile.indexOf(form)).toBeGreaterThan(deny);
    }
  });

  it("network: none denies every socket", () => {
    expect(seatbeltProfile({ mode: "read-only", workspaceRoot: WS, network: "none" })).toContain(
      "(deny network*)",
    );
  });

  it("mask-paths: a masked path is denied for read AND write", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "penguin-sb-mask-"));
    try {
      const profile = seatbeltProfile({
        mode: "read-only",
        workspaceRoot: WS,
        maskPaths: [dir],
      });
      expect(profile).toContain(`(deny file-read* file-write* (subpath "${canonicalPath(dir)}"))`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("masks come LAST, so masking a path inside the workspace still wins", () => {
    // SBPL's last matching rule wins — the inverse of bwrap's first-mount-then-shadow,
    // and the reason this ordering is asserted rather than assumed.
    const inside = path.join(WS, "secrets");
    const profile = seatbeltProfile({
      mode: "workspace-write",
      workspaceRoot: WS,
      maskPaths: [inside],
    });
    expect(
      profile.indexOf(`(deny file-read* file-write* (subpath "${canonicalPath(inside)}"))`),
    ).toBeGreaterThan(profile.indexOf("(allow file-write* (subpath"));
  });

  it("paths are canonicalized: an uncanonicalized subpath rule would match nothing on macOS", () => {
    // /tmp is a symlink to /private/tmp on macOS; on Linux realpath is a no-op, so the
    // assertion is the invariant itself — what lands in the profile is the real path.
    const real = canonicalPath("/tmp");
    expect(seatbeltProfile({ mode: "workspace-write", workspaceRoot: "/tmp" })).toContain(
      `(subpath "${real}")`,
    );
    expect(writableRoots({ mode: "workspace-write", workspaceRoot: "/tmp" })).toContain(real);
  });

  it("SBPL strings escape quotes and backslashes", () => {
    const weird = '/tmp/we"ird\\path';
    const profile = seatbeltProfile({ mode: "read-only", workspaceRoot: "/", maskPaths: [weird] });
    expect(profile).toContain('we\\"ird\\\\path');
  });
});

describe("seatbelt provider", () => {
  it("implements every dimension of the sandbox interface", () => {
    expect(createSeatbeltProvider({ probe: () => true }).dimensions).toEqual([
      "fs-write",
      "network",
      "network-local",
      "mask-paths",
    ]);
  });

  it("wraps the caller's argv behind -p <profile> and a -- separator", () => {
    const provider = createSeatbeltProvider({ probe: () => true, runner: "sandbox-exec" });
    const confined = provider.confine([...ARGV], {
      mode: "workspace-write",
      workspaceRoot: WS,
      network: "none",
    });
    expect(confined.argv[0]).toBe("sandbox-exec");
    expect(confined.argv[1]).toBe("-p");
    expect(confined.argv[2]).toContain("(deny network*)");
    expect(confined.argv[3]).toBe("--");
    expect(confined.argv.slice(4)).toEqual([...ARGV]);
    expect(confined.enforcement).toBe("full");
  });

  it("an unusable sandbox-exec (every non-macOS host) fails closed, probing once", () => {
    let probes = 0;
    const provider = createSeatbeltProvider({
      probe: () => {
        probes++;
        return false;
      },
    });
    const policy = { mode: "read-only", workspaceRoot: WS } as const;
    expect(() => provider.confine([...ARGV], policy)).toThrow(/cannot confine on this host/);
    expect(() => provider.confine([...ARGV], policy)).toThrow(/only on macOS/);
    expect(probes).toBe(1);
  });
});

describe("seatbelt on another platform", () => {
  it("declines off macOS (not a failure), and fails with a reason on macOS it cannot serve", async () => {
    const other = "linux" as const;
    await expect(loadSeatbeltProvider({ platform: other, probe: () => true })).resolves.toBeNull();
    await expect(loadSeatbeltProvider({ platform: "darwin", probe: () => false })).rejects.toThrow(
      /is missing or refuses/,
    );
    await expect(
      loadSeatbeltProvider({ platform: "darwin", probe: () => true }),
    ).resolves.toBeDefined();
  });
});

describe("the sandbox-exec it runs", () => {
  it("names the macOS program by its absolute path, so PATH cannot decide what confines", () => {
    expect(SYSTEM_RUNNER).toBe("/usr/bin/sandbox-exec");
    expect(defaultRunner(() => true)).toBe(SYSTEM_RUNNER);
    // A host without it (or any non-macOS machine running these tests) falls back to a lookup,
    // and the load-time probe is what rejects a host where nothing answers.
    expect(defaultRunner(() => false)).toBe("sandbox-exec");
  });
});
