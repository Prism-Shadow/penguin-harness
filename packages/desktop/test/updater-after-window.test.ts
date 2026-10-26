/**
 * The automatic update schedule waits for the main window (src/updater.ts): choosing the feed
 * reaches the network (the OSS mirror, GitHub), and nothing of that may run while the app is
 * launching. Electron and electron-updater are the edge, replaced here.
 *
 * - Given an updater wired at launch, however long the window takes, the feed is not asked for
 *   and no check runs; once the window is shown, the feed is asked for.
 * - Given the window shown before the updater is wired, the schedule starts as it is wired.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const edge = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    fetch: fn(),
    updater: { on: fn(), setFeedURL: fn(), checkForUpdates: fn() },
  };
});

vi.mock("electron", () => ({
  app: { isPackaged: true, getVersion: () => "0.2.17" },
  dialog: { showMessageBox: vi.fn() },
  net: { fetch: edge.fetch },
  shell: { openExternal: vi.fn() },
}));

vi.mock("electron-updater", () => {
  // On Windows the module builds its own updater on NsisUpdater: it gets the same spies.
  class Updater {
    on = edge.updater.on;
    setFeedURL = edge.updater.setFeedURL;
    checkForUpdates = edge.updater.checkForUpdates;
  }
  return { default: { autoUpdater: edge.updater, NsisUpdater: Updater, AppUpdater: Updater } };
});

async function updater() {
  vi.resetModules();
  vi.useFakeTimers();
  // A packaged release on every platform: an AppImage on Linux, the OSS mirror as the source.
  vi.stubEnv("APPIMAGE", "/tmp/PenguinHarness.AppImage");
  vi.stubEnv("PENGUIN_UPDATE_SOURCE", "oss");
  vi.stubEnv("PENGUIN_UPDATE_FEED_URL", "");
  edge.fetch.mockReset().mockRejectedValue(new Error("offline"));
  edge.updater.checkForUpdates.mockReset().mockResolvedValue(null);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  return import("../src/updater.js");
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the automatic update schedule", () => {
  it("reaches nothing on the network until the main window is shown", async () => {
    const api = await updater();
    api.initUpdater(() => null);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(edge.fetch).not.toHaveBeenCalled();
    expect(edge.updater.checkForUpdates).not.toHaveBeenCalled();

    api.noteMainWindowShown();
    await vi.advanceTimersByTimeAsync(0);
    expect(edge.fetch).toHaveBeenCalled();
  });

  it("starts as it is wired when the window was already shown", async () => {
    const api = await updater();
    api.noteMainWindowShown();
    api.initUpdater(() => null);
    await vi.advanceTimersByTimeAsync(0);
    expect(edge.fetch).toHaveBeenCalled();
  });
});
