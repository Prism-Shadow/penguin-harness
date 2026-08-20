/**
 * installOnRemote's orchestration, driven against stub `ssh` and `scp` binaries on PATH: which
 * dialect it probes in, what it sends, the order it does things in, the scratch directory being
 * cleared even when the install fails, and each outcome the menu renders. Real processes are
 * spawned — only the far side is fake — so the argv this app would hand to ssh is exercised
 * rather than described.
 *
 * POSIX-only: the stubs are shell scripts. The Windows command forms they would carry are
 * asserted as pure strings in machines.test.ts.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installOnRemote } from "../src/machines/install-server.js";
import { packDirectory } from "../src/machines/pack.js";
import { runtimeArtifact, sha256Of } from "../src/machines/runtime.js";

const posixOnly = process.platform === "win32" ? describe.skip : describe;

posixOnly("installOnRemote", () => {
  let work: string;
  let stubBin: string;
  let logFile: string;
  let originalPath: string | undefined;

  /** An install image just real enough to pack (the installer now travels embedded). */
  const image = () => {
    const payloadRoot = path.join(work, "payload");
    fs.mkdirSync(path.join(payloadRoot, "penguin", "lib", "dist"), { recursive: true });
    fs.writeFileSync(path.join(payloadRoot, "penguin", "lib", "dist", "penguin.js"), "//\n");
    return { version: "9.9.9", pack: () => packDirectory(payloadRoot) };
  };

  /** A runtime archive already in the cache, so no test ever reaches the network. */
  const seedRuntimeCache = (): string => {
    const cacheDir = path.join(work, "runtime-cache");
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, runtimeArtifact("linux", "x64").fileName), "runtime");
    return cacheDir;
  };

  const noFetch = async (): Promise<Buffer> => {
    throw new Error("the test must not reach the network");
  };

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
        // The POSIX probe; a Windows host would not understand it.
        opts.posixUnknown
          ? `  *uname*) echo "'uname' is not recognized as an internal or external command" 1>&2; exit 1 ;;`
          : `  *uname*) printf '%b' ${JSON.stringify(opts.probe)} ;;`,
        `  *PROCESSOR_ARCHITECTURE*) printf '%b' ${JSON.stringify(opts.probe)} ;;`,
        "  *mktemp*) echo /tmp/remote-scratch ;;",
        // cmd.exe has no mktemp: the Windows form builds a path under %TEMP% instead.
        "  *%TEMP%*) echo C:\\Temp\\penguin-scratch ;;",
        "  *tar\\ -xf*) : ;;",
        `  *remote-installer.cjs*) echo "PenguinHarness 9.9.9 installed"; exit ${opts.installExit ?? 0} ;;`,
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

  it("detects, packs, copies image + runtime, unpacks it, installs, clears the scratch dir", async () => {
    writeStubs({ probe: "Linux x86_64\\n---penguin---\\n" });
    const progress: string[] = [];
    const outcome = await installOnRemote({
      target,
      image: image(),
      runtimeCacheDir: seedRuntimeCache(),
      fetchBuffer: noFetch,
      onProgress: (line) => progress.push(line),
    });

    expect(outcome).toMatchObject({ kind: "installed" });
    const log = calls();
    expect(log[0]).toContain("uname -s -m"); // identity first
    expect(log[1]).toContain("mktemp -d");
    // One transfer carrying the image, the job, the installer and the runtime.
    expect(log[2]).toMatch(
      /^scp .*penguin-image\.pack .*job\.json .*remote-installer\.cjs .*node-.*\.tar\.gz/,
    );
    expect(log[2]).toContain("build-box:/tmp/remote-scratch");
    expect(log[3]).toContain("tar -xf '/tmp/remote-scratch/node-");
    expect(log[4]).toContain("/bin/node' '/tmp/remote-scratch/remote-installer.cjs'");
    expect(log[5]).toContain("rm -rf '/tmp/remote-scratch'");
    // Every connection carries the account and the no-prompt guarantee.
    expect(log.every((line) => line.includes("User=deploy"))).toBe(true);
    expect(log.every((line) => line.includes("BatchMode=yes"))).toBe(true);
    expect(progress).toContain("linux-x64.");
  });

  it("falls back to the Windows probe when the POSIX one is not understood", async () => {
    writeStubs({ probe: "Windows_NT AMD64\\n---penguin---\\n", posixUnknown: true });
    const outcome = await installOnRemote({
      target,
      image: image(),
      runtimeCacheDir: (() => {
        const dir = path.join(work, "runtime-cache");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, runtimeArtifact("win32", "x64").fileName), "runtime");
        return dir;
      })(),
      fetchBuffer: noFetch,
    });

    expect(outcome).toMatchObject({ kind: "installed" });
    const log = calls();
    expect(log[0]).toContain("uname -s -m");
    expect(log[1]).toContain("%PROCESSOR_ARCHITECTURE%");
    // From here on everything speaks cmd.exe: double quotes, %TEMP%, rmdir.
    expect(log[2]).toContain('mkdir "%TEMP%\\penguin-');
    expect(log.at(-1)).toContain("rmdir /s /q");
    // …and the runtime that went over is the Windows one.
    expect(log.some((line) => line.includes("-win-x64.zip"))).toBe(true);
  });

  it("sends no runtime when the remote's own node is new enough", async () => {
    writeStubs({ probe: "Linux x86_64\\nv24.3.0\\n---penguin---\\n" });
    const progress: string[] = [];
    const outcome = await installOnRemote({
      target,
      image: image(),
      // Empty cache and a fetcher that would throw: proving the download never happens.
      runtimeCacheDir: path.join(work, "empty-cache"),
      fetchBuffer: noFetch,
      onProgress: (line) => progress.push(line),
    });

    expect(outcome).toMatchObject({ kind: "installed" });
    const log = calls();
    expect(log.some((line) => line.includes("node-v"))).toBe(false); // nothing runtime-shaped
    expect(log.some((line) => line.includes("tar -xf"))).toBe(false); // nothing to unpack
    expect(
      log.some((line) => line.includes("node '/tmp/remote-scratch/remote-installer.cjs'")),
    ).toBe(true);
    expect(progress).toContain("Using the Node v24.3.0 already on that machine.");
  });

  it("does nothing when the remote already runs this exact build", async () => {
    writeStubs({ probe: 'Linux x86_64\\n---penguin---\\n{"version":"9.9.9"}\\n' });
    const outcome = await installOnRemote({
      target,
      image: image(),
      runtimeCacheDir: seedRuntimeCache(),
      fetchBuffer: noFetch,
    });
    expect(outcome).toMatchObject({ kind: "already-installed", version: "9.9.9" });
    expect(calls()).toHaveLength(1); // the probe, and nothing else
  });

  it("reports the installer's own output on failure and still clears the scratch dir", async () => {
    writeStubs({ probe: 'Linux x86_64\\n---penguin---\\n{"version":"0.0.1"}\\n', installExit: 3 });
    const outcome = await installOnRemote({
      target,
      image: image(),
      runtimeCacheDir: seedRuntimeCache(),
      fetchBuffer: noFetch,
    });
    expect(outcome).toMatchObject({ kind: "failed", step: "install" });
    expect((outcome as { detail: string }).detail).toContain("PenguinHarness 9.9.9 installed");
    expect(calls().at(-1)).toContain("rm -rf '/tmp/remote-scratch'");
  });

  it("verifies a runtime it has to download, and never sends an unverified one", async () => {
    writeStubs({ probe: "Linux x86_64\\n---penguin---\\n" });
    const cacheDir = path.join(work, "empty-cache");
    const outcome = await installOnRemote({
      target,
      image: image(),
      runtimeCacheDir: cacheDir,
      // Serves a checksum file that does not match the "runtime" it then hands over.
      fetchBuffer: async (url) =>
        url.endsWith("SHASUMS256.txt")
          ? Buffer.from(
              `${sha256Of(Buffer.from("expected"))}  ${runtimeArtifact("linux", "x64").fileName}\n`,
            )
          : Buffer.from("tampered"),
    });
    expect(outcome).toMatchObject({ kind: "failed" });
    expect((outcome as { detail: string }).detail).toMatch(/checksum mismatch/);
    expect(calls().some((line) => line.startsWith("scp"))).toBe(false);
  });
});
