/**
 * Transition-only EVSign entry point; common failures and targets live in windows-signing.
 * - A timestamped NaisNet signature passes with the 2021 certificate selector.
 * - A changed CN or organisation stops packaging even after CLI success.
 * - Native verification failure propagates without exposing its output.
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
const evsign = require("../build/evsign.cjs") as (config: {
  path: string;
  hash: string;
}) => Promise<void>;
const subject = 'CN="NaisNet Technology Co., Ltd.", O="NaisNet Technology Co., Ltd.", C=CN';
const dirs: string[] = [];

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "penguin-transition-signing-"));
  dirs.push(root);
  const target = path.join(root, "candidate.__uninstaller.exe");
  const client = path.join(root, "evsign.exe");
  await writeFile(client, "test fixture, never executed");
  vi.stubEnv("SystemRoot", process.env.SystemRoot || path.resolve("windows"));
  vi.stubEnv("EVSIGN_KEY", "test-only-key");
  vi.stubEnv("EVSIGN_CLIENT", client);
  vi.stubEnv("EVSIGN_REQUIRE", "true");
  const report = { ...signedReport(target), signer: { ...certificate, subject } };
  const verify = vi.spyOn(childProcess, "execFileSync").mockReturnValue(JSON.stringify(report));
  const spawn = vi.spyOn(childProcess, "spawn").mockImplementation(() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", 0));
    return child as childProcess.ChildProcess;
  });
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  return { target, client, report, verify, spawn, output };
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("transition build signing", () => {
  it("selects the 2021 certificate and independently accepts the NaisNet uninstaller", async () => {
    const { target, client, spawn, output } = await fixture();
    await evsign({ path: target, hash: "sha256" });
    expect(spawn).toHaveBeenCalledWith(
      client,
      [target, "-key", "test-only-key", "-sha256", "-cert", "2021"],
      { stdio: "ignore", windowsHide: true },
    );
    expect(output).toHaveBeenCalledOnce();
  });

  it.each([
    'CN="NaisNet Technology Co., Ltd.", O=Other',
    'CN=Other, O="NaisNet Technology Co., Ltd."',
  ])("refuses a changed transition signer: %s", async (changed) => {
    const { target, report, verify, output } = await fixture();
    verify.mockReturnValue(
      JSON.stringify({ ...report, signer: { ...certificate, subject: changed } }),
    );
    await expect(evsign({ path: target, hash: "sha256" })).rejects.toThrow("acceptance failed");
    expect(output).not.toHaveBeenCalled();
  });

  it("fails closed when native verification fails, without reflecting process output", async () => {
    const { target, verify, output } = await fixture();
    verify.mockImplementation(() => {
      throw new Error("test-only-key vendor output");
    });
    await expect(evsign({ path: target, hash: "sha256" })).rejects.toThrow(
      /^Transition signature acceptance failed: candidate\.__uninstaller\.exe$/,
    );
    expect(output).not.toHaveBeenCalled();
  });
});
