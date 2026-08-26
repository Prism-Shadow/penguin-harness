/**
 * installOnRemote's orchestration, driven against stub `ssh`, `scp` and `tar` binaries on
 * PATH: which dialect it probes in, that the release installer runs pinned to the base, that
 * the hmr store streams over a pipe, the scratch directory being cleared even on failure,
 * and each outcome the page renders. Real processes are spawned — only the far side is fake —
 * so the argv this app hands to ssh is exercised rather than described.
 *
 * POSIX-only: the stubs are shell scripts. The Windows command forms are asserted as pure
 * strings in machines.test.ts.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installOnRemote } from "../src/machines/install-server.js";
import type { PushPlan } from "../src/machines/install-server.js";

const posixOnly = process.platform === "win32" ? describe.skip : describe;

posixOnly("installOnRemote", () => {
  let work: string;
  let stubBin: string;
  let logFile: string;
  let originalPath: string | undefined;

  const HARNESS = '{"platform":{"bundle":"store/platform/cafe0123456789ab.mjs"}}';

  /** A plan the way resolvePushPlan builds one, with a real hmr dir to stream. */
  const plan = (over: Partial<PushPlan> = {}): PushPlan => {
    const hmrDir = path.join(work, "hmr");
    fs.mkdirSync(path.join(hmrDir, "store"), { recursive: true });
    fs.writeFileSync(path.join(hmrDir, "harness.json"), HARNESS);
    fs.writeFileSync(path.join(hmrDir, "store", "x.mjs"), "//\n");
    return {
      baseVersion: "0.2.4",
      harness: HARNESS,
      hmrDir,
      version: "0.2.4+hmr.cafe01234567",
      ...over,
    };
  };

  /** Where the push finds install.sh / install.ps1 — the repo root, in a source checkout. */
  const assets = () => path.resolve(__dirname, "..", "..", "..");

  /** Stub ssh/scp that log every invocation and answer as the scenario dictates. */
  const writeStubs = (opts: { probe: string; posixUnknown?: boolean; installExit?: number }) => {
    fs.writeFileSync(
      path.join(stubBin, "ssh"),
      [
        "#!/bin/sh",
        `printf 'ssh %s\\n' "$*" >> ${JSON.stringify(logFile)}`,
        // NOT the `eval echo` idiom: some of these commands carry `&&`-joined mktemp/tar,
        // which eval would EXECUTE on the test machine instead of merely naming.
        'for a in "$@"; do last=$a; done',
        'case "$last" in',
        opts.posixUnknown
          ? `  *uname*) echo "'uname' is not recognized as an internal or external command" 1>&2; exit 1 ;;`
          : `  *uname*) printf '%b' ${JSON.stringify(opts.probe)} ;;`,
        `  *PROCESSOR_ARCHITECTURE*) printf '%b' ${JSON.stringify(opts.probe)} ;;`,
        "  *mktemp*) echo /tmp/remote-scratch ;;",
        // Single-quoted: sh's echo would otherwise eat the backslashes.
        "  *%TEMP%*) echo 'C:\\Temp\\penguin-scratch' ;;",
        `  *install.sh*|*install.ps1*) echo "PenguinHarness 0.2.4 installed"; exit ${opts.installExit ?? 0} ;;`,
        // The store stream: swallow stdin so the local tar does not die on a broken pipe.
        "  *'tar -xzf -'*) cat > /dev/null ;;",
        "  *) : ;;",
        "esac",
        "exit 0",
      ].join("\n"),
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(stubBin, "scp"),
      ["#!/bin/sh", `printf 'scp %s\\n' "$*" >> ${JSON.stringify(logFile)}`, "exit 0"].join("\n"),
      { mode: 0o755 },
    );
  };

  const calls = (): string[] =>
    fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n") : [];

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-push-test-"));
    stubBin = path.join(work, "bin");
    fs.mkdirSync(stubBin);
    logFile = path.join(work, "calls.log");
    originalPath = process.env.PATH;
    process.env.PATH = `${stubBin}:${process.env.PATH ?? ""}`;
  });
  afterEach(() => {
    process.env.PATH = originalPath;
    fs.rmSync(work, { recursive: true, force: true });
  });

  const target = { alias: "build-box", user: "deploy" };

  it("probes, installs the pinned release, streams the store, clears the scratch dir", async () => {
    writeStubs({ probe: "Linux x86_64\\n---penguin---\\n---penguin---\\n" });
    const progress: string[] = [];
    const outcome = await installOnRemote({
      target,
      plan: plan(),
      assets,
      onProgress: (line) => progress.push(line),
    });

    expect(outcome).toMatchObject({ kind: "installed" });
    const log = calls();
    expect(log[0]).toContain("uname -s -m"); // identity first
    expect(log[1]).toContain("mktemp -d");
    expect(log[2]).toMatch(/^scp .*install\.sh build-box:\/tmp\/remote-scratch$/);
    // The release is downloaded ON THE REMOTE, pinned to this server's own base.
    expect(log[3]).toContain("PENGUIN_VERSION='v0.2.4' sh '/tmp/remote-scratch/install.sh'");
    // The hmr state crosses as a stream into the default data root.
    expect(log[4]).toContain('tar -xzf - -C "$HOME/.penguin/data"');
    expect(log[5]).toContain("rm -rf '/tmp/remote-scratch'");
    expect(log.every((line) => line.includes("User=deploy"))).toBe(true);
    expect(log.every((line) => line.includes("BatchMode=yes"))).toBe(true);
    expect(progress).toContain("linux-x86_64.".replace("x86_64", "x64"));
  });

  it("falls back to the Windows probe when the POSIX one is not understood", async () => {
    writeStubs({
      probe: "Windows_NT AMD64\\n---penguin---\\n---penguin---\\n",
      posixUnknown: true,
    });
    const outcome = await installOnRemote({ target, plan: plan(), assets });

    expect(outcome).toMatchObject({ kind: "installed" });
    const log = calls();
    expect(log[0]).toContain("uname -s -m");
    expect(log[1]).toContain("%PROCESSOR_ARCHITECTURE%");
    // From here on everything speaks cmd.exe: double quotes, %TEMP%, rmdir.
    expect(log[2]).toContain('mkdir "%TEMP%\\penguin-');
    expect(
      log.some((line) =>
        line.includes('-File "C:\\Temp\\penguin-scratch\\install.ps1" -Version "v0.2.4"'),
      ),
    ).toBe(true);
    expect(log.at(-1)).toContain("rmdir /s /q");
  });

  it("a matching base skips the installer and only streams the store", async () => {
    writeStubs({
      probe: 'Linux x86_64\\n---penguin---\\n{"version":"0.2.4"}\\n---penguin---\\n',
    });
    const outcome = await installOnRemote({ target, plan: plan(), assets });
    expect(outcome).toMatchObject({ kind: "installed" });
    const log = calls();
    expect(log.some((line) => line.includes("install.sh"))).toBe(false);
    expect(log.some((line) => line.includes("tar -xzf -"))).toBe(true);
  });

  it("does nothing when the remote already matches base AND pushed state", async () => {
    writeStubs({
      probe: `Linux x86_64\\n---penguin---\\n{"version":"0.2.4"}\\n---penguin---\\n${HARNESS}\\n`,
    });
    const outcome = await installOnRemote({ target, plan: plan(), assets });
    expect(outcome).toMatchObject({ kind: "already-installed", version: "0.2.4+hmr.cafe01234567" });
    expect(calls()).toHaveLength(1); // the probe, and nothing else
  });

  it("a bare release plan streams nothing", async () => {
    writeStubs({ probe: "Linux x86_64\\n---penguin---\\n---penguin---\\n" });
    const outcome = await installOnRemote({
      target,
      plan: plan({ harness: null, hmrDir: null, version: "0.2.4" }),
      assets,
    });
    expect(outcome).toMatchObject({ kind: "installed" });
    expect(calls().some((line) => line.includes("tar -xzf -"))).toBe(false);
  });

  it("reports the installer's own output on failure and still clears the scratch dir", async () => {
    writeStubs({
      probe: 'Linux x86_64\\n---penguin---\\n{"version":"0.0.1"}\\n---penguin---\\n',
      installExit: 3,
    });
    const outcome = await installOnRemote({ target, plan: plan(), assets });
    expect(outcome).toMatchObject({ kind: "failed", step: "install" });
    expect((outcome as { detail: string }).detail).toContain("PenguinHarness 0.2.4 installed");
    expect(calls().at(-1)).toContain("rm -rf '/tmp/remote-scratch'");
  });

  it("refuses a base that cannot name a release", async () => {
    writeStubs({ probe: "Linux x86_64\\n---penguin---\\n---penguin---\\n" });
    const outcome = await installOnRemote({
      target,
      plan: plan({ baseVersion: "0.0.0-hmr.cafe", version: "0.0.0-hmr.cafe" }),
      assets,
    });
    expect(outcome).toMatchObject({ kind: "failed", step: "resolve the release" });
  });
});
