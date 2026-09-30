/**
 * Shell↔server message-port relay (desktop mode only): client updates, the tray icon, and the
 * Workspace picker's macOS folder access.
 *
 * Under the desktop shell this server runs as an Electron utilityProcess, which injects
 * `process.parentPort` — an EventEmitter-ish port to the shell. The shell pushes its
 * updater snapshot and its tray state through it, and the routes forward the page's
 * check/download/install commands and its tray switch back. Folder access is the one
 * request that is answered: the shell reads the folder and replies under the request's id.
 * Under a plain `penguin server|web` run the port does not exist and this module wires
 * nothing; those routes then answer 503 `shell_unreachable`.
 *
 * Wire shapes live in api/types.ts (the updater, tray and folder-access messages) so the
 * shell imports the same contract.
 */
import { randomUUID } from "node:crypto";
import type {
  DesktopFolderAccessMessage,
  DesktopFolderAccessResult,
  DesktopFolderAccessResultMessage,
  DesktopOpenPrivacySettingsMessage,
  DesktopTrayCommandMessage,
  DesktopTrayStatus,
  DesktopTrayStatusMessage,
  DesktopUpdateStatus,
  DesktopUpdaterCommandMessage,
  DesktopUpdaterStatusMessage,
} from "../api/types.js";
import type { DesktopService } from "./desktop-service.js";

/**
 * How long the shell may take to answer a folder-access request. Generous: its read holds
 * until the user has answered the macOS prompt, and nothing hurries them.
 */
export const FOLDER_ACCESS_TIMEOUT_MS = 120_000;

/** The slice of Electron's ParentPort this relay uses (structural: the server must not depend on Electron types). */
export interface ShellPort {
  on(event: "message", listener: (e: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

const UPDATE_STATES: ReadonlySet<string> = new Set([
  "idle",
  "checking",
  "up-to-date",
  "available",
  "downloading",
  "downloaded",
  "error",
  "unsupported",
]);

/** Validates one shell push. Strict on the discriminators, tolerant of extra fields — the two sides ship together, but a malformed frame must not poison the stored snapshot. */
export function parseUpdaterStatusMessage(data: unknown): DesktopUpdateStatus | null {
  if (typeof data !== "object" || data === null) return null;
  const msg = data as Partial<DesktopUpdaterStatusMessage>;
  if (msg.type !== "desktop-updater-status") return null;
  const status = msg.status as Partial<DesktopUpdateStatus> | undefined;
  if (typeof status !== "object" || status === null) return null;
  if (typeof status.appVersion !== "string") return null;
  if (typeof status.state !== "string" || !UPDATE_STATES.has(status.state)) return null;
  if (status.seq !== undefined && typeof status.seq !== "number") return null;
  return status as DesktopUpdateStatus;
}

/** Reads Electron's injected port off `process`, absent under plain Node. */
export function shellPortOf(proc: NodeJS.Process): ShellPort | null {
  const port = (proc as NodeJS.Process & { parentPort?: ShellPort }).parentPort;
  return port && typeof port.on === "function" && typeof port.postMessage === "function"
    ? port
    : null;
}

/** Validates one shell tray push. Same rule as the updater's: strict on the discriminator, strict on every field it carries. */
export function parseTrayStatusMessage(data: unknown): DesktopTrayStatus | null {
  if (typeof data !== "object" || data === null) return null;
  const msg = data as Partial<DesktopTrayStatusMessage>;
  if (msg.type !== "desktop-tray-status") return null;
  const status = msg.status as Partial<DesktopTrayStatus> | undefined;
  if (typeof status !== "object" || status === null) return null;
  if (typeof status.showTrayIcon !== "boolean") return null;
  // An older shell against a newer server pushes no locale. Reading it as English rather
  // than rejecting the whole push keeps the icon switch working across that pairing.
  const locale = status.locale === "zh" || status.locale === "en" ? status.locale : "en";
  return { showTrayIcon: status.showTrayIcon, locale };
}

/** Validates one shell reply to a folder-access request; null when the frame is not one. */
export function parseFolderAccessResultMessage(
  data: unknown,
): DesktopFolderAccessResultMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const msg = data as Partial<DesktopFolderAccessResultMessage>;
  if (msg.type !== "desktop-folder-access-result" || typeof msg.id !== "string") return null;
  if (typeof msg.granted !== "boolean" || typeof msg.packaged !== "boolean") return null;
  return {
    type: "desktop-folder-access-result",
    id: msg.id,
    granted: msg.granted,
    ...(typeof msg.code === "string" ? { code: msg.code } : {}),
    packaged: msg.packaged,
  };
}

/**
 * Connects the port to the service: stores validated status pushes, registers the command
 * senders, and pairs each folder-access reply with the request it answers. A frame that fails
 * to apply is logged and dropped: an exception escaping a port listener is uncaught, and an
 * uncaught exception ends the server (index.ts).
 */
export function wireShellUpdatePort(desktop: DesktopService, port: ShellPort): void {
  /** Folder-access requests still waiting for the shell, by id. */
  const awaiting = new Map<string, (reply: DesktopFolderAccessResultMessage) => void>();
  port.on("message", (e) => {
    try {
      const status = parseUpdaterStatusMessage(e.data);
      if (status !== null) {
        desktop.setUpdateStatus(status);
        return;
      }
      const tray = parseTrayStatusMessage(e.data);
      if (tray !== null) {
        desktop.setTrayStatus(tray);
        return;
      }
      // A reply nobody waits for any more (its request timed out) is dropped.
      const access = parseFolderAccessResultMessage(e.data);
      if (access !== null) awaiting.get(access.id)?.(access);
    } catch (err) {
      console.error(`[server] dropped a frame from the desktop shell: ${String(err)}`);
    }
  });
  desktop.onUpdateCommand((action) => {
    port.postMessage({
      type: "desktop-updater-command",
      action,
    } satisfies DesktopUpdaterCommandMessage);
  });
  desktop.onTrayCommand((patch) => {
    port.postMessage({
      type: "desktop-tray-command",
      ...patch,
    } satisfies DesktopTrayCommandMessage);
  });
  desktop.onFolderAccessRequest(
    (path) =>
      new Promise<DesktopFolderAccessResult | null>((resolve) => {
        const id = randomUUID();
        // Posted before anything is registered: a port that refuses the frame rejects this
        // promise and leaves nothing waiting behind it.
        port.postMessage({
          type: "desktop-folder-access",
          id,
          path,
        } satisfies DesktopFolderAccessMessage);
        const timer = setTimeout(() => {
          awaiting.delete(id);
          resolve(null);
        }, FOLDER_ACCESS_TIMEOUT_MS);
        awaiting.set(id, ({ granted, code, packaged }) => {
          clearTimeout(timer);
          awaiting.delete(id);
          resolve({ granted, ...(code !== undefined ? { code } : {}), packaged });
        });
      }),
  );
  desktop.onPrivacySettingsCommand((pane) => {
    port.postMessage({
      type: "desktop-open-privacy-settings",
      pane,
    } satisfies DesktopOpenPrivacySettingsMessage);
  });
}
