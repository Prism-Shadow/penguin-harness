/**
 * The plugin market's own server reads, kept for the page load (lib/read-store.ts), so a return
 * to the page starts from what it last showed and each answer is read again behind it:
 *
 * - `pluginLibrary`: this server's plugin library (`getPluginLibrary(null)`), under {@link LIBRARY_KEY}.
 * - `pluginIndex`: the registry, every module plugin the deployment could ask for, under
 *   {@link INDEX_KEY}.
 * - `installedPlugins`: what a server runs of the module plugins and what the Project's tables
 *   list for it — this server's own (machine null) and a machine's when it is in view — under
 *   {@link installedPluginsKey}.
 *
 * None is remembered across a reload: this server answers them in one request each. The
 * per-Agent installs, which a reload would otherwise lose for every machine, are
 * agent-installs.ts.
 */
import type {
  InstalledPluginsResponse,
  PluginIndexResponse,
  PluginLibraryResponse,
} from "@prismshadow/penguin-server/api";
import { createReadStore, readKey } from "../../lib/read-store";

export const pluginLibrary = createReadStore<PluginLibraryResponse>();
export const LIBRARY_KEY = "library";

export const pluginIndex = createReadStore<PluginIndexResponse>();
export const INDEX_KEY = "index";

export const installedPlugins = createReadStore<InstalledPluginsResponse>();

/** The key of a server's module plugins for a Project: this server's (`machineId` null) or a machine's. */
export function installedPluginsKey(projectId: string, machineId: string | null): string {
  return readKey(projectId, machineId, "installed-plugins");
}
