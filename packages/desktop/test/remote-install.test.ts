/**
 * installOnRemote's orchestration, driven against stub `ssh` and `scp` binaries on PATH: the
 * step order, what each step is actually asked to run, the scratch directory being cleaned up
 * even when the install fails, and each outcome the caller renders. Real processes are
 * spawned — only the far side is fake — so the argv this app would hand to ssh is exercised
 * rather than described.
 *
 * POSIX-only: the stubs are shell scripts. The pure command builders they exercise are
 * covered platform-independently in remote.test.ts.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installOnRemote, packPayload } from "../src/remote/install-server.js";

const posixOnly = process.platform === "win32" ? describe.skip : describe;

/** A payload tree just real enough for tar and the readiness check. */
function makePayloadTree(root: string): { payloadRoot: string; installerPath: string } {
  const payloadRoot = path.join(root, "payload");
  fs.mkdirSync(path.join(payloadRoot, "penguin", "bin"), { recursive: true });
  fs.writeFileSync(path.join(payloadRoot, "penguin", "bin", "penguin"), "#!/bin/sh\n");
  const installerPath = path.join(root, "install.sh");
  fs.writeFileSync(installerPath, "#!/bin/sh\n");
  return { payloadRoot, installerPath };
}

posixOnly("installOnRemote", () => {
  let work: string;
  let stubBin: string;
  let logFile: string;
  let originalPath: string | undefined;

  /** Writes stub ssh/scp that log every invocation and answer as the scenario dictates. */
  const writeStubs = (opts: { probe: string; installExit?: number; scpExit?: number }) => {
    fs.writeFileSync(
      path.join(stubBin, "ssh"),
      [
        "#!/bin/sh",
        `printf 'ssh %s\\n' "$*" >> ${JSON.stringify(logFile)}`,
        "last=$(eval echo \\$$#)",
        'case "$last" in',
        `  *penguin=*) printf '%b' ${JSON.stringify(opts.probe)} ;;`,
        '  "mktemp -d") echo /tmp/remote-scratch ;;',
        `  *install.sh*) echo "PenguinHarness 0.2.2 installed"; exit ${opts.installExit ?? 0} ;;`,
        "  *) : ;;",
        "esac",
        "exit 0",
      ].join("\n"),
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(stubBin, "scp"),
      [
        "#!/bin/sh",
        `printf 'scp %s\\n' "$*" >> ${JSON.stringify(logFile)}`,
        `exit ${opts.scpExit ?? 0}`,
      ].join("\n"),
      { mode: 0o755 },
    );
  };

  const calls = (): string[] =>
    fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n") : [];

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-remote-test-"));
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

  const sources = () => makePayloadTree(work);
  const target = { alias: "build-box", user: "deploy" };

  it("probes, packs, copies, installs, and clears the scratch directory", async () => {
    writeStubs({ probe: "penguin=\nuname=Linux x86_64\nnode=v24.3.0\nlock=\n" });
    const progress: string[] = [];
    const outcome = await installOnRemote({
      target,
      sources: sources(),
      localVersion: "0.2.2",
      onProgress: (line) => progress.push(line),
    });

    expect(outcome).toEqual({ kind: "installed", output: "PenguinHarness 0.2.2 installed" });
    const log = calls();
    // Order matters: probe -> scratch dir -> copy -> install -> cleanup.
    expect(log[0]).toContain("penguin=");
    expect(log[1]).toContain("mktemp -d");
    expect(log[2]).toMatch(/^scp .*payload\.tar\.gz .*payload\.tar\.gz\.sha256 .*install\.sh/);
    expect(log[2]).toContain("build-box:'/tmp/remote-scratch'/");
    expect(log[3]).toContain(
      "sh '/tmp/remote-scratch/install.sh' --universal --archive '/tmp/remote-scratch/payload.tar.gz'",
    );
    expect(log[4]).toContain("rm -rf '/tmp/remote-scratch'");
    // Every connection carries the account and the no-prompt guarantee.
    expect(log.every((line) => line.includes("User=deploy"))).toBe(true);
    expect(log.every((line) => line.includes("BatchMode=yes"))).toBe(true);
    expect(progress).toContain("No PenguinHarness there yet — installing.");
  });

  it("does nothing when the remote already runs this exact build", async () => {
    writeStubs({ probe: "penguin=0.2.2\nuname=Linux x86_64\nnode=v24.3.0\nlock=\n" });
    const outcome = await installOnRemote({ target, sources: sources(), localVersion: "0.2.2" });
    expect(outcome).toEqual({ kind: "already-installed", version: "0.2.2" });
    // One call, and nothing was copied anywhere.
    expect(calls()).toHaveLength(1);
  });

  it("refuses a remote whose Node is too old, before copying anything", async () => {
    writeStubs({ probe: "penguin=\nuname=Linux x86_64\nnode=v20.11.0\nlock=\n" });
    const outcome = await installOnRemote({ target, sources: sources(), localVersion: "0.2.2" });
    expect(outcome).toMatchObject({ kind: "blocked" });
    expect(calls().some((line) => line.startsWith("scp"))).toBe(false);
  });

  it("reports the installer's own output on failure and still clears the scratch directory", async () => {
    writeStubs({
      probe: "penguin=0.2.1\nuname=Linux x86_64\nnode=v24.3.0\nlock=\n",
      installExit: 3,
    });
    const outcome = await installOnRemote({ target, sources: sources(), localVersion: "0.2.2" });
    expect(outcome).toMatchObject({ kind: "failed", step: "install" });
    expect((outcome as { detail: string }).detail).toContain("PenguinHarness 0.2.2 installed");
    expect(calls().at(-1)).toContain("rm -rf '/tmp/remote-scratch'");
  });

  it("stops at a failed copy without running the installer", async () => {
    writeStubs({ probe: "penguin=\nuname=Linux x86_64\nnode=v24.3.0\nlock=\n", scpExit: 1 });
    const outcome = await installOnRemote({ target, sources: sources(), localVersion: "0.2.2" });
    expect(outcome).toMatchObject({ kind: "failed", step: "copy" });
    expect(calls().some((line) => line.includes("install.sh' --universal"))).toBe(false);
  });
});

posixOnly("packPayload", () => {
  it("produces a tarball whose top level is penguin/, plus the checksum install.sh verifies", async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-pack-test-"));
    try {
      const sources = makePayloadTree(work);
      const out = fs.mkdirSync(path.join(work, "out"), { recursive: true })!;
      const { archivePath, checksumPath } = await packPayload(sources, out);
      expect(fs.existsSync(archivePath)).toBe(true);
      // `<hash>  payload.tar.gz` — the shape sha256sum prints and install.sh reads.
      expect(fs.readFileSync(checksumPath, "utf8")).toMatch(/^[0-9a-f]{64} {2}payload\.tar\.gz\n$/);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });
});
