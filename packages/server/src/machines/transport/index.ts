/**
 * The transport directory's one door. Everything machines/ needs from the transport layer
 * — the connection handle, the address spelling, and the result vocabulary — comes through
 * here; the modules behind it (exec.ts, shell-session.ts, lane.ts) are private, pinned by
 * machines-transport-boundary.test.ts. See connection.ts for why.
 *
 * THE STRUCTURE. Per machine ONE connection: the shell its kind launches, whose stdin carries
 * the commands, the scripts and the tarballs, and over which every TCP connection to the
 * machine is dialled while it is up. Not a budget: there is no count of open connections and
 * no number to tune, because there is nothing that could open a second one; a second ask
 * waits for the first. A trigger — a probe request, a boot sweep, an install — never brings a
 * connection of its own.
 */
export {
  MachineConnection,
  addressOf,
  closeAllConnections,
  closeConnectionTo,
  connectionTo,
  kindOfAddress,
} from "./connection.js";
export type { MachineChannel, RemoteTarget } from "./connection.js";
export {
  MACHINE_SESSION_IFACE,
  SESSION_GROUP,
  SESSION_SHAPE_ID,
  attachSessionRegistry,
  sessionOf,
} from "./shell-session.js";
export type { HeldSession } from "./shell-session.js";
export { MachineSession } from "./shell-session.js";
export type { ShellResult, ShellRunOptions, ShellSession } from "./shell-session.js";
export { execFailureText, runBytes } from "./exec.js";
export type { ExecResult } from "./exec.js";

/** A stable key for a forward: what a wanted set and its facts are matched by. */
export function forwardKey(spec: {
  direction: string;
  localPort: number;
  remotePort: number;
}): string {
  return `${spec.direction}:${spec.localPort}:${spec.remotePort}`;
}
export type { ForwardFact } from "../../mechanisms/machines.js";
