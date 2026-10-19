/**
 * Real electron-updater NSIS state, with HTTP, Authenticode and installer spawning
 * replaced at their external boundaries.
 * - Full and differential downloads require trust before readiness and success.
 * - Cached installers are checked again, including without publisher metadata.
 * - Refused trust on a cached installer clears install state.
 * - A delayed verifier holds both readiness and the download's return value.
 * - Installation rechecks trust; failure deletes the file and clears install state.
 * - Repeated install clicks share one pending check and never launch twice.
 */
import { createHash } from "node:crypto";
import childProcess from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ElectronHttpExecutor } from "electron-updater/out/electronHttpExecutor.js";
import type { AppAdapter } from "electron-updater/out/AppAdapter.js";
import type { InstallOptions } from "electron-updater/out/BaseUpdater.js";
import { WindowsUpdater, WindowsUpdateVerificationError } from "../src/windows-updater.js";

const bytes = Buffer.from("NSIS installer fixture");
const sha512 = createHash("sha512").update(bytes).digest("base64");
const latest = `version: 99.0.0\nfiles:\n  - url: installer.exe\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: installer.exe\nsha512: ${sha512}\n`;
const dirs: string[] = [];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class TestUpdater extends WindowsUpdater {
  installations: InstallOptions[] = [];
  onInstallation: (() => void) | null = null;
  protected override doInstall(options: InstallOptions): boolean {
    this.installations.push(options);
    this.onInstallation?.();
    return false;
  }
}

async function fixture(dir?: string, publisher = true) {
  const root = dir ?? (await mkdtemp(path.join(os.tmpdir(), "penguin-windows-update-")));
  if (!dir) dirs.push(root);
  const config = path.join(root, "app-update.yml");
  await writeFile(
    config,
    `provider: generic\nurl: https://updates.example/\nupdaterCacheDirName: cache\n${publisher ? "publisherName: Legacy Publisher\n" : ""}`,
  );
  const app: AppAdapter = {
    version: "0.2.16",
    name: "TestHarness",
    isPackaged: true,
    appUpdateConfigPath: config,
    userDataPath: root,
    baseCachePath: root,
    whenReady: async () => {},
    quit() {},
    relaunch() {},
    onQuit() {},
  };
  const updater = new TestUpdater(null, app);
  updater.autoDownload = false;
  updater.disableDifferentialDownload = true;
  updater.logger = null;
  const executor = new ElectronHttpExecutor();
  Object.assign(updater, { httpExecutor: executor });
  vi.spyOn(executor, "request").mockResolvedValue(latest);
  const download = vi
    .spyOn(executor, "download")
    .mockImplementation(async (_url, file, options) => {
      expect(options.sha512).toBe(sha512);
      await writeFile(file, bytes);
      return file;
    });
  const downloaded = vi.fn();
  updater.on("update-downloaded", downloaded);
  await updater.checkForUpdates();
  return { root, updater, download, downloaded };
}

