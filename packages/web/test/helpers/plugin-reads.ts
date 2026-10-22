/**
 * The plugin market's read stores between scenarios. They live as long as their modules — in a
 * suite, the whole file — so a scenario that is not about what an earlier visit left behind
 * starts from nothing known: every key of the named Projects forgotten, in memory and in
 * storage, and the library and the registry with them.
 */
import { agentInstalls } from "../../src/features/plugins/agent-installs";
import {
  INDEX_KEY,
  LIBRARY_KEY,
  installedPlugins,
  pluginIndex,
  pluginLibrary,
} from "../../src/features/plugins/plugin-reads";

export function forgetPluginReads(projectIds: readonly string[]): void {
  pluginLibrary.forget(LIBRARY_KEY);
  pluginIndex.forget(INDEX_KEY);
  for (const projectId of projectIds) {
    for (const key of agentInstalls.keys(projectId)) agentInstalls.forget(key);
    for (const key of installedPlugins.keys(projectId)) installedPlugins.forget(key);
  }
}
