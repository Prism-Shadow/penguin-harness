/**
 * Live enforcement against a real macOS host: real sandbox-exec, real spawns through
 * core's command sessions, real kernel denials.
 *
 * Host-gated — this suite can only run where Seatbelt exists, so it skips everywhere
 * else and profile.test.ts carries the deterministic coverage — unless the run names
 * `seatbelt` in PENGUIN_SANDBOX_LIVE, and then a host that cannot open it fails with the
 * reason (see liveSuite below). Written to be the exact counterpart of the bwrap
 * package's live suite, so the two backends are held to the same behavioral bar.
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { CommandSessionManager } from "@prismshadow/penguin-core";
import type { SandboxPolicy } from "@prismshadow/penguin-core/plugin";
import { canonicalPath, createSeatbeltProvider } from "../src/index.js";

const ws = canonicalPath(mkdtempSync(path.join(tmpdir(), "penguin-seatbelt-live-")));
const outsideProbe = path.join(homedir(), `penguin-seatbelt-live-${process.pid}.txt`);
const provider = createSeatbeltProvider();

/** null = spawn unconfined; otherwise confine under this policy (workspaceRoot filled per spawn). */
let policy: Omit<SandboxPolicy, "workspaceRoot"> | null = null;

/**
 * Whether a live suite runs, skips, or fails, given why this host cannot open its backend
 * (null: it can). PENGUIN_SANDBOX_LIVE is a comma-separated list of the backends whose live
 * suites a run REQUIRES: CI sets it per platform, so a host that stops opening a backend turns
 * the run red with the probe's reason instead of skipping — a skip reads like a pass. A backend
 * the run does not name skips where it cannot open, as on a developer's machine.
 *
 * A copy of the one in sandbox-bwrap's live suite, where its unit test lives: three test files
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

/** Why this host cannot open the suite (null: it can) — the reason the backend refused with. */
const cannotOpen = (() => {
  try {
    provider.confine(["true"], { mode: "read-only", workspaceRoot: ws });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
})();

const verdict = liveSuite("seatbelt", cannotOpen);
const usable = verdict === "run";

const mgr = new CommandSessionManager({
  confineSpawn: () => (argv, opts) =>
    policy === null
      ? { argv }
      : provider.confine(argv, { ...policy, workspaceRoot: canonicalPath(opts.workspaceDir) }),
  workspaceDir: ws,
});

async function run(cmd: string): Promise<{ code: number | null; out: string }> {
  const session = mgr.spawn({ cmd, cwd: ws });
  let out = "";
  for await (const chunk of session.collect(15000)) out += chunk;
  if (session.running) session.kill();
  return { code: session.exit?.code ?? null, out };
}

const DENIED = /operation not permitted|permission denied/i;

afterAll(() => {
  mgr.dispose();
  rmSync(ws, { recursive: true, force: true });
  rmSync(outsideProbe, { force: true });
});

if (typeof verdict === "object") {
  it("penguin-seatbelt live enforcement opens on this host", () => {
    throw new Error(verdict.fail);
  });
}

describe.skipIf(!usable)("penguin-seatbelt live enforcement (host-gated)", () => {
  it("fs-write: the workspace is writable, the world outside it is not", async () => {
    policy = { mode: "workspace-write" };
    const inside = await run("echo confined-ok > inside.txt && cat inside.txt");
    expect(inside.code).toBe(0);
    expect(inside.out).toContain("confined-ok");

    const outside = await run(`echo leak > ${JSON.stringify(outsideProbe)} 2>&1; echo exit=$?`);
    expect(existsSync(outsideProbe)).toBe(false);
    expect(outside.out).toMatch(DENIED);
  });

  it("fs-write: reads outside the workspace still work, and read-only denies the workspace too", async () => {
    policy = { mode: "workspace-write" };
    expect((await run("head -c 1 /etc/hosts > /dev/null && echo READ_OK")).out).toContain(
      "READ_OK",
    );

    policy = { mode: "read-only" };
    const ro = await run("echo x > ro-probe.txt 2>&1; echo exit=$?");
    expect(existsSync(path.join(ws, "ro-probe.txt"))).toBe(false);
    expect(ro.out).toMatch(DENIED);
  });

  it("network: none blocks sockets and name resolution", async () => {
    // nslookup, not getent: this host-gated suite only ever runs on macOS, which has no
    // getent. The SAME probe first passes without the network dimension, so its later
    // failure is attributable to the sandbox rather than to a missing tool or DNS.
    const LOOKUP = "nslookup -timeout=2 github.com > /dev/null 2>&1; echo exit=$?";
    policy = { mode: "workspace-write" };
    expect((await run(LOOKUP)).out).toContain("exit=0");

    policy = { mode: "workspace-write", network: "none" };
    // Any socket at all is denied, so both a raw connect and a DNS lookup fail.
    expect((await run("nc -z -G 1 127.0.0.1 22 2>&1; echo exit=$?")).out).toMatch(/exit=[^0]/);
    expect((await run(LOOKUP)).out).toMatch(/exit=[^0]/);
  });

  it("mask-paths: a masked directory's secret is unreadable", async () => {
    const secretDir = mkdtempSync(path.join(homedir(), "penguin-seatbelt-secret-"));
    const secretFile = path.join(secretDir, "token.txt");
    writeFileSync(secretFile, "super-secret");
    try {
      policy = { mode: "workspace-write" };
      expect((await run(`cat ${JSON.stringify(secretFile)}`)).out).toContain("super-secret");

      policy = { mode: "workspace-write", maskPaths: [secretDir] };
      const masked = await run(`cat ${JSON.stringify(secretFile)} 2>&1`);
      expect(masked.out).not.toContain("super-secret");
      expect(masked.out).toMatch(DENIED);
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