function trust(valid: boolean) {
  vi.stubEnv("SystemRoot", String.raw`C:\Windows`);
  return vi.spyOn(childProcess, "execFile").mockImplementation((...args: unknown[]) => {
    const options = args[2] as { env: Record<string, string> };
    const callback = args[3] as (e: Error | null, out: string, err: string) => void;
    callback(
      null,
      JSON.stringify({
        Status: valid ? 0 : 2,
        Path: options.env.PENGUIN_UPDATE_VERIFY_PATH,
        HasSigner: valid,
      }),
      "",
    );
    return {} as childProcess.ChildProcess;
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe.skipIf(process.platform !== "win32")("Windows NSIS updater wiring", () => {
  it("validates the differential download through the real NSIS task", async () => {
    const verify = trust(true);
    const { updater, download, downloaded } = await fixture();
    updater.disableDifferentialDownload = false;
    // Replace the differential transfer only; the NSIS task and completion stay real.
    const transfer = vi
      .spyOn(
        updater as unknown as {
          differentialDownloadInstaller: (...args: unknown[]) => Promise<boolean>;
        },
        "differentialDownloadInstaller",
      )
      .mockImplementation(async (...args) => {
        await writeFile(args[2] as string, bytes);
        return false;
      });
    await updater.downloadUpdate();
    expect(transfer).toHaveBeenCalledOnce();
    expect(download).not.toHaveBeenCalled();
    expect(verify).toHaveBeenCalled();
    expect(downloaded).toHaveBeenCalledOnce();
  });

  it("refuses an unsigned download without exposing an installable update", async () => {
    trust(false);
    const { updater, downloaded } = await fixture();
    await expect(updater.downloadUpdate()).rejects.toThrow();
    expect(downloaded).not.toHaveBeenCalled();
    expect(updater.install()).toBe(false);
    expect(updater.installations).toHaveLength(0);
  });

  it.each([true, false])(
    "rechecks a prior launch's valid cache (publisher metadata: %s)",
    async (publisher) => {
      const verify = trust(true);
      const first = await fixture();
      await first.updater.downloadUpdate();
      const next = await fixture(first.root, publisher);
      verify.mockClear();
      await next.updater.downloadUpdate();
      expect(next.download).not.toHaveBeenCalled();
      expect(verify).toHaveBeenCalledOnce();
      expect(next.downloaded).toHaveBeenCalledOnce();
    },
  );

  it.each(["current process", "prior launch"])(
    "refuses a cached installer from the %s when its signature is no longer trusted",
    async (source) => {
      const verify = trust(true);
      const first = await fixture();
      await first.updater.downloadUpdate();
      const { updater, download, downloaded } =
        source === "current process" ? first : await fixture(first.root);
      download.mockClear();
      downloaded.mockClear();
      verify.mockRestore();
      trust(false);
      await expect(updater.downloadUpdate()).rejects.toThrow("signature");
      expect(download).not.toHaveBeenCalled();
      expect(downloaded).not.toHaveBeenCalled();
      expect(updater.install()).toBe(false);
      expect(updater.installations).toHaveLength(0);
    },
  );

  it("clears cached install state when a verifier throws", async () => {
    trust(true);
    const first = await fixture();
    await first.updater.downloadUpdate();
    const next = await fixture(first.root);
    next.updater.verifyUpdateCodeSignature = async () => {
      throw new Error("unavailable");
    };
    await expect(next.updater.downloadUpdate()).rejects.toThrow("signature");
    expect(next.downloaded).not.toHaveBeenCalled();
    expect(next.updater.install()).toBe(false);
  });

  it("holds cached readiness and download success until verification finishes", async () => {
    const verify = trust(true);
    const first = await fixture();
    await first.updater.downloadUpdate();
    const next = await fixture(first.root);
    const checking = deferred();
    const answer = deferred();
    const validProcess = verify.getMockImplementation()!;
    verify.mockImplementation((...args) => {
      void answer.promise.then(() => {
        validProcess(...args);
      });
      checking.resolve();
      return {} as childProcess.ChildProcess;
    });
    let finished = false;
    const download = next.updater.downloadUpdate().then((files) => {
      finished = true;
      return files;
    });
    await checking.promise;
    expect(next.downloaded).not.toHaveBeenCalled();
    expect(finished).toBe(false);
    answer.resolve();
    expect(await download).toHaveLength(1);
    expect(next.downloaded).toHaveBeenCalledOnce();
  });

  it("deletes an installer invalidated after readiness and clears install state", async () => {
    const verify = trust(true);
    const { updater } = await fixture();
    const [file] = await updater.downloadUpdate();
    verify.mockRestore();
    trust(false);
    const failed = new Promise<Error>((resolve) => updater.once("error", resolve));
    updater.quitAndInstall();
    expect(await failed).toBeInstanceOf(WindowsUpdateVerificationError);
    expect(updater.installations).toHaveLength(0);
    await expect(readFile(file!)).rejects.toMatchObject({ code: "ENOENT" });
    expect(updater.install()).toBe(false);
  });

  it("refuses installation when no file is held", async () => {
    trust(true);
    const { updater } = await fixture();
    const failed = new Promise<Error>((resolve) => updater.once("error", resolve));
    updater.quitAndInstall();
    expect(await failed).toBeInstanceOf(WindowsUpdateVerificationError);
    expect(updater.installations).toHaveLength(0);
  });

  it("refuses a final verifier exception without launching an installer", async () => {
    trust(true);
    const { updater } = await fixture();
    await updater.downloadUpdate();
    updater.verifyUpdateCodeSignature = async () => {
      throw new Error("process details");
    };
    const failed = new Promise<Error>((resolve) => updater.once("error", resolve));
    updater.quitAndInstall();
    const error = await failed;
    expect(error).toBeInstanceOf(WindowsUpdateVerificationError);
    expect(error.message).not.toContain("process details");
    expect(updater.installations).toHaveLength(0);
  });

  it("validates a full download and coalesces install clicks until the final check finishes", async () => {
    const verify = trust(true);
    const { updater, download, downloaded } = await fixture();
    await updater.downloadUpdate();
    expect(download).toHaveBeenCalledOnce();
    expect(downloaded).toHaveBeenCalledOnce();
    const checking = deferred();
    const answer = deferred();
    const validProcess = verify.getMockImplementation()!;
    verify.mockImplementation((...args) => {
      void answer.promise.then(() => {
        validProcess(...args);
      });
      checking.resolve();
      return {} as childProcess.ChildProcess;
    });
    const installed = deferred();
    updater.onInstallation = installed.resolve;
    updater.quitAndInstall();
    await checking.promise;
    updater.quitAndInstall();
    expect(updater.installations).toHaveLength(0);
    answer.resolve();
    await installed.promise;
    expect(updater.installations).toHaveLength(1);
  });
});
