/**
 * The messaging domain as a library package: the MessagingBindings and
 * MessagingConversations mechanisms and their repos. One package, no server
 * dependencies - the repos take the Db capability from
 * @prismshadow/penguin-library-db.
 *
 * Subpaths:
 * - `.` - the two mechanism contracts.
 * - `./messaging` - the contracts module on its own.
 * - `./repos` (and per-file) - the storing components.
 */
export { MessagingBindings, MessagingConversations } from "./messaging.js";
