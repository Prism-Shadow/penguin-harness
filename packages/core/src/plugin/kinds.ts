/**
 * What kind of plugin a package is, read from its table and never from its directories — the one
 * rule every surface decides it by: the library, the server's upload and install checks, the
 * installed-plugins view, the CLI.
 *
 * - A **library plugin** contributes at least one Skill, hook package, MCP server or Workbench
 *   app (./contributions.ts): something an install writes into an Agent. A card alone is display,
 *   not content.
 * - A **server module** resolves a code entry, and its table lists modules or stands in for some
 *   (`plugin.modules` / `plugin.replaces`): something a Project's plugin list boots.
 *
 * A package may be both. A package without a table (never built) is neither.
 */
import fs from "node:fs";
import { libraryContributions } from "./contributions.js";
import { packageEntry, readPluginTable } from "./table.js";
import type { PluginTable } from "./table.js";

/** What a package carries: what installs into an Agent (Skills, hooks, MCP servers, workbenches) and whether it ships server modules. */
export interface LibraryParts {
  skills: boolean;
  hooks: boolean;
  mcp: boolean;
  workbenches: boolean;
  modules: boolean;
}

const NONE: LibraryParts = {
  skills: false,
  hooks: false,
  mcp: false,
  workbenches: false,
  modules: false,
};

/** Whether a table contributes anything an install writes into an Agent. */
export function hasLibraryContributions(table: PluginTable | null): boolean {
  if (table === null) return false;
  const c = libraryContributions(table, []);
  return (
    c.skills.length > 0 ||
    c.hooks !== undefined ||
    c.mcpServers.length > 0 ||
    c.workbenches.length > 0
  );
}

/**
 * What the package at `dir` carries, by its table. A package without a table, or one whose table
 * will not read, carries nothing: the surface that refuses it says why (readPluginTable).
 */
export function libraryParts(dir: string): LibraryParts {
  let table: PluginTable | null;
  try {
    table = readPluginTable(dir);
  } catch {
    return NONE;
  }
  if (table === null) return NONE;
  const c = libraryContributions(table, []);
  const entry = packageEntry(dir);
  const listed = table.plugin.modules.length + table.plugin.replaces.length > 0;
  return {
    skills: c.skills.length > 0,
    hooks: c.hooks !== undefined,
    mcp: c.mcpServers.length > 0,
    workbenches: c.workbenches.length > 0,
    modules: listed && entry !== null && fs.existsSync(entry),
  };
}

/** Whether the package at `dir` is a library plugin (see the module header). */
export function isLibraryPackage(dir: string): boolean {
  const parts = libraryParts(dir);
  return parts.skills || parts.hooks || parts.mcp || parts.workbenches;
}
