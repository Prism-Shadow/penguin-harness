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
 * - per-file engine subpaths (`./bridge`, `./connector`, per-channel files) - the chat-channel
 *   bridge, the connectors and the route factories (services+http+cli restack S8).
 * - `./ports` - the structural ports the server binds its mechanisms to.
 * - `./vocabulary` - the HTTP wire shapes (the API contract re-exports them).
 */
export { MessagingBindings, MessagingConversations } from "./messaging.js";
