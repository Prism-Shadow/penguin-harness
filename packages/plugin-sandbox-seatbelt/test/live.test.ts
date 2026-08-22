/**
 * Live enforcement against a real macOS host: real sandbox-exec, real spawns through
 * core's command sessions, real kernel denials.
 *
 * Host-gated — this suite can only run where Seatbelt exists, so it skips everywhere
 * else and profile.test.ts carries the deterministic coverage. Written to be the exact
 * counterpart of the bwrap package's live suite, so the two backends are held to the
 * same behavioral bar.
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { CommandSessionManager } from "@prismshadow/penguin-core";
import type { SandboxPolicy } from "@prismshadow/penguin-server/plugin";
import { canonicalPath, createSeatbeltProvider } from "../src/index.js";

const ws = canonicalPath(mkdtempSync(path.join(tmpdir(), "penguin-seatbelt-live-")));
const outsideProbe = path.join(homedir(), `penguin-seatbelt-live-${process.pid}.txt`);
const provider = createSeatbeltProvider();

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
      : provider.confine(argv, { ...policy, workspaceRoot: canonicalPath(opts.workspaceDir) }).argv,
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
