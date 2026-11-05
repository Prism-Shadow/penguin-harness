/**
 * macOS folder access: the shell's half of the Workspace picker's "Allow access" (pure apart
 * from the injected deps, so it unit-tests without Electron).
 *
 * macOS privacy protection (TCC) asks the user about Desktop, Documents, Downloads and
 * removable or network volumes only on behalf of an app it holds responsible for the read, and
 * lists under Files and Folders only the apps it has asked about; any other read gets a silent
 * EPERM, with nothing for the user to allow. A read from the embedded server has been seen to
 * fail that way without a prompt, so the server relays the page's request here and the main
 * process reads the folder itself, once, in the app's own name. Once the app is allowed, its
 * children — the server and the agents' shells — read too. A development instance started from
 * a terminal is that terminal's responsibility instead, whatever the app declares, so the reply
 * says whether the app is packaged and the page words its advice accordingly.
 *
 * The second request opens the Privacy & Security pane the page names. Mechanism only (see
 * main.ts's header): what an outcome means for the user is the page's to say.
 *
 * The wire is the server's api contract, imported type-only.
 */
import path from "node:path";
import type {
  DesktopFolderAccessMessage,
  DesktopFolderAccessResultMessage,
  DesktopOpenPrivacySettingsMessage,
  DesktopPrivacyPane,
} from "@prismshadow/penguin-server/api";

export interface FolderAccessDeps {
  platform: NodeJS.Platform;
  /** Electron's `app.isPackaged`: false for a run from a source checkout. */
  isPackaged: boolean;
  /**
   * Reads a directory, asynchronously: on macOS the call holds until the user has answered the
   * privacy prompt, and the main process must not stop while it waits.
   */
  readdir(dir: string): Promise<unknown>;
  openExternal(url: string): Promise<void>;
}

/** One folder-access request off the port, validated; null when the frame is not one. */
export function parseFolderAccessRequest(
  data: unknown,
): Pick<DesktopFolderAccessMessage, "id" | "path"> | null {
  if (typeof data !== "object" || data === null) return null;
  const msg = data as Partial<DesktopFolderAccessMessage>;
  if (msg.type !== "desktop-folder-access" || typeof msg.id !== "string") return null;
  // A request with an id is always answered, so the server never waits out its timeout on a
  // malformed one: a path that is not a string reads as "", which is refused as not absolute.
  return { id: msg.id, path: typeof msg.path === "string" ? msg.path : "" };
}

/** One privacy-settings request off the port: the pane it names, or null when the frame is not one. */
export function parseOpenPrivacySettingsRequest(data: unknown): DesktopPrivacyPane | null {
  if (typeof data !== "object" || data === null) return null;
  const msg = data as Partial<DesktopOpenPrivacySettingsMessage>;
  if (msg.type !== "desktop-open-privacy-settings") return null;
  return msg.pane === "files" || msg.pane === "fullDisk" ? msg.pane : null;
}

/** System Settings › Privacy & Security, opened at the pane named. */
export function privacySettingsUrl(pane: DesktopPrivacyPane): string {
  const anchor = pane === "files" ? "Privacy_FilesAndFolders" : "Privacy_AllFiles";
  return `x-apple.systempreferences:com.apple.preference.security?${anchor}`;
}

/**
 * The reply to one folder-access request. Off macOS nothing is read: no other platform asks
 * the user for a folder, so there is nothing to grant. A failed read reports its errno code.
 */
export async function folderAccessReply(
  request: Pick<DesktopFolderAccessMessage, "id" | "path">,
  deps: FolderAccessDeps,
): Promise<DesktopFolderAccessResultMessage> {
  const answer = (granted: boolean, code?: string): DesktopFolderAccessResultMessage => ({
    type: "desktop-folder-access-result",
    id: request.id,
    granted,
    ...(code !== undefined ? { code } : {}),
    packaged: deps.isPackaged,
  });
  if (!path.isAbsolute(request.path)) return answer(false, "EINVAL");
  if (deps.platform !== "darwin") return answer(true);
  try {
    await deps.readdir(request.path);
    return answer(true);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    return answer(false, typeof code === "string" ? code : undefined);
  }
}

export interface FolderAccessFrameDeps extends FolderAccessDeps {
  /** Sends the reply to the embedded server; dropped while none is running. */
  post(reply: DesktopFolderAccessResultMessage): void;
  log(line: string): void;
}

/**
 * Runs one frame from the server if it is either request; false when it is neither. A
 * folder-access request is always answered; a privacy-settings request has no reply, and off
 * macOS it opens nothing. Each outcome leaves a line in the log: it is the one record of what
 * macOS answered.
 */
export function handleFolderAccessFrame(message: unknown, deps: FolderAccessFrameDeps): boolean {
  const request = parseFolderAccessRequest(message);
  if (request !== null) {
    void folderAccessReply(request, deps)
      .then((reply) => {
        const outcome = reply.granted ? "granted" : `refused (${reply.code ?? "no code"})`;
        deps.log(`folder access for ${request.path}: ${outcome}`);
        deps.post(reply);
      })
      .catch((err: unknown) => {
        deps.log(`folder access for ${request.path}: the reply was not sent: ${String(err)}`);
      });
    return true;
  }
  const pane = parseOpenPrivacySettingsRequest(message);
  if (pane === null) return false;
  if (deps.platform === "darwin") {
    deps.openExternal(privacySettingsUrl(pane)).catch((err: unknown) => {
      deps.log(`System Settings could not be opened at ${pane}: ${String(err)}`);
    });
  }
  return true;
}
