/**
 * Desktop update commands and status with the real Windows updater and cache.
 * Only Electron, HTTP, Authenticode and installer spawning are replaced.
 * - Web and native installation failures revoke readiness, report the failure and permit retry.
 * - A transient check error after download still preserves a valid ready update.
 */
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ElectronHttpExecutor } from "electron-updater/out/electronHttpExecutor.js";
import type { WindowsUpdater } from "../src/windows-updater.js";
import type { DesktopUpdateStatus } from "@prismshadow/penguin-server/api";

const boundary = vi.hoisted(() => ({
  root: "",
  valid: true,
  updater: null as WindowsUpdater | null,
  installations: 0,
  showMessageBox: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { isPackaged: true, getVersion: () => "0.2.16" },
  dialog: { showMessageBox: boundary.showMessageBox },
  net: { fetch: vi.fn() },
  shell: { openExternal: vi.fn() },
}));

vi.mock("electron-updater", async (importOriginal) => {
  const { default: real } = await importOriginal<{ default: typeof import("electron-updater") }>();
  class NativeBoundary extends real.NsisUpdater {
    constructor() {
      super(null, {
        version: "0.2.16",
        name: "TestHarness",
        isPackaged: true,
        appUpdateConfigPath: path.join(boundary.root, "app-update.yml"),
        userDataPath: boundary.root,
        baseCachePath: boundary.root,
        whenReady: async () => {},
        quit() {},
        relaunch() {},
        onQuit() {},
      });
      boundary.updater = this as unknown as WindowsUpdater;
    }
    protected override doInstall(): boolean {
      boundary.installations++;
      return false;
    }
  }
  return { default: { NsisUpdater: NativeBoundary, AppUpdater: real.AppUpdater } };
});

const bytes = Buffer.from("desktop command installer fixture");
const sha512 = createHash("sha512").update(bytes).digest("base64");
const latest = `version: 99.0.0\nfiles:\n  - url: installer.exe\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: installer.exe\nsha512: ${sha512}\n`;

async function fixture() {
  vi.resetModules();
  vi.useFakeTimers();
  boundary.root = await mkdtemp(path.join(os.tmpdir(), "penguin-install-recovery-"));
  boundary.valid = true;
  boundary.installations = 0;
  boundary.showMessageBox.mockReset().mockResolvedValue({ response: 1 });
  await writeFile(
    path.join(boundary.root, "app-update.yml"),
    "provider: generic\nurl: https://updates.example/\nupdaterCacheDirName: cache\npublisherName: Old Publisher\n",
  );
  vi.stubEnv("PENGUIN_UPDATE_FEED_URL", "https://updates.example/");
  vi.spyOn(childProcess, "execFile").mockImplementation((...args: unknown[]) => {
    const options = args[2] as { env: Record<string, string> };
    const callback = args[3] as (e: Error | null, out: string, err: string) => void;
    callback(
      null,
      JSON.stringify({
        Status: boundary.valid ? 0 : 2,
        HasSigner: boundary.valid,
        Path: options.env.PENGUIN_UPDATE_VERIFY_PATH,
      }),
      "",
    );
    return {} as childProcess.ChildProcess;
  });
  const api = await import("../src/updater.js");
  const updater = boundary.updater!;
  updater.disableDifferentialDownload = true;
  const executor = new ElectronHttpExecutor();
  Object.assign(updater, { httpExecutor: executor });
  const request = vi.spyOn(executor, "request").mockResolvedValue(latest);
  const download = vi.spyOn(executor, "download").mockImplementation(async (_url, file) => {
    await writeFile(file, bytes);
    return file;
  });
  api.initUpdater(() => null);
  function next(state: DesktopUpdateStatus["state"]) {
    return new Promise<DesktopUpdateStatus>((resolve) => {
      const off = api.onUpdaterStatus((status) => {
        if (status.state === state) {
          off();
          resolve(status);
        }
      });
    });
  }
  async function fetchUpdate() {
    const offered = next("available");
    api.handleUpdaterCommand("check");
    await offered;
    const ready = next("downloaded");
    api.handleUpdaterCommand("download");
    await ready;
  }
  return { api, updater, request, download, next, fetchUpdate };
}

afterEach(async () => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (boundary.root) await rm(boundary.root, { recursive: true, force: true });
});

describe.skipIf(process.platform !== "win32")("desktop install recovery", () => {
  it.each(["web", "native"] as const)(
    "%s installation failure clears readiness and allows redownload",
    async (origin) => {
      const { api, download, next, fetchUpdate } = await fixture();
      await fetchUpdate();
      boundary.valid = false;
      const invalidated = next("error");
      if (origin === "native") {
        boundary.showMessageBox.mockResolvedValueOnce({ response: 0 });
        await api.checkForUpdatesManually();
      } else {
        api.handleUpdaterCommand("install");
      }
      expect(await invalidated).toMatchObject({
        state: "error",
        message: expect.stringContaining("download"),
      });
      expect(boundary.installations).toBe(0);
      if (origin === "native") {
        expect(boundary.showMessageBox).toHaveBeenLastCalledWith(
          expect.objectContaining({ type: "error" }),
        );
      } else {
        expect(boundary.showMessageBox).not.toHaveBeenCalled();
      }
      boundary.valid = true;
      await fetchUpdate();
      expect(download).toHaveBeenCalledTimes(2);
      expect(api.getUpdaterStatus().state).toBe("downloaded");
    },
  );

  it("keeps a valid ready update through a transient check error", async () => {
    const { api, updater, request, fetchUpdate } = await fixture();
    await fetchUpdate();
    const checks = request.mock.calls.length;
    updater.emit("error", new Error("offline"));
    expect(api.getUpdaterStatus().state).toBe("downloaded");
    api.handleUpdaterCommand("check");
    expect(request).toHaveBeenCalledTimes(checks);
    expect(boundary.installations).toBe(0);
  });
});
