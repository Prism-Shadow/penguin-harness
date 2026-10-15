/**
 * Shared final artifact gate, with only native Authenticode execution faked.
 * - Given signed/timestamped final artifacts, then formal acceptance checks metadata too.
 * - Given unsigned artifacts, then only an explicit dry-run accepts them.
 * - Given any invalid artifact, missing output or stale metadata, then the gate fails.
 */
import childProcess from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error Build tooling is plain JavaScript, executed by Node 24.
import { verifyWindowsArtifacts } from "../scripts/verify-windows-artifacts.mjs";
import { artifactFixture, signedReport } from "./helpers/windows-artifacts.js";

const dirs: string[] = [];
async function fixture(unsigned = false) {
  const result = await artifactFixture();
  dirs.push(result.root);
  vi.stubEnv("SystemRoot", process.env.SystemRoot || path.resolve("windows"));
  vi.spyOn(childProcess, "execFileSync").mockImplementation((...args: unknown[]) => {
    const { env } = args[2] as { env: Record<string, string> };
    const file = env.PENGUIN_SIGNED_FILE!;
    return JSON.stringify(
      unsigned ? { status: 2, path: file, signer: null, timestamp: null } : signedReport(file),
    );
  });
  return result;
}
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("shared Windows final artifact gate", () => {
  it("accepts valid formal artifacts with metadata bound to the same final bytes", async () => {
    const { root, sha512 } = await fixture();
    const report = await verifyWindowsArtifacts(root, { requireSigning: true });
    expect(report).toMatchObject({ sha512, blockmap: "matched" });
    expect(report.reports).toHaveLength(3);
    expect(report.reports.every((value: { status: number }) => value.status === 0)).toBe(true);
  });

  it("permits unsigned artifacts only in a dry-run", async () => {
    const { root } = await fixture(true);
    vi.stubEnv("EVSIGN_REQUIRE", "false");
    expect(
      (await verifyWindowsArtifacts(root)).reports.every(
        (value: { status: number }) => value.status === 2,
      ),
    ).toBe(true);
    vi.stubEnv("EVSIGN_REQUIRE", "true");
    await expect(verifyWindowsArtifacts(root)).rejects.toThrow("acceptance failed");
  });

  it.each([
    "penguin-desktop-win32-x64.exe",
    "win-unpacked/PenguinHarness.exe",
    "win-unpacked/resources/elevate.exe",
  ])("refuses a bad signature on %s even in a dry-run", async (relative) => {
    const { root } = await fixture();
    vi.mocked(childProcess.execFileSync).mockImplementation((...args: unknown[]) => {
      const { env } = args[2] as { env: Record<string, string> };
      const report = signedReport(env.PENGUIN_SIGNED_FILE!);
      if (report.path === path.join(root, relative)) report.status = 4;
      return JSON.stringify(report);
    });
    await expect(verifyWindowsArtifacts(root, { requireSigning: false })).rejects.toThrow();
  });

  it.each(["win-unpacked/PenguinHarness.exe", "win-unpacked/resources/elevate.exe"])(
    "refuses missing signed output %s",
    async (relative) => {
      const { root } = await fixture();
      await rm(path.join(root, relative));
      await expect(verifyWindowsArtifacts(root)).rejects.toThrow();
    },
  );

  it("refuses stale metadata in a dry-run too", async () => {
    const { root, latest, save } = await fixture(true);
    latest.sha512 = "stale";
    await save();
    await expect(verifyWindowsArtifacts(root, { requireSigning: false })).rejects.toThrow(
      "SHA-512",
    );
  });

  it("refuses a directory in place of a signed executable", async () => {
    const { root } = await fixture();
    const target = path.join(root, "win-unpacked/PenguinHarness.exe");
    await rm(target);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(target);
    await expect(verifyWindowsArtifacts(root)).rejects.toThrow("Missing Windows artifact");
  });
});
