/**
 * The transport directory's one door. Everything machines/ needs from the transport layer
 * — the connection handle, target resolution, and the result vocabulary — comes through
 * here; the modules behind it (exec.ts, ssh-session.ts, socks.ts, lane.ts, targets.ts) are
 * private, pinned by machines-transport-boundary.test.ts. See connection.ts for why.
 *
 * How each ssh child signs in — keys, or a password this server stores — is login.ts's, and a
 * password refused once is not offered again until it is saved anew.
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
export {
  MACHINE_SESSION_IFACE,
  MachineSession,
  SESSION_GROUP,
  SESSION_SHAPE_ID,
  attachSessionRegistry,
  heldSessionOf,
  onSessionChange,
  sessionOf,
} from "./ssh-session.js";
export type { HeldSession, SessionListener, ShellSession } from "./ssh-session.js";
export { PASSWORD_ENV, forgetRefusal, passwordSignIn } from "./login.js";
export type { AskpassPlan } from "./login.js";
export { execFailureText } from "./exec.js";
export type { ExecResult } from "./exec.js";
export {
  appendHostBlock,
  listHostAliases,
  listHostEntries,
  readSshConfig,
  writeSshConfig,
} from "./targets.js";
