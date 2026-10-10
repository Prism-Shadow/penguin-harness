/**
 * The shell's half of the Workspace picker's macOS folder access: the two frames it reads off
 * the port, the read it makes in the app's own name and the reply that reports it, and the
 * System Settings panes it opens. Only macOS reads or opens anything; every other platform
 * answers without touching the disk.
 */
import { describe, expect, it, vi } from "vitest";
import type { DesktopFolderAccessResultMessage } from "@prismshadow/penguin-server/api";
import {
  folderAccessReply,
  handleFolderAccessFrame,
  parseFolderAccessRequest,
  parseOpenPrivacySettingsRequest,
  privacySettingsUrl,
} from "../src/folder-access.js";
import type { FolderAccessDeps } from "../src/folder-access.js";

const DOWNLOADS = "/Users/me/Downloads";

/** A read that macOS refuses the way it refuses an app it has not asked about. */
function refused(code: string | undefined): Error {
  const err = new Error("operation not permitted") as NodeJS.ErrnoException;
  if (code !== undefined) err.code = code;
  return err;
}

function deps(overrides: Partial<FolderAccessDeps> = {}): FolderAccessDeps {
  return {
    platform: "darwin",
    isPackaged: true,
    readdir: vi.fn(async () => []),
    openExternal: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("the frames", () => {
  it("reads a folder-access request, answering even one whose path is not a string", () => {
    expect(
      parseFolderAccessRequest({ type: "desktop-folder-access", id: "a", path: DOWNLOADS }),
    ).toEqual({ id: "a", path: DOWNLOADS });
    // An id is enough to be owed a reply: the empty path is then refused as not absolute.
    expect(parseFolderAccessRequest({ type: "desktop-folder-access", id: "b", path: 7 })).toEqual({
      id: "b",
      path: "",
    });
    for (const data of [
      null,
      "desktop-folder-access",
      {},
      { type: "desktop-folder-access", path: DOWNLOADS },
      { type: "desktop-folder-access", id: 1, path: DOWNLOADS },
      // The other frames on the same port are not requests for this module.
      { type: "desktop-updater-command", action: "check" },
      { type: "desktop-open-privacy-settings", pane: "files" },
    ]) {
      expect(parseFolderAccessRequest(data)).toBeNull();
    }
  });

  it("reads a privacy-settings request by its pane, and nothing else", () => {
    expect(
      parseOpenPrivacySettingsRequest({ type: "desktop-open-privacy-settings", pane: "files" }),
    ).toBe("files");
    expect(
      parseOpenPrivacySettingsRequest({ type: "desktop-open-privacy-settings", pane: "fullDisk" }),
    ).toBe("fullDisk");
    for (const data of [
      null,
      { type: "desktop-open-privacy-settings" },
      { type: "desktop-open-privacy-settings", pane: "camera" },
      { type: "desktop-folder-access", id: "a", path: DOWNLOADS },
    ]) {
      expect(parseOpenPrivacySettingsRequest(data)).toBeNull();
    }
  });

  it("opens Files and Folders, or Full Disk Access", () => {
    expect(privacySettingsUrl("files")).toBe(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders",
    );
    expect(privacySettingsUrl("fullDisk")).toBe(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
    );
  });
});

describe("the read", () => {
  it("reads the folder on macOS and reports it granted", async () => {
    const d = deps();
    expect(await folderAccessReply({ id: "a", path: DOWNLOADS }, d)).toEqual({
      type: "desktop-folder-access-result",
      id: "a",
      granted: true,
      packaged: true,
    });
    expect(d.readdir).toHaveBeenCalledWith(DOWNLOADS);
  });

  it("reports a refused read with its errno code", async () => {
    for (const code of ["EPERM", "EACCES", "ENOENT"]) {
      const d = deps({ readdir: vi.fn(async () => Promise.reject(refused(code))) });
      expect(await folderAccessReply({ id: "a", path: DOWNLOADS }, d)).toEqual({
        type: "desktop-folder-access-result",
        id: "a",
        granted: false,
        code,
        packaged: true,
      });
    }
    // A failure that carries no code is still a refusal.
    const d = deps({ readdir: vi.fn(async () => Promise.reject(refused(undefined))) });
    expect(await folderAccessReply({ id: "a", path: DOWNLOADS }, d)).toEqual({
      type: "desktop-folder-access-result",
      id: "a",
      granted: false,
      packaged: true,
    });
  });

  it("says whether the app is packaged, which decides whose permission it is", async () => {
    const granted = deps({ isPackaged: false });
    expect(await folderAccessReply({ id: "a", path: DOWNLOADS }, granted)).toMatchObject({
      granted: true,
      packaged: false,
    });
    const denied = deps({
      isPackaged: false,
      readdir: vi.fn(async () => Promise.reject(refused("EPERM"))),
    });
    expect(await folderAccessReply({ id: "a", path: DOWNLOADS }, denied)).toMatchObject({
      granted: false,
      code: "EPERM",
      packaged: false,
    });
  });

  it("reads nothing off macOS, where no folder is asked for", async () => {
    for (const platform of ["linux", "win32"] as const) {
      const d = deps({ platform });
      expect(await folderAccessReply({ id: "a", path: DOWNLOADS }, d)).toMatchObject({
        granted: true,
      });
      expect(d.readdir).not.toHaveBeenCalled();
    }
  });

  it("refuses a path that is not absolute without reading it, on every platform", async () => {
    for (const platform of ["darwin", "linux"] as const) {
      for (const path of ["Downloads", "", "./Downloads"]) {
        const d = deps({ platform });
        expect(await folderAccessReply({ id: "a", path }, d)).toEqual({
          type: "desktop-folder-access-result",
          id: "a",
          granted: false,
          code: "EINVAL",
          packaged: true,
        });
        expect(d.readdir).not.toHaveBeenCalled();
      }
    }
  });
});

describe("the frame handler", () => {
  function frameDeps(overrides: Partial<FolderAccessDeps> = {}) {
    const posted: DesktopFolderAccessResultMessage[] = [];
    const logged: string[] = [];
    return {
      posted,
      logged,
      deps: {
        ...deps(overrides),
        post: (reply: DesktopFolderAccessResultMessage) => posted.push(reply),
        log: (line: string) => logged.push(line),
      },
    };
  }

  it("answers a folder-access request on the port and logs what macOS said", async () => {
    const f = frameDeps({ readdir: vi.fn(async () => Promise.reject(refused("EPERM"))) });
    expect(
      handleFolderAccessFrame({ type: "desktop-folder-access", id: "a", path: DOWNLOADS }, f.deps),
    ).toBe(true);
    await vi.waitFor(() => expect(f.posted).toHaveLength(1));
    expect(f.posted[0]).toEqual({
      type: "desktop-folder-access-result",
      id: "a",
      granted: false,
      code: "EPERM",
      packaged: true,
    });
    expect(f.logged).toEqual([`folder access for ${DOWNLOADS}: refused (EPERM)`]);
  });

  it("opens the pane asked for on macOS, and nothing elsewhere", () => {
    const mac = frameDeps();
    expect(
      handleFolderAccessFrame(
        { type: "desktop-open-privacy-settings", pane: "fullDisk" },
        mac.deps,
      ),
    ).toBe(true);
    expect(mac.deps.openExternal).toHaveBeenCalledWith(privacySettingsUrl("fullDisk"));
    expect(mac.posted).toEqual([]);

    const linux = frameDeps({ platform: "linux" });
    expect(
      handleFolderAccessFrame({ type: "desktop-open-privacy-settings", pane: "files" }, linux.deps),
    ).toBe(true);
    expect(linux.deps.openExternal).not.toHaveBeenCalled();
  });

  it("logs a pane that would not open", async () => {
    const f = frameDeps({
      openExternal: vi.fn(async () => Promise.reject(new Error("no handler"))),
    });
    handleFolderAccessFrame({ type: "desktop-open-privacy-settings", pane: "files" }, f.deps);
    await vi.waitFor(() => expect(f.logged).toHaveLength(1));
    expect(f.logged[0]).toContain("System Settings could not be opened at files");
  });

  it("leaves every other frame to the rest of the relay", () => {
    const f = frameDeps();
    for (const data of [
      { type: "desktop-updater-command", action: "check" },
      { type: "desktop-tray-command", showTrayIcon: false },
      { type: "desktop-browser-command", id: "x", command: { op: "hello" } },
      { type: "desktop-open-privacy-settings", pane: "camera" },
      null,
    ]) {
      expect(handleFolderAccessFrame(data, f.deps)).toBe(false);
    }
    expect(f.deps.readdir).not.toHaveBeenCalled();
    expect(f.deps.openExternal).not.toHaveBeenCalled();
  });
});
