/**
 * The transport directory's one door. Everything machines/ needs from the transport layer
 * — the connection handle, target resolution, and the result vocabulary — comes through
 * here; the modules behind it (exec.ts, ssh-session.ts, socks.ts, lane.ts, targets.ts) are
 * private, pinned by machines-transport-boundary.test.ts. See connection.ts for why.
 *
 * THE STRUCTURE. Per machine ONE connection: an `ssh -T -D` session whose stdin carries the
 * commands, the scripts and the tarballs, and whose SOCKS port carries every TCP connection
 * to the machine as a channel inside it. Not a budget: there is no count of open connections
 * and no number to tune, because there is nothing that could open a second one; a second ask
 * waits for the first. A trigger — a probe request, a boot sweep, an install — never brings a
 * connection of its own.
 */
export {
  MachineConnection,
  closeAllConnections,
  closeConnectionTo,
  connectionTo,
} from "./connection.js";
export type { MachineChannel } from "./connection.js";
export { sessionOf } from "./ssh-session.js";
export type { ShellSession } from "./ssh-session.js";
export { execFailureText, looksLikeAuthFailure, runBytes } from "./exec.js";
export type { ExecResult } from "./exec.js";
export { appendHostBlock, listHostAliases, readSshConfig, writeSshConfig } from "./targets.js";
