/**
 * The transport directory's one door. Everything machines/ needs from the transport layer
 * — the connection handle, target resolution, and the result vocabulary — comes through
 * here; the modules behind it (exec.ts, ssh-session.ts, forward.ts, targets.ts) are
 * private, pinned by machines-transport-boundary.test.ts. See connection.ts for why.
 */
export { MachineConnection, closeConnectionTo, connectionTo } from "./connection.js";
export { execFailureText, looksLikeAuthFailure } from "./exec.js";
export type { ExecResult } from "./exec.js";
export { listHostAliases, resolveTarget } from "./targets.js";
export type { ResolvedTarget } from "./targets.js";
