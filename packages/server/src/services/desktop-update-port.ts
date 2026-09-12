/**
 * Shell↔server message-port relay (desktop mode only): client updates, and the tray icon.
 *
 * Under the desktop shell this server runs as an Electron utilityProcess, which injects
 * `process.parentPort` — an EventEmitter-ish port to the shell. The shell pushes its
 * updater snapshot and its tray state through it, and the routes forward the page's
 * check/download/install commands and its tray switch back. Under a plain
 * `penguin server|web` run the port does not exist and this module wires nothing; those
 * routes then answer 503 `shell_unreachable`.
 *
 * Wire shapes live in api/types.ts (the two updater messages and the two tray ones) so
 * the shell imports the same contract.
 */
import type {
  DesktopTrayCommandMessage,
  DesktopTrayStatus,
  DesktopTrayStatusMessage,
  DesktopUpdateStatus,
  DesktopUpdaterCommandMessage,
  DesktopUpdaterStatusMessage,
} from "../api/types.js";
import type { DesktopService } from "./desktop-service.js";

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

/** Validates one shell tray push. Same rule as the updater's: strict on the discriminator, strict on the one field it carries. */
export function parseTrayStatusMessage(data: unknown): DesktopTrayStatus | null {
  if (typeof data !== "object" || data === null) return null;
  const msg = data as Partial<DesktopTrayStatusMessage>;
  if (msg.type !== "desktop-tray-status") return null;
  const status = msg.status as Partial<DesktopTrayStatus> | undefined;
  if (typeof status !== "object" || status === null) return null;
  if (typeof status.showTrayIcon !== "boolean") return null;
  return { showTrayIcon: status.showTrayIcon };
}

/** Connects the port to the service: stores validated status pushes, registers the command senders. */
export function wireShellUpdatePort(desktop: DesktopService, port: ShellPort): void {
  port.on("message", (e) => {
    const status = parseUpdaterStatusMessage(e.data);
    if (status !== null) {
      desktop.setUpdateStatus(status);
      return;
    }
    const tray = parseTrayStatusMessage(e.data);
    if (tray !== null) desktop.setTrayStatus(tray);
  });
  desktop.onUpdateCommand((action) => {
    port.postMessage({
      type: "desktop-updater-command",
      action,
    } satisfies DesktopUpdaterCommandMessage);
  });
  desktop.onTrayCommand((showTrayIcon) => {
    port.postMessage({
      type: "desktop-tray-command",
      showTrayIcon,
    } satisfies DesktopTrayCommandMessage);
  });
}
