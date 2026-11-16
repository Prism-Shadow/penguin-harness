/**
 * The account-data domain as a library package: the UserDraftsStore and
 * BackgroundImageStore mechanisms and their repos - what an account keeps on the server
 * beside its preferences. One package, no server dependencies - the repos take the Db
 * capability from @prismshadow/penguin-library-db.
 *
 * Subpaths:
 * - `.` - the two mechanism contracts.
 * - `./account-data` - the contracts module on its own.
 * - `./repos` (and per-file) - the storing components.
 */
export { UserDraftsStore, BackgroundImageStore } from "./account-data.js";
export type { DraftWrite } from "./account-data.js";
