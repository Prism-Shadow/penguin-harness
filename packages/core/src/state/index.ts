/**
 * Agent State and Project config storage.
 *
 * Directory layout, default config, Project config read/write, Agent State load/init.
 */
export * from "./paths.js";
export * from "./default-config.js";
export * from "./kernel-history.js";
export * from "./kernel-update.js";
export * from "./builtin-agents.js";
export * from "./model-catalog.js";
// Seeded command-policy rules + the single "absent = factory set" fallback (the server
// serves both; the matcher that reads them is core-internal).
export * from "./command-policy-defaults.js";
export * from "./project-config.js";
export * from "./agent-state.js";
export * from "./agent-vault.js";
export * from "./memory.js";
export * from "./example-benchmark.js";

// Plugin library types, the frontmatter parser and the version order (from the plugins package; the server reuses the same implementation via core).
export {
  compareVersions,
  parseSkillFrontmatter,
  PLUGIN_VERSION_PATTERN,
  type HookCommand,
  type HookManifest,
  type LibraryPlugin,
  type SkillMetadata,
} from "@prismshadow/penguin-plugins";
