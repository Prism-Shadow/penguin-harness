/**
 * Live enforcement for the DSH adaptor against the real host: the real DSH chain
 * (bwrap → Landlock on Linux, Seatbelt on macOS, the ACL runner on Windows), real
 * spawns through core's command sessions, real kernel denials.
 *
 * Host-gated the way DSH gates its own backend e2e: one real confine decides
 * usability, and a host with no usable backend skips — unless the run names `sandbox-dsh`
 * in PENGUIN_MUST_RUN, and then it fails with the reason (see liveSuite below). The
 * adaptor is driven DIRECTLY (no SandboxService): what this package owes is that DSH's
 * confinement works behind our interface; routing and settings are the harness's
 * behavior, tested there.
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { CommandSessionManager } from "@prismshadow/penguin-core";
import type { SandboxProvider } from "@prismshadow/penguin-core/plugin";
import { loadDshAdaptor } from "../src/index.js";

const ws = mkdtempSync(path.join(tmpdir(), "penguin-dsh-live-"));
const outsideProbe = path.join(homedir(), `penguin-dsh-live-${process.pid}.txt`);

/**
 * Whether a live suite runs, skips, or fails, given why this host cannot open it (null: it
 * can). PENGUIN_MUST_RUN is a comma-separated list of the environment-dependent suites a run
 * REQUIRES, each named by its directory under plugins/ (this one is `sandbox-dsh`): CI sets it
 * per platform, so a host that stops opening a named suite turns the run red with the probe's
 * reason instead of skipping — a skip reads like a pass. A suite the run does not name skips
 * where it cannot open, as on a developer's machine.
 *
 * A copy of the one in sandbox-bwrap's live suite, where its unit test lives: three test files
 * read one environment variable, and the three plugins share no test-only package to hold it
 * (each depends on core alone, which is no place for a test knob). Keep the copies identical;
 * they move into a shared helper once a suite outside the sandbox plugins reads PENGUIN_MUST_RUN.
 * Known weakness: each suite recognises only its own name, so a misspelled name in
 * PENGUIN_MUST_RUN is silently ignored.
 */
function liveSuite(
  suite: string,
  cannotOpen: string | null,
  env: NodeJS.ProcessEnv = process.env,
): "run" | "skip" | { fail: string } {
  if (cannotOpen === null) return "run";
  const required = (env.PENGUIN_MUST_RUN ?? "").split(",");
  if (!required.some((name) => name.trim() === suite)) return "skip";
  return {
    fail: `PENGUIN_MUST_RUN requires ${suite}, and this host cannot open it: ${cannotOpen}`,
  };
}

/** The adaptor, and why this host cannot open the suite (null: it can) — the reason DSH gave. */
const { provider, cannotOpen } = await (async (): Promise<{
  provider: SandboxProvider | null;
  cannotOpen: string | null;
}> => {
  let loaded: SandboxProvider | null = null;
  try {
    loaded = await loadDshAdaptor();
    if (loaded === null) return { provider: null, cannotOpen: "the DSH adaptor did not load" };
    loaded.confine(["true"], { mode: "workspace-write", workspaceRoot: ws });
    return { provider: loaded, cannotOpen: null };
  } catch (err) {
    return { provider: loaded, cannotOpen: err instanceof Error ? err.message : String(err) };
  }
})();

/** null = spawn unconfined; otherwise confine under this mode. */
let mode: "read-only" | "workspace-write" | null = null;

const verdict = liveSuite("sandbox-dsh", cannotOpen);
const usable = verdict === "run";

const mgr = new CommandSessionManager({
  confineSpawn: () => (argv, opts) =>
    mode === null || provider === null
      ? { argv }
      : provider.confine(argv, { mode, workspaceRoot: opts.workspaceDir }),
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
 * The denial DIALECT depends on which rung the chain selected — EROFS text under
 * bwrap's read-only binds, EACCES under Landlock, EPERM under Seatbelt, and the
 * Windows ACL runner's own wording. That is exactly why ConfinedArgv carries
 * denialSignatures; assert the effect plus a denial in any dialect, never one rung's.
 */
const DENIED = /permission denied|read-only file system|operation not permitted|access is denied/i;

afterAll(() => {
  mgr.dispose();
  rmSync(ws, { recursive: true, force: true });
  rmSync(outsideProbe, { force: true });
});

// skipIf(win32) is NOT a capability gate: the usability gate does open there — the ACL
// chain loads and the kernel denial fires (observed on CI as UTF-16 "Access is denied"
// from the runner). What is missing is a cmd-dialect probe set: these probes are POSIX
// shell (head, /etc/hosts, `(…) & wait`) and the assertions decode UTF-8. TODO(win32):
// a Windows probe set with UTF-16-tolerant denial matching, as its own change.
if (typeof verdict === "object") {
  it("DSH adaptor live enforcement opens on this host", () => {
    throw new Error(verdict.fail);
  });
}

describe.skipIf(!usable || process.platform === "win32")(
  "DSH adaptor live enforcement (host-gated)",
  () => {
    it("workspace-write: writes inside the workspace work, reads outside still work", async () => {
      mode = "workspace-write";
      // /etc/hosts, not /etc/hostname: the read probe must exist on every POSIX host the
      // usability gate can open, and macOS has no /etc/hostname.
      const r = await run(
        "echo confined-ok > inside.txt && cat inside.txt && head -c 1 /etc/hosts > /dev/null && echo READ_OK",
      );
      expect(r.code).toBe(0);
      expect(r.out).toContain("confined-ok");
      expect(r.out).toContain("READ_OK");
    });

    it("workspace-write: a write outside the workspace is denied by the kernel", async () => {
      mode = "workspace-write";
      const r = await run(`echo leak > ${JSON.stringify(outsideProbe)} 2>&1; echo exit=$?`);
      expect(existsSync(outsideProbe)).toBe(false);
      expect(r.out).toMatch(DENIED);
    });

    it("workspace-write: background children are confined with the wrapped shell", async () => {
      mode = "workspace-write";
      const r = await run(
        `(sleep 0.2 && echo bg > ${JSON.stringify(outsideProbe)}) & wait; echo done`,
      );
      expect(r.out).toContain("done");
      expect(existsSync(outsideProbe)).toBe(false);
    });

    it("read-only: even the workspace is not writable", async () => {
      mode = "read-only";
      const r = await run("echo x > ro-probe.txt 2>&1; echo exit=$?");
      expect(existsSync(path.join(ws, "ro-probe.txt"))).toBe(false);
      expect(r.out).toMatch(DENIED);
    });

    it("the policy is read per spawn: dropping it lifts confinement on the next command", async () => {
      mode = null;
      const r = await run(`echo unconfined > ${JSON.stringify(outsideProbe)}; echo exit=$?`);
      expect(r.code).toBe(0);
      expect(existsSync(outsideProbe)).toBe(true);
      rmSync(outsideProbe, { force: true });
    });
  },
);
