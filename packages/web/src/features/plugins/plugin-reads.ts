/**
 * The plugin market's own server reads, kept for the page load (lib/read-store.ts), so a return
 * to the page starts from what it last showed and each answer is read again behind it:
 *
 * - `pluginLibrary`: this server's plugin library (`getPluginLibrary(null)`), under {@link LIBRARY_KEY}.
 * - `pluginIndex`: the registry, every module plugin the deployment could ask for, under
 *   {@link INDEX_KEY}.
 * - `pluginMarket`: the market's curation — the selected plugins and the art — under
 *   {@link MARKET_KEY}.
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
  PluginMarketResponse,
} from "@prismshadow/penguin-server/api";
import { useEffect } from "react";
import { getPluginIndex } from "../../api/endpoints";
import { createReadStore, readKey, useRead } from "../../lib/read-store";

export const pluginLibrary = createReadStore<PluginLibraryResponse>({
  what: "the plugin library could not be read",
});
export const LIBRARY_KEY = "library";

export const pluginIndex = createReadStore<PluginIndexResponse>();
export const INDEX_KEY = "index";

export const pluginMarket = createReadStore<PluginMarketResponse>();
export const MARKET_KEY = "market";

export const installedPlugins = createReadStore<InstalledPluginsResponse>();

/** The key of a server's module plugins for a Project: this server's (`machineId` null) or a machine's. */
export function installedPluginsKey(projectId: string, machineId: string | null): string {
  return readKey(projectId, machineId, "installed-plugins");
}

export const INDEX_RECHECK_MS = 3_000;

/** The index may initially answer from its embedded source while the published releases load. */
export function useLocalPluginIndex(enabled: boolean) {
  const registry = useRead(pluginIndex, enabled ? INDEX_KEY : null, () => getPluginIndex(), {
    minAgeMs: 0,
  });
  const pending = registry.error === null ? (registry.value?.pending?.length ?? 0) : 0;
  useEffect(() => {
    if (!enabled || registry.reading || pending === 0) return;
    const timer = setTimeout(() => pluginIndex.invalidate(INDEX_KEY), INDEX_RECHECK_MS);
    return () => clearTimeout(timer);
  }, [enabled, registry.reading, pending]);
  return registry;
}
