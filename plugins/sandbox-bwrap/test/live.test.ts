/**
 * Live enforcement for this backend against the real host: real bwrap, real spawns
 * through core's command sessions, real kernel denials.
 *
 * Host-gated — a package whose whole job is kernel confinement can only be proven on a
 * host that has bubblewrap; elsewhere the suite skips and profile.test.ts still pins
 * the profile and the fail-closed path — unless the run names `bwrap` in
 * PENGUIN_SANDBOX_LIVE, and then a host that cannot open it fails with the reason (see
 * liveSuite below). The bubblewrap under test is the one the plugin ships, which this
 * package's global setup (test/global-setup.ts) puts in place on Linux when it is
 * missing. The backend is driven DIRECTLY here (no SandboxService): what a plugin
 * package owes is that its own confinement works, and
 * routing/settings are the harness's behavior, tested there with fakes.
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { CommandSessionManager } from "@prismshadow/penguin-core";
import type { SandboxPolicy } from "@prismshadow/penguin-core/plugin";
import { createPenguinBwrapProvider, loadPenguinBwrapProvider } from "../src/index.js";
import { prepareVendoredBwrap } from "./global-setup.js";

const ws = mkdtempSync(path.join(tmpdir(), "penguin-bwrap-live-"));
const outsideProbe = path.join(homedir(), `penguin-bwrap-live-${process.pid}.txt`);
const provider = createPenguinBwrapProvider();

/** null = spawn unconfined; otherwise confine under this policy (workspaceRoot filled per spawn). */
let policy: Omit<SandboxPolicy, "workspaceRoot"> | null = null;

/**
 * Whether a live suite runs, skips, or fails, given why this host cannot open its backend
 * (null: it can). PENGUIN_SANDBOX_LIVE is a comma-separated list of the backends whose live
 * suites a run REQUIRES: CI sets it per platform, so a host that stops opening a backend turns
 * the run red with the probe's reason instead of skipping — a skip reads like a pass. A backend
 * the run does not name skips where it cannot open, as on a developer's machine.
 *
 * The same few lines live in the sandbox-dsh and sandbox-seatbelt live suites: three test files
 * read one environment variable, and the three plugins share no test-only package to hold it
 * (each depends on core alone, which is no place for a test knob). Keep the copies identical.
 */
function liveSuite(
  backend: string,
  cannotOpen: string | null,
  env: NodeJS.ProcessEnv = process.env,
): "run" | "skip" | { fail: string } {
  if (cannotOpen === null) return "run";
  const required = (env.PENGUIN_SANDBOX_LIVE ?? "").split(",");
  if (!required.some((name) => name.trim() === backend)) return "skip";
  return {
    fail: `PENGUIN_SANDBOX_LIVE requires the ${backend} live suite, and this host cannot open it: ${cannotOpen}`,
  };
}

/**
 * Why this host cannot open the suite, or null. The load-time check gives the reason a refusal
 * has (on Ubuntu, the user-namespace switch it names); the confine is the suite's own first step.
 */
async function hostCannotOpen(): Promise<string | null> {
  try {
    if ((await loadPenguinBwrapProvider()) === null) return "penguin-bwrap runs on Linux only";
    provider.confine(["true"], { mode: "read-only", workspaceRoot: ws });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

const verdict = liveSuite("bwrap", await hostCannotOpen());
const usable = verdict === "run";

const mgr = new CommandSessionManager({
  confineSpawn: () => (argv, opts) =>
    policy === null
      ? { argv }
      : provider.confine(argv, { writableTemp: true, ...policy, workspaceRoot: opts.workspaceDir }),
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

describe("PENGUIN_SANDBOX_LIVE and the bubblewrap under test", () => {
  it("a backend the run requires fails instead of skipping", () => {
    const reason = "'bwrap' is missing or refuses the base profile";
    const cannotOpen = (live?: string) =>
      liveSuite("bwrap", reason, live === undefined ? {} : { PENGUIN_SANDBOX_LIVE: live });
    expect(cannotOpen("bwrap,dsh")).toEqual({
      fail: `PENGUIN_SANDBOX_LIVE requires the bwrap live suite, and this host cannot open it: ${reason}`,
    });
    expect(cannotOpen(" dsh , bwrap ")).toHaveProperty("fail");
    // Not named (or named only as part of another name): skips, as it always has.
    expect(cannotOpen(undefined)).toBe("skip");
    expect(cannotOpen("")).toBe("skip");
    expect(cannotOpen("dsh,seatbelt,bwrap2")).toBe("skip");
    // A host that opens it runs it, named or not.
    expect(liveSuite("bwrap", null, { PENGUIN_SANDBOX_LIVE: "bwrap" })).toBe("run");
    expect(liveSuite("bwrap", null, {})).toBe("run");
  });

  it("the suite fetches the bubblewrap it ships when it is missing", async () => {
    let vendored = 0;
    let present = false;
    const prepare = (platform: NodeJS.Platform) =>
      prepareVendoredBwrap({
        platform,
        arch: "x64",
        present: () => present,
        vendor: async () => {
          vendored++;
          present = true;
        },
      });
    expect(await prepare("darwin")).toBe("not-linux");
    expect(await prepare("win32")).toBe("not-linux");
    expect(vendored).toBe(0);
    expect(await prepare("linux")).toBe("vendored");
    expect(vendored).toBe(1);
    // In place now: no second fetch.
    expect(await prepare("linux")).toBe("present");
    expect(vendored).toBe(1);
  });
});

if (typeof verdict === "object") {
  it("penguin-bwrap live enforcement opens on this host", () => {
    throw new Error(verdict.fail);
  });
}

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
