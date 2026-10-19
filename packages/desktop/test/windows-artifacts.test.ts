/**
 * The Windows release gate the desktop build workflow runs on its final output, with only
 * PowerShell's Authenticode answer faked.
 * - Given signed artifacts and a latest.yml bound to the final installer bytes, the gate passes
 *   and changes neither the installer nor its blockmap.
 * - Given a stale top-level sha512, path or version in latest.yml, the gate fails.
 * - Given a stale file-entry sha512, size or url, the gate fails.
 * - Given a files list that is not exactly the installer, the gate fails.
 * - Given a duplicate key or malformed YAML in latest.yml, the gate fails.
 * - Given any required output missing, the gate fails naming it.
 * - Given a stale or corrupt blockmap, the gate fails even though the hashes match.
 * - Given unsigned artifacts, only a dry-run passes.
 * - Given a bad signature on a signed file, the gate fails even in a dry-run.
 * - Given stale metadata, the gate fails in a dry-run too.
 */
import childProcess from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyWindowsArtifacts } from "../scripts/verify-windows-artifacts.mjs";
import { artifactFixture, buildBlockMap, signedReport } from "./helpers/windows-artifacts.js";

let answer: (file: string) => unknown;
const unsigned = (file: string) => ({ status: 2, path: file, signer: null, timestamp: null });
const dirs: string[] = [];

async function fixture() {
  const result = await artifactFixture();
  dirs.push(result.root);
  return result;
}

beforeEach(() => {
  answer = signedReport;
  vi.stubEnv("SystemRoot", process.env.SystemRoot || path.resolve("windows"));
  vi.spyOn(childProcess, "execFileSync").mockImplementation((...args: unknown[]) => {
    const { env } = args[2] as { env: Record<string, string> };
    return JSON.stringify(answer(env.PENGUIN_SIGNED_FILE!));
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Windows release artifact gate", () => {
  it("passes signed artifacts whose metadata describes the final bytes, changing no bytes", async () => {
    const { root, installer, bytes, sha512 } = await fixture();
    const blockmap = await readFile(`${installer}.blockmap`);
    const result = await verifyWindowsArtifacts(root, { requireSigning: true });
    expect(result).toMatchObject({ sha512, size: bytes.length });
    expect(result.reports.map((report) => report.status)).toEqual([0, 0, 0]);
    expect(await readFile(installer)).toEqual(bytes);
    expect(await readFile(`${installer}.blockmap`)).toEqual(blockmap);
  });

  it.each(["sha512", "path", "version"])("refuses a stale top-level %s", async (key) => {
    const { root, latest, save } = await fixture();
    (latest as Record<string, unknown>)[key] = "stale";
    await save();
    await expect(verifyWindowsArtifacts(root)).rejects.toThrow("latest.yml");
  });

  it.each(["sha512", "size", "url"])("refuses a stale file-entry %s", async (key) => {
    const { root, latest, save } = await fixture();
    (latest.files[0] as Record<string, unknown>)[key] = "stale";
    await save();
    await expect(verifyWindowsArtifacts(root)).rejects.toThrow("latest.yml");
  });

  it.each([
    ["no entry", []],
    ["another file", [{ url: "other.exe" }]],
    ["a duplicate entry", "duplicate"],
  ])("refuses a files list with %s", async (_name, files) => {
    const { root, latest, save } = await fixture();
    latest.files = files === "duplicate" ? [latest.files[0]!, latest.files[0]!] : (files as never);
    await save();
    await expect(verifyWindowsArtifacts(root)).rejects.toThrow("latest.yml");
  });

  it.each([
    // The repeated key carries the right value: only the duplicate itself can fail it.
    ["a duplicate key", (text: string) => `${text}path: penguin-desktop-win32-x64.exe\n`],
    ["malformed YAML", () => "broken: ["],
  ])("refuses latest.yml with %s", async (_name, edit) => {
    const { root } = await fixture();
    const file = path.join(root, "latest.yml");
    await writeFile(file, edit(await readFile(file, "utf8")));
    await expect(verifyWindowsArtifacts(root)).rejects.toThrow();
  });

  it.each([
    "penguin-desktop-win32-x64.exe",
    "penguin-desktop-win32-x64.exe.blockmap",
    "latest.yml",
    "win-unpacked/PenguinHarness.exe",
    "win-unpacked/resources/elevate.exe",
    "win-unpacked/resources/app-update.yml",
  ])("refuses a build without %s", async (relative) => {
    const { root } = await fixture();
    await rm(path.join(root, relative));
    await expect(verifyWindowsArtifacts(root)).rejects.toThrow(
      `Missing Windows artifact: ${relative}`,
    );
  });

  it.each(["stale", "corrupt"])(
    "refuses a %s blockmap even when the installer hashes and size match",
    async (mode) => {
      const { root, installer } = await fixture();
      if (mode === "stale") {
        const other = path.join(root, "other.exe");
        await writeFile(other, "bytes from before signing");
        await buildBlockMap(other, "gzip", `${installer}.blockmap`);
      } else {
        await writeFile(`${installer}.blockmap`, "broken");
      }
      await expect(verifyWindowsArtifacts(root)).rejects.toThrow();
    },
  );

  it("passes unsigned artifacts only in a dry-run", async () => {
    const { root } = await fixture();
    answer = unsigned;
    vi.stubEnv("EVSIGN_REQUIRE", "false");
    const result = await verifyWindowsArtifacts(root);
    expect(result.reports.map((report) => report.status)).toEqual([2, 2, 2]);
    vi.stubEnv("EVSIGN_REQUIRE", "true");
    await expect(verifyWindowsArtifacts(root)).rejects.toThrow("acceptance failed");
  });

  it("refuses a bad signature even in a dry-run", async () => {
    const { root } = await fixture();
    const helper = path.join(root, "win-unpacked/resources/elevate.exe");
    answer = (file) => ({ ...signedReport(file), status: file === helper ? 4 : 0 });
    await expect(verifyWindowsArtifacts(root, { requireSigning: false })).rejects.toThrow(
      "acceptance failed: elevate.exe",
    );
  });

  it("refuses stale metadata in a dry-run too", async () => {
    const { root, latest, save } = await fixture();
    answer = unsigned;
    latest.sha512 = "stale";
    await save();
    await expect(verifyWindowsArtifacts(root, { requireSigning: false })).rejects.toThrow(
      "SHA-512",
    );
  });
});
