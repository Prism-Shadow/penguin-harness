/**
 * Agent State and Project config storage.
 *
 * Directory layout, default config, Project config read/write, Agent State load/init.
 */
export * from "./paths.js";
export * from "./default-config.js";
export * from "./builtin-agents.js";
export * from "./model-catalog.js";
export * from "./project-config.js";
export * from "./agent-state.js";
export * from "./agent-vault.js";
export * from "./example-benchmark.js";

// Skill library types and frontmatter parser (from the skills package; server reuses the same implementation via core).
export { parseSkillFrontmatter, type SkillMetadata } from "@prismshadow/penguin-skills";
