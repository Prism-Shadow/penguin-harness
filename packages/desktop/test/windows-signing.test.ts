/**
 * Build-time Authenticode acceptance and the EVSign hook, with native processes as the only fake.
 * - Given a valid, timestamped signature from any signer, acceptance passes.
 * - Given an invalid, unsigned or revoked signature, a missing signer or timestamp, a report for
 *   another file or output that is not a report, acceptance fails.
 * - Given an unsigned file, only an explicit dry-run accepts it; no other status does.
 * - Given a file name with shell syntax, it reaches PowerShell as data, with the signing key and
 *   inherited module paths removed from its environment.
 * - Given a native error or output that is not JSON, acceptance fails naming only the file.
 * - Given no SystemRoot or an unusable input path, acceptance fails before launching anything.
 * - Given a real signed and timestamped executable (Node's own, on Windows), the actual
 *   PowerShell script accepts it.
 * - Given each signing target (including NSIS's temporary uninstaller), the hook signs it with
 *   EVSign and then verifies it; other files and other hashes are left alone.
 * - Given no key, only a dry-run continues; given no client, a failed CLI or an untimestamped
 *   result, packaging stops.
 */
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signedReport } from "./helpers/windows-artifacts.js";

const require = createRequire(import.meta.url);
const { verifyWindowsSignature } = require("../build/verify-windows-signature.cjs");
const evsign = require("../build/evsign.cjs");
const dirs: string[] = [];
const file = path.resolve("installer.exe");
const valid = signedReport(file);

