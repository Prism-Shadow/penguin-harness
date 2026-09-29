/**
 * Live enforcement for the DSH adaptor against the real host: the real DSH chain
 * (bwrap → Landlock on Linux, Seatbelt on macOS, the ACL runner on Windows), real
 * spawns through core's command sessions, real kernel denials.
 *
 * Host-gated the way DSH gates its own backend e2e: one real confine decides
 * usability, and a host with no usable backend skips (unless PENGUIN_MUST_RUN names it;
 * see scripts/must-run.mjs). The adaptor is driven DIRECTLY
 * (no SandboxService): what this package owes is that DSH's confinement works behind
 * our interface; routing and settings are the harness's behavior, tested there.
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { CommandSessionManager } from "@prismshadow/penguin-core";
import type { SandboxProvider } from "@prismshadow/penguin-core/plugin";
import { loadDshAdaptor } from "../src/index.js";
import { mustRun } from "../../../scripts/must-run.mjs";

const win32 = process.platform === "win32";

// Windows runs the probes through PowerShell, the shell DSH's ACL runner is built and tested
// for. The harness's own Windows default, bash (Git for Windows, or the bundled MinGit), does
// not run under the runner, measured on windows-latest: handed the bare name, the runner's
// CreateProcessAsUserW search reaches System32's WSL launcher before PATH ("Bash/Service/
// CreateInstance/E_ACCESSDENIED", fork CI run 36579953129); handed Git's bash.exe by path,
// the MSYS runtime aborts under the write-restricted token ("CreateFileMapping S-1-5-21-…,
// Win32 error 5", run 36581181568). TODO(win32): so a bash session confined by DSH is not
// guaranteed on Windows; only pwsh is. Set before the first spawn: core resolves the session
// shell once per process.
if (win32) process.env.PENGUIN_SHELL = "pwsh";

const ws = mkdtempSync(path.join(tmpdir(), "penguin-dsh-live-"));
const outsideProbe = path.join(homedir(), `penguin-dsh-live-${process.pid}.txt`);

let loadError = "the DSH adaptor did not load";
const provider: SandboxProvider | null = await loadDshAdaptor().catch((err: unknown) => {
  loadError = err instanceof Error ? err.message : String(err);
  return null;
});

/** null = spawn unconfined; otherwise confine under this mode. */
let mode: "read-only" | "workspace-write" | null = null;

const cannotOpen =
  provider === null
    ? loadError
    : (() => {
        try {
          provider.confine(["true"], { mode: "workspace-write", workspaceRoot: ws });
          return null;
        } catch (err) {
          return err instanceof Error ? err.message : String(err);
        }
      })();

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

/** A PowerShell single-quoted literal: nothing inside is expanded, `'` doubles. */
const ps = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** A file outside the workspace every gated host can read (macOS has no /etc/hostname). */
const readProbe = win32 ? process.execPath : "/etc/hosts";

/**
 * One probe per test, in the session shell's dialect. Each Windows probe has the POSIX one's
 * effect: a failed write prints its error and the probe carries on, and the background probe
 * is a child process the confined shell starts, which inherits the restricted token.
 */
const probes = win32
  ? {
      insideAndRead: `$ErrorActionPreference = 'Stop'; Set-Content -LiteralPath inside.txt -Value confined-ok; Get-Content -LiteralPath inside.txt; $null = Get-Content -AsByteStream -TotalCount 1 -LiteralPath ${ps(readProbe)}; 'READ_OK'`,
      writeOutside: `try { Set-Content -LiteralPath ${ps(outsideProbe)} -Value leak -ErrorAction Stop } catch { $_.Exception.Message }`,
      backgroundOutside: `Start-Process -FilePath cmd.exe -ArgumentList ${ps(`/d /c echo bg > "${outsideProbe}"`)} -NoNewWindow -Wait; 'done'`,
      writeWorkspace: `try { Set-Content -LiteralPath ro-probe.txt -Value x -ErrorAction Stop } catch { $_.Exception.Message }`,
      writeOutsideUnconfined: `Set-Content -LiteralPath ${ps(outsideProbe)} -Value unconfined`,
    }
  : {
      insideAndRead: `echo confined-ok > inside.txt && cat inside.txt && head -c 1 ${readProbe} > /dev/null && echo READ_OK`,
      writeOutside: `echo leak > ${JSON.stringify(outsideProbe)} 2>&1; echo exit=$?`,
      backgroundOutside: `(sleep 0.2 && echo bg > ${JSON.stringify(outsideProbe)}) & wait; echo done`,
      writeWorkspace: "echo x > ro-probe.txt 2>&1; echo exit=$?",
      writeOutsideUnconfined: `echo unconfined > ${JSON.stringify(outsideProbe)}; echo exit=$?`,
    };

// The session shell must be the one the probes are written for: a Windows host without pwsh
// (PowerShell 7) cannot open the suite, which one unconfined probe decides.
const shellReady =
  !win32 || (await run("'pwsh-' + $PSVersionTable.PSEdition")).out.trim() === "pwsh-Core";

const usable = mustRun(
  "sandbox-dsh",
  cannotOpen ?? (shellReady ? null : "the session shell is not pwsh (PowerShell 7), which the probes are written for"),
);

/**
 * The denial DIALECT depends on which rung the chain selected — EROFS text under
 * bwrap's read-only binds, EACCES under Landlock, EPERM under Seatbelt, and .NET's
 * "Access to the path '…' is denied." under the Windows ACL runner. That is exactly why
 * ConfinedArgv carries denialSignatures; assert the effect plus a denial in any dialect,
 * never one rung's.
 */
const DENIED =
  /permission denied|read-only file system|operation not permitted|access is denied|access to the path .* is denied/i;

afterAll(() => {
  mgr.dispose();
  rmSync(ws, { recursive: true, force: true });
  rmSync(outsideProbe, { force: true });
});

describe.skipIf(!usable)("DSH adaptor live enforcement (host-gated)", () => {
  it("workspace-write: writes inside the workspace work, reads outside still work", async () => {
    mode = "workspace-write";
    const r = await run(probes.insideAndRead);
    expect(r.code).toBe(0);
    expect(r.out).toContain("confined-ok");
    expect(r.out).toContain("READ_OK");
  });

  it("workspace-write: a write outside the workspace is denied by the kernel", async () => {
    mode = "workspace-write";
    const r = await run(probes.writeOutside);
    expect(existsSync(outsideProbe)).toBe(false);
    expect(r.out).toMatch(DENIED);
  });

  it("workspace-write: background children are confined with the wrapped shell", async () => {
    mode = "workspace-write";
    const r = await run(probes.backgroundOutside);
    expect(r.out).toContain("done");
    expect(existsSync(outsideProbe)).toBe(false);
  });

  it("read-only: even the workspace is not writable", async () => {
    mode = "read-only";
    const r = await run(probes.writeWorkspace);
    expect(existsSync(path.join(ws, "ro-probe.txt"))).toBe(false);
    expect(r.out).toMatch(DENIED);
  });

  it("the policy is read per spawn: dropping it lifts confinement on the next command", async () => {
    mode = null;
    const r = await run(probes.writeOutsideUnconfined);
    expect(r.code).toBe(0);
    expect(existsSync(outsideProbe)).toBe(true);
    rmSync(outsideProbe, { force: true });
  });
});
