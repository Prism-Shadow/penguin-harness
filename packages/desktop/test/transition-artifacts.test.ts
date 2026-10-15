/**
 * Transition-only acceptance, with native Authenticode processes as the only fake.
 * - Given a final NaisNet candidate, then the common gate and actual legacy/new verifiers pass.
 * - Given another signer, legacy rejection/skip or new-verifier failure, then it fails closed.
 * - Given stale final metadata, then the transition cannot bypass the common gate.
 */
import childProcess from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error Build tooling is plain JavaScript, executed by Node 24.
import { verifyWindowsTransition } from "../scripts/verify-windows-transition.mjs";
import { artifactFixture, certificate } from "./helpers/windows-artifacts.js";

const dirs: string[] = [];
const subject = 'CN="NaisNet Technology Co., Ltd.", O="NaisNet Technology Co., Ltd.", C=CN';

async function fixture(mode = "valid") {
  const result = await artifactFixture();
  dirs.push(result.root);
  vi.stubEnv("SystemRoot", process.env.SystemRoot || String.raw`C:\Windows`);
  vi.spyOn(childProcess, "execFileSync").mockImplementation((...args: unknown[]) => {
    const options = args[2] as { env: Record<string, string> };
    return JSON.stringify({
      status: 0,
      path: options.env.PENGUIN_SIGNED_FILE,
      signer: { ...certificate, subject: mode === "other signer" ? "CN=Other, O=Other" : subject },
      timestamp: certificate,
    });
  });
  vi.spyOn(childProcess, "execFile").mockImplementation((...args: unknown[]) => {
    const options = args[2] as { env?: Record<string, string> };
    const callback = args[3] as (error: Error | null, stdout: string, stderr: string) => void;
    const isNew = !!options.env?.PENGUIN_UPDATE_VERIFY_PATH;
    if (!isNew && mode === "legacy skip") {
      callback(Object.assign(new Error("powershell unavailable"), { code: "ENOENT" }), "", "");
    } else {
      callback(
        null,
        JSON.stringify(
          isNew
            ? { Status: mode === "new rejection" ? 4 : 0, Path: result.installer, HasSigner: true }
            : {
                Status: mode === "legacy rejection" ? 4 : 0,
                Path: result.installer,
                SignerCertificate: { Subject: subject },
              },
        ),
        "",
      );
    }
    return {} as childProcess.ChildProcess;
  });
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  return { ...result, output };
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe.skipIf(process.platform !== "win32")("transition final artifact acceptance", () => {
  it("accepts final NaisNet bytes through the common gate and actual legacy/new verifiers", async () => {
    const { root, output } = await fixture();
    await verifyWindowsTransition(root);
    expect(output).toHaveBeenCalledOnce();
    expect(JSON.parse(output.mock.calls[0]![0])).toMatchObject({
      legacy: "accepted",
      transition: "accepted",
      blockmap: "matched",
    });
  });

  it.each(["other signer", "legacy rejection", "legacy skip", "new rejection"])(
    "refuses transition acceptance for %s",
    async (mode) => {
      const { root, output } = await fixture(mode);
      await expect(verifyWindowsTransition(root)).rejects.toThrow();
      expect(output).not.toHaveBeenCalled();
    },
  );

  it("cannot bypass the common final metadata gate", async () => {
    const { root, latest, save, output } = await fixture();
    latest.sha512 = "stale";
    await save();
    await expect(verifyWindowsTransition(root)).rejects.toThrow("SHA-512");
    expect(output).not.toHaveBeenCalled();
  });
});
