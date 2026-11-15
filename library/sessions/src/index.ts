/**
 * The sessions domain as a library package: the SessionIndex, SessionDrivers,
 * SessionOrigins and Schedules mechanisms (the storage contracts the sessions and
 * schedules repos implement), the ApprovalMode vocabulary, and the runtime-facing
 * contracts (AgentState, Scheduling) the server's session runtime implements. One
 * package, no server dependencies. The repos take the Db capability from
 * @prismshadow/penguin-library-db.
 *
 * Subpaths:
 * - `.` - the mechanism contracts plus ApprovalMode.
 * - `./sessions` - the contracts module on its own.
 * - `./repos` (and per-file) - the storing components.
 */
export { SessionIndex, SessionDrivers, SessionOrigins, Schedules } from "./sessions.js";
export type { ApprovalMode } from "./sessions.js";
