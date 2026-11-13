/**
 * Windows update trust, with PowerShell faked at the process boundary:
 * - A valid signature is accepted; the verifier reads no publisher name to pin.
 * - Missing/invalid signatures, wrong paths, malformed output and process failures refuse.
 * - File names containing shell syntax remain data.
 * - A real Windows-signed executable verifies without module-loading progress on stderr.
 */
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyWindowsUpdateSignature } from "../src/windows-update-signature.js";
import type { SignatureExecFile } from "../src/windows-update-signature.js";

const FILE = "C:\\Downloads\\PenguinHarness.exe";

function signatureProcess(result: Record<string, unknown> = {}, stderr = ""): SignatureExecFile {
  return (_file, _args, options, callback) => {
    callback(
      null,
      JSON.stringify({
        Status: 0,
        HasSigner: true,
        Path: options.env.PENGUIN_UPDATE_VERIFY_PATH,
        ...result,
      }),
      stderr,
    );
  };
}

describe("Windows signature verification", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a valid signature for the requested file", async () => {
    expect(await verifyWindowsUpdateSignature(FILE, signatureProcess())).toBeNull();
  });

  it.each([
    { Status: 1 },
    { Status: 2 },
    { Status: 4 },
    { Status: 0, HasSigner: false },
    { Status: "0" },
    { Path: "C:\\Downloads\\another.exe" },
    { Path: null },
    { Path: "relative.exe" },
  ])("refuses an untrusted or mismatched verification result: %j", async (result) => {
    expect(await verifyWindowsUpdateSignature(FILE, signatureProcess(result))).not.toBeNull();
  });

  it.each(['{"Status":0}\nnoise', "null", "[]", "0"])(
    "refuses malformed or incomplete verifier output: %j",
    async (stdout) => {
      const run: SignatureExecFile = (_file, _args, _options, callback) =>
        callback(null, stdout, "");
      expect(await verifyWindowsUpdateSignature(FILE, run)).not.toBeNull();
    },
  );

  it("refuses stderr and process launch failures without exposing their output", async () => {
    expect(
      await verifyWindowsUpdateSignature(FILE, signatureProcess({}, "untrusted output")),
    ).not.toBeNull();
    const run: SignatureExecFile = (_file, _args, _options, callback) => {
      callback(new Error("untrusted process details"), "", "");
    };
    expect(await verifyWindowsUpdateSignature(FILE, run)).toBe(
      "Windows update signature could not be verified.",
    );
  });

  it("refuses synchronous process failures and invalid input paths", async () => {
    const run: SignatureExecFile = () => {
      throw new Error("process unavailable");
    };
    expect(await verifyWindowsUpdateSignature(FILE, run)).not.toBeNull();
    const unused = vi.fn<SignatureExecFile>();
    expect(await verifyWindowsUpdateSignature("relative.exe", unused)).not.toBeNull();
    expect(await verifyWindowsUpdateSignature("C:\\bad\0.exe", unused)).not.toBeNull();
    expect(unused).not.toHaveBeenCalled();
  });

  it("keeps shell syntax in file names out of the PowerShell command", async () => {
    vi.stubEnv("PSMODULEPATH", "unavailable PowerShell 7 modules");
    const file = "C:\\Downloads\\space ' & $env:TEMP ` name.exe";
    const run: SignatureExecFile = (executable, args, options, callback) => {
      expect(executable).toMatch(/System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/);
      expect(args.join(" ")).not.toContain(file);
      const command = Buffer.from(args.at(-1)!, "base64").toString("utf16le");
      expect(command).not.toContain(file);
      expect(options.env.PENGUIN_UPDATE_VERIFY_PATH).toBe(file);
      expect(options.env.PSModulePath).toBe("");
      expect(
        Object.keys(options.env).filter((key) => key.toLowerCase() === "psmodulepath"),
      ).toEqual(["PSModulePath"]);
      expect(options.windowsHide).toBe(true);
      signatureProcess()(executable, args, options, callback);
    };
    expect(await verifyWindowsUpdateSignature(file, run)).toBeNull();
  });

  it.each(["", "relative"])(
    "refuses unsafe system verifier location %j without searching PATH",
    async (root) => {
      vi.stubEnv("SystemRoot", root);
      const run = vi.fn<SignatureExecFile>();
      expect(await verifyWindowsUpdateSignature(FILE, run)).not.toBeNull();
      expect(run).not.toHaveBeenCalled();
    },
  );

  it("accepts the same Windows path with different casing", async () => {
    expect(
      await verifyWindowsUpdateSignature(FILE, signatureProcess({ Path: FILE.toLowerCase() })),
    ).toBeNull();
  });

  it.skipIf(process.platform !== "win32")(
    "accepts a real Windows-signed executable despite first-use module loading",
    async () => {
      const file = path.win32.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      );
      expect(await verifyWindowsUpdateSignature(file)).toBeNull();
    },
    30_000,
  );
});
