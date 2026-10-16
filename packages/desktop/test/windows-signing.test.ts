/**
 * Build signatures and the EVSign hook, with native processes as the only fake.
 * - Given a trusted, timestamped signature, then certificate/CA rotation is accepted.
 * - Given bad/missing signature facts, a wrong path or native failure, then it fails closed.
 * - Given verifier execution, then paths stay data and signing keys/module paths are removed.
 * - Given all signing targets (including NSIS's temporary uninstaller), then signing is
 *   followed by independent verification; unrelated files and unsigned dry-runs do not sign.
 * - Given missing release credentials, CLI failure or bad post-sign output, then packaging
 *   stops without exposing keys or vendor output.
 */
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { certificate, signedReport } from "./helpers/windows-artifacts.js";

const require = createRequire(import.meta.url);
const { verifyWindowsSignature } = require("../build/verify-windows-signature.cjs");
const { createEvsignHook } = require("../build/evsign-hook.cjs");
const dirs: string[] = [];
const file = path.resolve("installer.exe");
const valid = signedReport(file);

function signature(report: unknown = valid) {
  vi.stubEnv("SystemRoot", process.env.SystemRoot || path.resolve("windows"));
  return vi.spyOn(childProcess, "execFileSync").mockReturnValue(JSON.stringify(report));
}
async function signer(name = "PenguinHarness.exe") {
  const root = await mkdtemp(path.join(os.tmpdir(), "penguin-evsign-hook-"));
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
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  return { target, client, verify, spawn, output };
}
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("common build Authenticode acceptance", () => {
  it.each([
    {
      subject: "CN=Keroro Software Ltd, O=Keroro Software Ltd",
      issuer: "GlobalSign",
      thumbprint: "new",
    },
    {
      subject: "CN=Future Publisher, O=Future Publisher",
      issuer: "Future CA",
      thumbprint: "rotated",
    },
  ])(
    "accepts trusted rotated certificate facts %j, including timestamped expired certificates",
    (facts) => {
      const report = { ...valid, signer: { ...certificate, ...facts } };
      signature(report);
      expect(verifyWindowsSignature(file)).toEqual(report);
    },
  );

  it.each([
    ["invalid signature", { ...valid, status: 1 }],
    ["unsigned", { ...valid, status: 2, signer: null, timestamp: null }],
    ["revoked", { ...valid, status: 4 }],
    ["string status", { ...valid, status: "0" }],
    ["missing signer", { ...valid, signer: null }],
    ["missing timestamp", { ...valid, timestamp: null }],
    ["empty timestamp", { ...valid, timestamp: {} }],
    ["empty signer", { ...valid, signer: {} }],
    ["missing issuer", { ...valid, signer: { ...certificate, issuer: "" } }],
    ["missing fingerprint", { ...valid, timestamp: { ...certificate, thumbprint: "" } }],
    ["missing validity", { ...valid, signer: { ...certificate, notAfter: "invalid" } }],
    ["inverted validity", { ...valid, signer: { ...certificate, notBefore: "2030-01-01" } }],
    ["wrong file", { ...valid, path: path.resolve("other.exe") }],
    ["missing path", { ...valid, path: undefined }],
    ["relative path", { ...valid, path: "installer.exe" }],
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

  it.each([0, 1, 3, 4])(
    "does not treat status %s without certificates as an unsigned dry-run",
    (status) => {
      signature({ status, path: file, signer: null, timestamp: null });
      expect(() => verifyWindowsSignature(file, { allowUnsigned: true })).toThrow();
    },
  );

  it("does not permit an invalid signed artifact as an unsigned dry-run", () => {
    signature({ ...valid, status: 2 });
    expect(() => verifyWindowsSignature(file, { allowUnsigned: true })).toThrow();
  });

  it("keeps the path literal, suppresses progress and removes inherited signing secrets/module paths", () => {
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
    expect(args.join(" ")).not.toContain(target);
    expect(args.join(" ")).toContain("$ProgressPreference = 'SilentlyContinue'");
    expect(options.env.PENGUIN_SIGNED_FILE).toBe(target);
    expect(options.env.PSModulePath).toBe("");
    expect(Object.keys(options.env).some((key) => key.toLowerCase() === "evsign_key")).toBe(false);
    expect(options.shell).toBe(false);
  });

  it.each(["", "not JSON"])(
    "rejects malformed native output %j without reflecting it",
    (output) => {
      signature().mockReturnValue(output);
      expect(() => verifyWindowsSignature(file)).toThrow("acceptance failed");
    },
  );

  it("sanitizes native errors", () => {
    signature().mockImplementation(() => {
      throw new Error("test-only-key vendor output");
    });
    expect(() => verifyWindowsSignature(file)).toThrow(
      /^Windows signature acceptance failed: installer.exe$/,
    );
  });

  it("fails when the PowerShell environment is unavailable", () => {
    const run = signature();
    vi.stubEnv("SystemRoot", "");
    expect(() => verifyWindowsSignature(file)).toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it.each(["relative.exe", "bad\0.exe"])(
    "refuses invalid input path %j before launching",
    (target) => {
      const run = signature();
      expect(() => verifyWindowsSignature(target)).toThrow();
      expect(run).not.toHaveBeenCalled();
    },
  );
});

describe("common EVSign hook", () => {
  it.each([
    "PenguinHarness.exe",
    "elevate.exe",
    "penguin-desktop-win32-x64.exe",
    "candidate.__uninstaller.exe",
  ])("signs and independently verifies %s using the default CLI arguments", async (name) => {
    const { target, client, spawn, verify, output } = await signer(name);
    await createEvsignHook()({ path: target, hash: "sha256" });
    expect(spawn).toHaveBeenCalledWith(client, [target, "-key", "test-only-key", "-sha256"], {
      stdio: "ignore",
      windowsHide: true,
    });
    expect(verify).toHaveBeenCalledOnce();
    expect(verify.mock.calls[0]?.[2]).toMatchObject({ env: { PENGUIN_SIGNED_FILE: target } });
    expect(output.mock.calls.flat().join(" ")).not.toContain("test-only-key");
  });

  it.each([
    ["git/PenguinHarness.exe", "sha256"],
    ["unrelated.exe", "sha256"],
    ["PenguinHarness.exe", "sha1"],
    ["PenguinHarness.exe", ""],
  ])("does not sign excluded target/hash %s %s", async (name, hash) => {
    const { target, spawn, verify } = await signer(name);
    await createEvsignHook()({ path: target, hash });
    expect(spawn).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it.each(["", "  "])("allows a missing key only for unsigned dry-runs: %j", async (key) => {
    const { target, spawn, verify } = await signer();
    vi.stubEnv("EVSIGN_KEY", key);
    vi.stubEnv("EVSIGN_REQUIRE", "false");
    await createEvsignHook()({ path: target, hash: "sha256" });
    vi.stubEnv("EVSIGN_REQUIRE", "true");
    await expect(createEvsignHook()({ path: target, hash: "sha256" })).rejects.toThrow("required");
    expect(spawn).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it("fails if the signing client is missing", async () => {
    const { target, client, spawn } = await signer();
    await rm(client);
    await expect(createEvsignHook()({ path: target, hash: "sha256" })).rejects.toThrow("not found");
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each(["sync throw", "error event", "nonzero exit", "signal exit"])(
    "sanitizes CLI %s and does not proceed to acceptance",
    async (mode) => {
      const { target, spawn, verify, output } = await signer();
      spawn.mockImplementation(() => {
        if (mode === "sync throw") throw new Error("test-only-key vendor output");
        const child = new EventEmitter();
        queueMicrotask(() =>
          mode === "error event"
            ? child.emit("error", new Error("test-only-key vendor output"))
            : child.emit("exit", mode === "signal exit" ? null : 1),
        );
        return child as childProcess.ChildProcess;
      });
      await expect(createEvsignHook()({ path: target, hash: "sha256" })).rejects.toThrow(
        mode === "error event" || mode === "sync throw"
          ? "Unable to start EVSign."
          : "EVSign did not complete successfully.",
      );
      expect(verify).not.toHaveBeenCalled();
      expect(output).not.toHaveBeenCalled();
    },
  );

  it("fails packaging when the temporary uninstaller has no timestamp after CLI success", async () => {
    const { target, verify, output } = await signer("candidate.__uninstaller.exe");
    verify.mockReturnValue(JSON.stringify({ ...signedReport(target), timestamp: null }));
    await expect(createEvsignHook()({ path: target, hash: "sha256" })).rejects.toThrow(
      "acceptance failed",
    );
    expect(output).not.toHaveBeenCalled();
  });
});
