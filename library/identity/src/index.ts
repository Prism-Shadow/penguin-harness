/**
 * The identity domain as a library package: the Users and AuthSessions mechanisms (the
 * storage contracts their repos implement), the Auth and Admin mechanisms (the service
 * contracts the server's auth stack implements), the SessionVia vocabulary and the
 * UserInfo view. One package, no server dependencies - packages/server imports these;
 * nothing here imports the server. The repos take the Db capability from
 * @prismshadow/penguin-library-db.
 *
 * Subpaths:
 * - `.` - the four mechanism contracts plus SessionVia and UserInfo.
 * - `./identity` - the contracts module on its own.
 * - `./repos` (and per-file) - the users and auth_sessions storing components.
 */
export { Users, AuthSessions, Auth, Admin } from "./identity.js";
export type { SessionVia, UserInfo } from "./identity.js";
export type { UserRow } from "./repos/users.js";
