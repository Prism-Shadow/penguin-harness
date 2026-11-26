/**
 * Workbenches whose plugin was replaced by another, read as the replacement's.
 *
 * An install receipt (`.plugin.json`) names the plugin that wrote the workbench folder, and every
 * reader decides by that name: whether the library offers an update, whether an install may
 * overwrite the folder, which plugin a removal takes it with. When a workbench moves to another
 * plugin under the same id, a folder still carrying the old name would be nobody's — never offered
 * the update, refused by the install that brings it, left behind by the removal. Reading the old
 * name as the new one for that workbench id makes the folder the new plugin's, so its card offers
 * the update and the update overwrites it; the update then writes a receipt with the new name.
 *
 *   agent-evaluation / benchmark → rsi-workbench (the Self-Evolution Workbench left this
 *   repository for `@penguinharness/rsi-workbench`; the server's startup migration replaces the
 *   unmodified copies outright, so this is what an edited copy is read as)
 *
 * BACKWARD COMPATIBILITY. Kept until 1.0, when whoever prepares it removes this file and its use in
 * plugin-workbenches.ts; a copy not updated by then reads as a workbench of a plugin the library no
 * longer has (changelog/unreleased/2026-11-26-backward-compatibility.md).
 */

/** Old plugin name → workbench id → the plugin that owns that workbench now. */
const RENAMED: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map([
  ["agent-evaluation", new Map([["benchmark", "rsi-workbench"]])],
]);

/** The plugin that owns the workbench `workbenchId` a receipt says `plugin` installed. */
export function currentWorkbenchOwner(plugin: string, workbenchId: string): string {
  return RENAMED.get(plugin)?.get(workbenchId) ?? plugin;
}
