/**
 * Unit tests for penguin-bwrap: the exact profile it builds for each dimension, and
 * its fail-closed behavior when bubblewrap is unusable. The probe is injected, so both
 * paths are deterministic on any host (a real-bwrap host also runs sandbox-live).
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bwrapProfileArgs, createPenguinBwrapProvider } from "../src/index.js";

const ARGV = ["bash", "-lc", "echo hi"] as const;
const WS = "/work/project";

/** argv slice between two markers, for asserting order without pinning the whole array. */
function after(argv: readonly string[], marker: string): readonly string[] {
  return argv.slice(argv.indexOf(marker));
}

describe("penguin-bwrap profile", () => {
  it("read-only: the world is read-only, nothing is writable, no network flag", () => {
    const args = bwrapProfileArgs({ mode: "read-only", workspaceRoot: WS });
    expect(args).toEqual([
      "--ro-bind",
      "/",
      "/",
      "--dev",
      "/dev",
      "--proc",
      "/proc",
      "--die-with-parent",
    ]);
  });

  // skipIf(win32): the profile echoes host path resolution, which turns the POSIX
  // workspace literal into a drive path — and bwrap never runs there anyway.
  it.skipIf(process.platform === "win32")(
    "workspace-write: the workspace and a tmpfs /tmp become writable",
    () => {
      const args = bwrapProfileArgs({ mode: "workspace-write", workspaceRoot: WS });
      expect(args).toContain("--tmpfs");
      expect(args.join(" ")).toContain(`--bind ${WS} ${WS}`);
      // /tmp is the tmpfs, never also a bind of the host's /tmp.
      expect(args.join(" ")).not.toContain("--bind /tmp /tmp");
    },
  );

  it("network: none adds --unshare-net; absent leaves the network alone", () => {
    expect(bwrapProfileArgs({ mode: "read-only", workspaceRoot: WS, network: "none" })).toContain(
      "--unshare-net",
    );
    expect(bwrapProfileArgs({ mode: "read-only", workspaceRoot: WS })).not.toContain(
      "--unshare-net",
    );
  });

  it("mask-paths: a directory becomes an empty tmpfs, a file is shadowed by /dev/null", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "penguin-mask-"));
    const file = path.join(dir, "secret.txt");
    writeFileSync(file, "shh");
    const sub = path.join(dir, "sub");
    mkdirSync(sub);
    try {
      const args = bwrapProfileArgs({
        mode: "read-only",
        workspaceRoot: WS,
        maskPaths: [sub, file],
      });
      expect(args.join(" ")).toContain(`--tmpfs ${sub}`);
      expect(args.join(" ")).toContain(`--ro-bind /dev/null ${file}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("mask-paths: a path that does not exist is skipped (nothing to hide)", () => {
    const args = bwrapProfileArgs({
      mode: "read-only",
      workspaceRoot: WS,
      maskPaths: [path.join(tmpdir(), "penguin-definitely-absent-path")],
    });
    expect(args.join(" ")).not.toContain("penguin-definitely-absent-path");
  });

  it("masks come AFTER the read-only bind of / that would otherwise expose them", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "penguin-mask-order-"));
    try {
      const args = bwrapProfileArgs({ mode: "read-only", workspaceRoot: WS, maskPaths: [dir] });
      // bwrap applies mounts in order: the mask must be in the tail after `--ro-bind / /`.
      expect(after(args, "--ro-bind").join(" ")).toContain(`--tmpfs ${dir}`);
      expect(args.indexOf(dir)).toBeGreaterThan(args.indexOf("--die-with-parent"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("penguin-bwrap provider", () => {
  it("implements every dimension of the built-in interface", () => {
    expect(createPenguinBwrapProvider({ probe: () => true }).dimensions).toEqual([
      "fs-write",
      "network",
      "mask-paths",
    ]);
  });

  it("wraps the caller's argv behind the profile and a -- separator", () => {
    const provider = createPenguinBwrapProvider({ probe: () => true, runner: "bwrap" });
    const confined = provider.confine([...ARGV], {
      mode: "workspace-write",
      workspaceRoot: WS,
      network: "none",
    });
    expect(confined.argv[0]).toBe("bwrap");
    expect(confined.argv.slice(-3)).toEqual([...ARGV]);
    expect(confined.argv[confined.argv.length - 4]).toBe("--");
    expect(confined.argv).toContain("--unshare-net");
    expect(confined.enforcement).toBe("full");
  });

  it("an unusable bwrap fails closed, and the probe runs once", () => {
    let probes = 0;
    const provider = createPenguinBwrapProvider({
      probe: () => {
        probes++;
        return false;
      },
    });
    const policy = { mode: "read-only", workspaceRoot: WS } as const;
    expect(() => provider.confine([...ARGV], policy)).toThrow(/cannot confine on this host/);
    expect(() => provider.confine([...ARGV], policy)).toThrow(/cannot confine on this host/);
    expect(probes).toBe(1);
  });
});
