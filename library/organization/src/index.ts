/**
 * The organization domain as a library package: the OrgCache mechanism (the storage
 * contract the org cache repo implements) and the calendar/ticket outcome vocabulary its
 * rows carry. One package, no server dependencies - the repo takes the Db capability
 * from @prismshadow/penguin-library-db.
 *
 * Subpaths:
 * - `.` - the OrgCache contract and the outcome vocabulary.
 * - `./organization` - the contract module on its own.
 * - `./organizations` - the storing component (the repo, flat in this package).
 */
export { OrgCache } from "./organization.js";
export type { OrgCalendarOutcome, OrgTicketChange } from "./organization.js";
export { OrgCacheRepo } from "./organizations.js";
