/**
 * Shell↔server message-port relay for client updates (desktop mode only).
 *
 * Under the desktop shell this server runs as an Electron utilityProcess, which injects
 * `process.parentPort` — an EventEmitter-ish port to the shell. The shell pushes its
 * updater snapshot through it, and the update routes forward the page's
 * check/download/install commands back. Under a plain `penguin server|web` run the port does not exist and this
 * module wires nothing; the update routes then answer 503 `shell_unreachable`.
 *
 * The same port carries the host commands the page's command palette offers: one
 * `host-commands` push saying what this host can do, and `host-command` frames back.
 *
 * Wire shapes live in api/types.ts (DesktopUpdaterStatusMessage / DesktopUpdaterCommandMessage /
 * HostCommandsMessage / HostCommandMessage) so the shell imports the same contract.
 */
import type {
  DesktopUpdateStatus,
  DesktopUpdaterCommandMessage,
  DesktopUpdaterStatusMessage,
  HostCommandMessage,
  HostCommandOffer,
  HostCommandsMessage,
} from "../api/types.js";
import type { DesktopService } from "./desktop-service.js";
import type { ShellFrames } from "../hmr/capabilities.js";

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

/** What a host may announce at once, and how long an id and a label may be. Bounds, not policy: the frame comes from the process that spawned this one. */
const MAX_OFFERS = 32;
const MAX_ID = 64;
const MAX_LABEL = 120;

/**
 * Validates the shell's once-per-wiring push of what it offers.
 *
 * Nothing is checked against a list of known commands: the host decides what it can do, and
 * a server that dropped what it had not heard of would make a newer shell's commands
 * unreachable through an older server — which is the whole reason the words travel with the
 * command now. What is checked is the shape and some bounds.
 *
 * A bare string is accepted as an id with no words: that is what a shell older than
 * `HostCommandOffer` sends, and the page has its own words for everything such a shell can
 * offer.
 */
export function parseHostCommandsMessage(data: unknown): HostCommandOffer[] | null {
  if (typeof data !== "object" || data === null) return null;
  const msg = data as Partial<HostCommandsMessage>;
  if (msg.type !== "host-commands" || !Array.isArray(msg.commands)) return null;
  const offers: HostCommandOffer[] = [];
  for (const entry of (msg.commands as unknown[]).slice(0, MAX_OFFERS)) {
    if (typeof entry === "string") {
      if (entry !== "" && entry.length <= MAX_ID) {
        offers.push({ command: entry, label: "", labelZh: "" });
      }
      continue;
    }
    if (typeof entry !== "object" || entry === null) continue;
    const offer = entry as Partial<HostCommandOffer>;
    if (typeof offer.command !== "string" || offer.command === "") continue;
    if (offer.command.length > MAX_ID) continue;
    const label = typeof offer.label === "string" ? offer.label.slice(0, MAX_LABEL) : "";
    const labelZh = typeof offer.labelZh === "string" ? offer.labelZh.slice(0, MAX_LABEL) : "";
    offers.push({ command: offer.command, label, labelZh });
  }
  return offers;
}

/** Reads Electron's injected port off `process`, absent under plain Node. */
export function shellPortOf(proc: NodeJS.Process): ShellPort | null {
  const port = (proc as NodeJS.Process & { parentPort?: ShellPort }).parentPort;
  return port && typeof port.on === "function" && typeof port.postMessage === "function"
    ? port
    : null;
}

/**
 * Connects the port to the service: stores validated status pushes, registers the command
 * sender, and keeps the host's raw frames where the PLATFORM can read them.
 *
 * The frames holder is the whole point of the split. What a `host-commands` frame means is
 * policy — which commands exist, what they are called, who may run one — and policy ships by
 * push, so this function stores the frame unread and the platform interprets it (see
 * http/routes/command.ts). Parsing it here as well is a shim for platforms older than the
 * holder, which still ask the service for a parsed list; it goes when they do.
 */
export function wireShellUpdatePort(
  desktop: DesktopService,
  port: ShellPort,
  frames: ShellFrames | null = null,
): void {
  if (frames !== null) frames.post = (frame) => port.postMessage(frame);
  port.on("message", (e) => {
    const status = parseUpdaterStatusMessage(e.data);
    if (status !== null) desktop.setUpdateStatus(status);
    const offers = parseHostCommandsMessage(e.data);
    if (offers !== null) {
      if (frames !== null) frames.hostCommands = e.data;
      desktop.setCommands(offers);
    }
  });
  desktop.onUpdateCommand((action) => {
    port.postMessage({
      type: "desktop-updater-command",
      action,
    } satisfies DesktopUpdaterCommandMessage);
  });
  desktop.onCommand((command) => {
    port.postMessage({ type: "host-command", command } satisfies HostCommandMessage);
  });
}
