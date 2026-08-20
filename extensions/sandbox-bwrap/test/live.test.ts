/**
 * Live enforcement for this backend against the real host: real bwrap, real spawns
 * through core's command sessions, real kernel denials.
 *
 * Host-gated — a package whose whole job is kernel confinement can only be proven on a
 * host that has bubblewrap; elsewhere the suite skips and profile.test.ts still pins
 * the profile and the fail-closed path. The backend is driven DIRECTLY here (no
 * SandboxService): what an extension package owes is that its own confinement works, and
 * routing/settings are the harness's behavior, tested there with fakes.
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { CommandSessionManager } from "@prismshadow/penguin-core";
import type { SandboxPolicy } from "@prismshadow/penguin-server/extension";
import { createPenguinBwrapProvider } from "../src/index.js";

const ws = mkdtempSync(path.join(tmpdir(), "penguin-bwrap-live-"));
const outsideProbe = path.join(homedir(), `penguin-bwrap-live-${process.pid}.txt`);
const provider = createPenguinBwrapProvider();

/** null = spawn unconfined; otherwise confine under this policy (workspaceRoot filled per spawn). */
let policy: Omit<SandboxPolicy, "workspaceRoot"> | null = null;

const usable = (() => {
  try {
    provider.confine(["true"], { mode: "read-only", workspaceRoot: ws });
    return true;
  } catch {
    return false;
  }
})();

const mgr = new CommandSessionManager({
  confineSpawn: () => (argv, opts) =>
    policy === null
      ? argv
      : provider.confine(argv, { ...policy, workspaceRoot: opts.workspaceDir }).argv,
  workspaceDir: ws,
});

async function run(cmd: string): Promise<{ code: number | null; out: string }> {
  const session = mgr.spawn({ cmd, cwd: ws });
  let out = "";
  for await (const chunk of session.collect(15000)) out += chunk;
  if (session.running) session.kill();
  return { code: session.exit?.code ?? null, out };
}

/**
 * Interfaces as the CONFINED process sees them: /proc/net/dev, a fresh procfs inside
 * the namespace — NOT /sys/class/net, which arrives through the read-only bind of `/`
 * and lists the HOST's interfaces whatever the network namespace holds. Probing /sys
 * here would report a failure that is not one, and once masked, a pass that is not one.
 */
const interfaces = (procNetDev: string): string[] =>
  procNetDev
    .split("\n")
    .slice(2)
    .map((line) => line.split(":")[0]!.trim())
    .filter(Boolean);

afterAll(() => {
  mgr.dispose();
  rmSync(ws, { recursive: true, force: true });
  rmSync(outsideProbe, { force: true });
});

describe.skipIf(!usable)("penguin-bwrap live enforcement (host-gated)", () => {
  it("fs-write: the workspace is writable, the world outside it is not", async () => {
    policy = { mode: "workspace-write" };
    const inside = await run("echo confined-ok > inside.txt && cat inside.txt");
    expect(inside.code).toBe(0);
    expect(inside.out).toContain("confined-ok");

    const outside = await run(`echo leak > ${JSON.stringify(outsideProbe)} 2>&1; echo exit=$?`);
    expect(existsSync(outsideProbe)).toBe(false);
    expect(outside.out).toMatch(/read-only file system|permission denied/i);
  });

  it("fs-write: reads outside the workspace still work, and read-only denies the workspace too", async () => {
    policy = { mode: "workspace-write" };
    expect((await run("head -c 1 /etc/hostname > /dev/null && echo READ_OK")).out).toContain(
      "READ_OK",
    );

    policy = { mode: "read-only" };
    const ro = await run("echo x > ro-probe.txt 2>&1; echo exit=$?");
    expect(existsSync(path.join(ws, "ro-probe.txt"))).toBe(false);
    expect(ro.out).toMatch(/read-only file system|permission denied/i);
  });

  it("fs-write: background children are confined with the wrapped shell", async () => {
    policy = { mode: "workspace-write" };
    const r = await run(
      `(sleep 0.2 && echo bg > ${JSON.stringify(outsideProbe)}) & wait; echo done`,
    );
    expect(r.out).toContain("done");
    expect(existsSync(outsideProbe)).toBe(false);
  });

  it("network: none leaves the process with loopback only and no resolution", async () => {
    policy = { mode: "workspace-write" };
    expect(interfaces((await run("cat /proc/net/dev")).out).length).toBeGreaterThan(1);

    policy = { mode: "workspace-write", network: "none" };
    expect(interfaces((await run("cat /proc/net/dev")).out)).toEqual(["lo"]);
    expect((await run("getent hosts github.com 2>&1; echo exit=$?")).out).toMatch(/exit=[^0]/);
  });

  it("mask-paths: a masked directory reads as empty and its secret is unreachable", async () => {
    // Deliberately NOT under /tmp: workspace-write mounts a tmpfs over /tmp, which
    // already hides whatever the host had there — a secret placed in /tmp would make
    // the unmasked baseline fail and the masked assertion pass vacuously.
    const secretDir = mkdtempSync(path.join(homedir(), "penguin-bwrap-secret-"));
    const secretFile = path.join(secretDir, "token.txt");
    writeFileSync(secretFile, "super-secret");
    try {
      policy = { mode: "workspace-write" };
      expect((await run(`cat ${JSON.stringify(secretFile)}`)).out).toContain("super-secret");

      policy = { mode: "workspace-write", maskPaths: [secretDir] };
      const masked = await run(
        `ls -A ${JSON.stringify(secretDir)}; cat ${JSON.stringify(secretFile)} 2>&1`,
      );
      expect(masked.out).not.toContain("super-secret");
      expect(masked.out).toMatch(/no such file|not found/i);
    } finally {
      rmSync(secretDir, { recursive: true, force: true });
    }
  });

  it("the policy is read per spawn: dropping it lifts confinement on the next command", async () => {
    policy = null;
    const r = await run(`echo unconfined > ${JSON.stringify(outsideProbe)}; echo exit=$?`);
    expect(r.code).toBe(0);
    expect(existsSync(outsideProbe)).toBe(true);
    rmSync(outsideProbe, { force: true });
  });
});
