/**
 * Live enforcement for this backend against the real host: real bwrap, real spawns
 * through core's command sessions, real kernel denials.
 *
 * Host-gated — a package whose whole job is kernel confinement can only be proven on a
 * host that has bubblewrap; elsewhere the suite skips and profile.test.ts still pins
 * the profile and the fail-closed path (unless PENGUIN_MUST_RUN names it; see
 * scripts/must-run.mjs). The backend is driven DIRECTLY here (no
 * SandboxService): what a plugin package owes is that its own confinement works, and
 * routing/settings are the harness's behavior, tested there with fakes.
 *
 * Exception: the last describe drives the server's SandboxService (imported by path; this
 * package depends on core alone), which creates the scratchpad bwrap binds.
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CommandSessionManager } from "@prismshadow/penguin-core";
import type { SpawnConfiner } from "@prismshadow/penguin-core";
import type { SandboxPolicy, SandboxProviderSource } from "@prismshadow/penguin-core/plugin";
import { createPenguinBwrapProvider, loadPenguinBwrapProvider } from "../src/index.js";
import { mustRun } from "../../../scripts/must-run.mjs";

/** The slice of the server's SandboxService these cases drive. */
interface ServiceUnderTest {
  whenReady(): Promise<void>;
  confinerFor(policyOf: () => { mode: "workspace-write" }): SpawnConfiner;
}
const { SandboxService } = (await import(
  fileURLToPath(new URL("../../../packages/server/src/sandbox/index.ts", import.meta.url))
)) as {
  SandboxService: new (
    registrations: Iterable<[string, SandboxProviderSource]>,
  ) => ServiceUnderTest;
};

const ws = mkdtempSync(path.join(tmpdir(), "penguin-bwrap-live-"));
const outsideProbe = path.join(homedir(), `penguin-bwrap-live-${process.pid}.txt`);
const provider = createPenguinBwrapProvider();

/** null = spawn unconfined; otherwise confine under this policy (workspaceRoot filled per spawn). */
let policy: Omit<SandboxPolicy, "workspaceRoot"> | null = null;

const cannotOpen = await (async () => {
  try {
    if ((await loadPenguinBwrapProvider()) === null) return "penguin-bwrap runs on Linux only";
    provider.confine(["true"], { mode: "read-only", workspaceRoot: ws });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
})();
const usable = mustRun("sandbox-bwrap", cannotOpen);

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

describe.skipIf(!usable)("penguin-bwrap behind the sandbox service: the Session scratchpad", () => {
  it("a command writes to a scratchpad not created yet, or deleted mid-Session", async () => {
    // Under the read-only home, not /tmp: a file reaching the host came through the bind itself.
    const agentScratchpad = mkdtempSync(path.join(homedir(), "penguin-bwrap-scratchpad-"));
    const scratchpad = path.join(agentScratchpad, "session-1");
    const svc = new SandboxService([["penguin-bwrap", provider]]);
    await svc.whenReady();
    const confiner = svc.confinerFor(() => ({ mode: "workspace-write" }));
    const served = new CommandSessionManager({
      confineSpawn: () => confiner,
      workspaceDir: ws,
      scratchpadDir: scratchpad,
    });
    try {
      for (const file of ["a.txt", "b.txt"]) {
        // Without the service creating it, bwrap exits first: "Can't find source path".
        expect(existsSync(scratchpad)).toBe(false);
        const session = served.spawn({
          cmd: `echo ${file} > ${JSON.stringify(path.join(scratchpad, file))}`,
          cwd: ws,
        });
        let out = "";
        for await (const chunk of session.collect(15000)) out += chunk;
        expect(session.exit?.code, out).toBe(0);
        expect(readFileSync(path.join(scratchpad, file), "utf8")).toBe(`${file}\n`);
        rmSync(scratchpad, { recursive: true, force: true });
      }
    } finally {
      served.dispose();
      rmSync(agentScratchpad, { recursive: true, force: true });
    }
  });
});