function signature(report: unknown = valid) {
  vi.stubEnv("SystemRoot", process.env.SystemRoot || path.resolve("windows"));
  return vi.spyOn(childProcess, "execFileSync").mockReturnValue(JSON.stringify(report));
}
async function signer(name = "PenguinHarness.exe") {
  const root = await mkdtemp(path.join(os.tmpdir(), "penguin-evsign-"));
  dirs.push(root);
  const target = path.join(root, name);
  const client = path.join(root, "evsign.exe");
  await writeFile(client, "test fixture, never executed");
  vi.stubEnv("EVSIGN_CLIENT", client);
  vi.stubEnv("EVSIGN_KEY", "test-only-key");
  vi.stubEnv("EVSIGN_REQUIRE", "true");
  const verify = signature(signedReport(target));
  const spawn = vi.spyOn(childProcess, "spawn").mockImplementation(() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", 0));
    return child as childProcess.ChildProcess;
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  return { target, client, verify, spawn };
}
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("build-time Authenticode acceptance", () => {
  it("accepts any valid, timestamped signer regardless of subject or issuer", () => {
    signature();
    expect(verifyWindowsSignature(file)).toEqual(valid);
  });

  it.each([
    ["invalid signature", { ...valid, status: 1 }],
    ["unsigned", { ...valid, status: 2, signer: null, timestamp: null }],
    ["revoked", { ...valid, status: 4 }],
    ["string status", { ...valid, status: "0" }],
    ["missing signer", { ...valid, signer: null }],
    ["missing timestamp", { ...valid, timestamp: null }],
    ["wrong file", { ...valid, path: path.resolve("other.exe") }],
    ["invalid JSON object", null],
  ])("fails closed for %s", (_name, report) => {
    signature(report);
    expect(() => verifyWindowsSignature(file)).toThrow("acceptance failed");
  });

  it("accepts unsigned status only when explicitly allowed", () => {
    const unsigned = { status: 2, path: file, signer: null, timestamp: null };
    signature(unsigned);
    expect(verifyWindowsSignature(file, { allowUnsigned: true })).toEqual(unsigned);
    expect(() => verifyWindowsSignature(file)).toThrow();
  });

  it.each([
    { status: 0 },
    { status: 1 },
    { status: 3 },
    { status: 4 },
    { status: 2, signer: {} },
    { status: 2, timestamp: {} },
  ])("does not treat %j as an unsigned dry-run", (facts) => {
    signature({ path: file, signer: null, timestamp: null, ...facts });
    expect(() => verifyWindowsSignature(file, { allowUnsigned: true })).toThrow();
  });

  it("keeps the path literal and removes inherited signing secrets and module paths", () => {
    const target = path.resolve("literal'$();[test].exe");
    vi.stubEnv("EVSIGN_KEY", "test-only-key");
    vi.stubEnv("PSModulePath", "untrusted-modules");
    const run = signature(signedReport(target));
    expect(verifyWindowsSignature(target)).toEqual(signedReport(target));
    const [exe, args, options] = run.mock.calls[0] as unknown as [
      string,
      string[],
      { env: Record<string, string>; shell: boolean },
    ];
    expect(exe).toBe(
      path.join(process.env.SystemRoot!, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    );
    expect(Buffer.from(args.at(-1)!, "base64").toString("utf16le")).not.toContain(target);
    expect(options.env.PENGUIN_SIGNED_FILE).toBe(target);
    expect(options.env.PSModulePath).toBe("");
    expect(Object.keys(options.env).some((key) => key.toLowerCase() === "evsign_key")).toBe(false);
    expect(options.shell).toBe(false);
  });

  it.each([
    ["output that is not JSON", () => "not JSON"],
    [
      "a native error",
      () => {
        throw new Error("test-only-key vendor output");
      },
    ],
  ])("reports %s by the file name only", (_name, native) => {
    signature().mockImplementation(native);
    expect(() => verifyWindowsSignature(file)).toThrow(
      /^Windows signature acceptance failed: installer.exe$/,
    );
  });

  it.each([
    ["a relative input path", "relative.exe", false],
    ["a NUL in the input path", path.resolve("bad\0.exe"), false],
    ["no SystemRoot", file, true],
  ])("refuses %s before launching anything", (_name, target, noSystemRoot) => {
    const run = signature();
    if (noSystemRoot) vi.stubEnv("SystemRoot", "");
    expect(() => verifyWindowsSignature(target)).toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform !== "win32")(
    "accepts a real signed and timestamped Windows executable",
    () => {
      expect(verifyWindowsSignature(process.execPath)).toMatchObject({ status: 0 });
    },
    30_000,
  );
});

describe("EVSign signing hook", () => {
  it.each([
    "PenguinHarness.exe",
    "elevate.exe",
    "penguin-desktop-win32-x64.exe",
    "candidate.__uninstaller.exe",
  ])("signs %s with the default CLI arguments, then verifies it", async (name) => {
    const { target, client, spawn, verify } = await signer(name);
    await evsign({ path: target, hash: "sha256" });
    expect(spawn).toHaveBeenCalledWith(client, [target, "-key", "test-only-key", "-sha256"], {
      stdio: ["ignore", "inherit", "inherit"],
      windowsHide: true,
    });
    expect(verify).toHaveBeenCalledOnce();
    expect(verify.mock.calls[0]?.[2]).toMatchObject({ env: { PENGUIN_SIGNED_FILE: target } });
  });

  it.each([
    ["git/PenguinHarness.exe", "sha256"],
    ["unrelated.exe", "sha256"],
    ["PenguinHarness.exe", "sha1"],
    ["PenguinHarness.exe", ""],
  ])("does not sign excluded target/hash %s %s", async (name, hash) => {
    const { target, spawn, verify } = await signer(name);
    await evsign({ path: target, hash });
    expect(spawn).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it("allows an empty or blank key only for unsigned dry-runs", async () => {
    const { target, spawn, verify } = await signer();
    for (const key of ["", "  "]) {
      vi.stubEnv("EVSIGN_KEY", key);
      vi.stubEnv("EVSIGN_REQUIRE", "false");
      await evsign({ path: target, hash: "sha256" });
      vi.stubEnv("EVSIGN_REQUIRE", "true");
      await expect(evsign({ path: target, hash: "sha256" })).rejects.toThrow("required");
    }
    expect(spawn).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it("fails if the signing client is missing", async () => {
    const { target, client, spawn } = await signer();
    await rm(client);
    await expect(evsign({ path: target, hash: "sha256" })).rejects.toThrow("not found");
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-zero exit", "exit code 1"],
    ["a launch error", "spawn failed"],
  ])("stops on %s without verifying", async (mode, message) => {
    const { target, spawn, verify } = await signer();
    spawn.mockImplementation(() => {
      const child = new EventEmitter();
      queueMicrotask(() =>
        mode === "a launch error"
          ? child.emit("error", new Error("spawn failed"))
          : child.emit("exit", 1),
      );
      return child as childProcess.ChildProcess;
    });
    await expect(evsign({ path: target, hash: "sha256" })).rejects.toThrow(message);
    expect(verify).not.toHaveBeenCalled();
  });

  it("fails packaging when the temporary uninstaller has no timestamp after CLI success", async () => {
    const { target, verify } = await signer("candidate.__uninstaller.exe");
    verify.mockReturnValue(JSON.stringify({ ...signedReport(target), timestamp: null }));
    await expect(evsign({ path: target, hash: "sha256" })).rejects.toThrow("acceptance failed");
  });
});
