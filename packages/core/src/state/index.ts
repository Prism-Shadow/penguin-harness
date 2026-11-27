/**
 * Agent State and Project config storage.
 *
 * Directory layout, default config, Project config read/write, Agent State load/init.
 */
export * from "./paths.js";
export { installedWindowsDataLocation } from "./windows-data-location.js";
export * from "./windows-data-relocation.js";
export * from "./project-dirs.js";
export * from "./benchmark-dirs.js";
// The data root's one-time layout migration (PRFC-0034), until 1.0.
export * from "./layout-migration/index.js";
export * from "./reserved-names.js";
export * from "./default-config.js";
export * from "./kernel-history.js";
export * from "./kernel-update.js";
export * from "./builtin-agents.js";
export * from "./system-agent.js";
// A row's effective connection and credential: the Project config's rules, no catalog data.
export * from "./model-connection.js";
// Seeded command-policy rules + the single "absent = factory set" fallback (the server
// serves both; the matcher that reads them is core-internal).
export * from "./command-policy-defaults.js";
export * from "./project-config.js";
export * from "./agent-state.js";
export * from "./agent-vault.js";
export * from "./memory.js";
// A folder written into a directory of folders at once (staged, then renamed): the seeds a
// built-in plugin ships for a system app's data.
export { PLACE_STAGING_DIR, placeFolder } from "./place-folder.js";
export type { PlaceFolderOptions } from "./place-folder.js";

export * from "./plugin-workbenches.js";
