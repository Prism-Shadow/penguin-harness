/**
 * The auth domain as a library package: the Users and AuthSessions mechanisms (the
 * storage contracts their repos implement), the Auth and Admin mechanisms (the service
 * contracts the server's auth stack implements), the SessionVia vocabulary, the UserInfo
 * view, and what an account keeps beside its preferences - the UserDraftsStore and
 * BackgroundImageStore mechanisms. One package, no server dependencies - packages/server
 * imports these; nothing here imports the server. The repos take the Db capability from
 * @prismshadow/penguin-library-db.
 *
 * Subpaths:
 * - `.` - the mechanism contracts plus SessionVia and UserInfo.
 * - `./auth` - the identity contracts module on its own.
 * - `./account-data` - the drafts/background contracts module on its own.
 * - `./repos` (and per-file) - the storing components.
 */
export { Users, AuthSessions, Auth, Admin } from "./auth.js";
export type { SessionVia, UserInfo } from "./auth.js";
export { UserDraftsStore, BackgroundImageStore } from "./account-data.js";
export type { DraftWrite } from "./account-data.js";
export type { UserRow } from "./repos/users.js";
