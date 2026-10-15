import electronUpdater from "electron-updater";
import type { DownloadExecutorTask } from "electron-updater/out/AppUpdater.js";
import { verifyWindowsUpdateSignature } from "./windows-update-signature.js";
import type { SignatureExecFile } from "./windows-update-signature.js";

export class WindowsUpdateVerificationError extends Error {
  constructor() {
    super("Windows update verification failed. Check for updates and download it again.");
    this.name = "WindowsUpdateVerificationError";
  }
}

/** Windows NSIS updates, including installers recovered from the download cache. */
export class WindowsUpdater extends electronUpdater.NsisUpdater {
  private installationCheck: Promise<void> | null = null;

  constructor(
    options?: ConstructorParameters<typeof electronUpdater.NsisUpdater>[0],
    app?: ConstructorParameters<typeof electronUpdater.NsisUpdater>[1],
    run?: SignatureExecFile,
  ) {
    super(options, app);
    this.autoInstallOnAppQuit = false;
    this.verifyUpdateCodeSignature = (_publishers, file) => verifyWindowsUpdateSignature(file, run);
  }

  protected override executeDownload(task: DownloadExecutorTask): Promise<string[]> {
    // NSIS verifies new downloads, but AppUpdater skips that task for cached files.
    // Keep its SHA-512/cache pipeline and await trust before readiness or success.
    const pipeline = electronUpdater.AppUpdater.prototype as WindowsUpdater;
    return pipeline.executeDownload.call(this, {
      ...task,
      done: async (event) => {
        try {
          const failure = await this.verifyUpdateCodeSignature([], event.downloadedFile);
          if (failure !== null) throw new Error(failure);
        } catch {
          await this.downloadedUpdateHelper?.clear();
          throw new Error("Windows update signature could not be verified.");
        }
        this.dispatchUpdateDownloaded(event);
        this.addQuitHandler();
      },
    });
  }

  override quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    if (this.installationCheck !== null || this.quitAndInstallCalled) return;
    this.installationCheck = this.installVerified(isSilent, isForceRunAfter)
      .catch((error: Error) => this.dispatchError(error))
      .finally(() => {
        this.installationCheck = null;
      });
  }

  private async installVerified(isSilent?: boolean, isForceRunAfter?: boolean): Promise<void> {
    try {
      const file = this.installerPath;
      if (file === null || (await this.verifyUpdateCodeSignature([], file)) !== null) {
        throw new WindowsUpdateVerificationError();
      }
    } catch {
      // Clearing also drops in-memory install state, so a fresh download can recover.
      try {
        await this.downloadedUpdateHelper?.clear();
      } finally {
        this.dispatchError(new WindowsUpdateVerificationError());
      }
      return;
    }
    super.quitAndInstall(isSilent, isForceRunAfter);
  }
}
