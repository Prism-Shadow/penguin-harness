/**
 * The transport directory's one door: everything machines/ needs in order to reach another
 * machine comes through here, and the modules behind it (exec.ts, targets.ts) are private.
 *
 * The rule is about AUTHORITY, not about sockets. Opening ssh is how this server acts on a
 * machine at all — installing a program directory, reading what is there, later holding a
 * shell and a tunnel open — so it is worth one place that owns it rather than a spawn at
 * every call site. A caller that opens its own channel also judges the machine by that
 * channel, and "my ssh worked" is not the same fact as "that machine is healthy"; keeping
 * the door single is what lets those facts be told apart later.
 *
 * machines-transport-boundary.test.ts pins it by scanning the source, so the rule survives
 * a new call site added in a hurry.
 *
 * What sits behind the door is expected to change: the raw runners below are what the
 * install path needs today, and they narrow to a per-machine connection handle once one
 * exists. A caller importing only from here does not notice that.
 */
export { looksLikeAuthFailure, run, runPiped, runWithInput } from "./exec.js";
export type { ExecResult } from "./exec.js";
export { listHostAliases, resolveTarget } from "./targets.js";
