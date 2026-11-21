/**
 * The settings domain as a library package: the Settings and UiPrefsStore mechanisms
 * (the contracts a node requires), the attachment size arithmetic those settings govern,
 * and the repos that store them. One package, no server dependencies — packages/server
 * imports these; nothing here imports the server.
 *
 * The repos depend on the Db capability from @prismshadow/penguin-library-db: the
 * database, its schema and migrations live there, and every domain's repo takes the
 * handle as an injected capability.
 *
 * Subpaths:
 * - `.` — the two mechanism contracts (Settings, UiPrefsStore).
 * - `./attachment-limits` — the one place every attachment size number is defined.
 * - `./plugin-module-requests` — the PluginModuleRequests mechanism and its row (PRFC-0031).
 * - `./repos` (and per-file) — the storing components, wired by the server's platform.
 */
export { Settings, UiPrefsStore } from "./setting.js";
export { PluginModuleRequests } from "./plugin-module-requests.js";
export type { PluginModuleRequestRow, PluginModuleVia } from "./plugin-module-requests.js";
