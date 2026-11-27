/**
 * What each of the Project's machines offers the plugin market, read on that machine: its
 * library, its registry index and the server modules it runs. The answers are kept for the tab
 * (lib/catalog-storage.ts) as display data only — no file locations, no MCP setup or targets — so
 * a machine out of reach keeps its cards. Which rows they make, and where each row's actions go,
 * is market-rows.ts.
 */
import type {
  InstalledPluginsResponse,
  PluginGroupItem,
  PluginIndexEntry,
} from "@prismshadow/penguin-server/api";
import * as api from "@prismshadow/penguin-web/internal";
import { createCatalogStore } from "@prismshadow/penguin-web/internal";
import { useMachineCatalogs } from "@prismshadow/penguin-web/internal";
import type { MachineMarketData } from "./market-rows";

const libraries = createCatalogStore<PluginGroupItem[]>(
  "plugin-libraries.v1",
  (groups) =>
    groups.map((group) => ({
      ...group,
      plugins: group.plugins.map((plugin) => {
        const {
          name,
          title,
          titleZh,
          description,
          descriptionZh,
          shortDescription,
          shortDescriptionZh,
          version,
          package: pkg,
          source,
          skills,
          workbenches,
          hooks,
          hookVersion,
          mcpServers,
        } = plugin;
        return {
          name,
          title,
          titleZh,
          description,
          descriptionZh,
          shortDescription,
          shortDescriptionZh,
          version,
          package: pkg,
          source,
          skills: skills.map(({ name, version, description }) => ({ name, version, description })),
          workbenches,
          hooks,
          hookVersion,
          mcpServers: mcpServers.map(({ name, transport, oauth, signIn }) => ({
            name,
            transport,
            oauth,
            signIn,
            setup: [],
            target: "",
          })),
        };
      }),
    })),
  Array.isArray,
);
const indexes = createCatalogStore<PluginIndexEntry[]>(
  "plugin-index.v1",
  (entries) =>
    entries.map(
      ({
        name,
        title,
        titleZh,
        version,
        description,
        descriptionZh,
        shortDescription,
        shortDescriptionZh,
        authors,
        license,
        categories,
        localInstall,
      }) => ({
        name,
        title,
        titleZh,
        version,
        description,
        descriptionZh,
        shortDescription,
        shortDescriptionZh,
        authors,
        license,
        categories,
        localInstall,
      }),
    ),
  Array.isArray,
);
const deployments = createCatalogStore<InstalledPluginsResponse>(
  "plugin-deployments.v1",
  ({ machineId, plugins, shipped, restartPending }) => ({
    machineId,
    shipped,
    restartPending,
    file: "",
    plugins: plugins.map(
      ({ specifier, active, builtin, modules, replaces, everywhere, machines, here }) => ({
        specifier,
        active,
        builtin,
        modules,
        replaces,
        everywhere,
        machines,
        here,
      }),
    ),
  }),
  (value) => Array.isArray(value.plugins) && Array.isArray(value.shipped),
);

const loadLibrary = (_: string, id: string) => api.getPluginLibrary(id).then((r) => r.groups);
const loadIndex = (_: string, id: string) => api.getPluginIndex(id).then((r) => r.plugins);

/** One machine's market as the page reads it: its answers (market-rows.ts), and how to ask again. */
export interface MachineMarket extends MachineMarketData {
  /** Out of reach, or one of its reads failed: its cards stand as last answered. */
  unavailable: boolean;
  /** Connected, and a read failed: asking again may help. */
  retryable: boolean;
  /** Connected and asked, with no answer yet about the modules it runs and no failure either. */
  runningPending: boolean;
  /** Asks the machine for all three again. */
  refresh: () => void;
  /** Asks the machine again for the modules it runs, and settles when it has answered. */
  rereadRunning: () => Promise<void>;
}

/**
 * Every machine's library, registry index and running modules, each read on that machine
 * through this server's proxy (lib/machine-catalogs.ts), in the machines list's order.
 */
export function useMachineMarkets(projectId: string | null): MachineMarket[] {
  const libs = useMachineCatalogs(libraries, projectId, loadLibrary);
  const registry = useMachineCatalogs(indexes, projectId, loadIndex);
  const installed = useMachineCatalogs(deployments, projectId, api.getInstalledPlugins);
  return libs.map((library, i) => {
    const index = registry[i]!;
    const running = installed[i]!;
    const connected = library.machine.link === "connected";
    const failed = Boolean(library.error || running.error || index.error);
    return {
      machineId: library.machine.machineId,
      label: library.machine.label,
      library: library.value,
      index: index.value,
      running: running.value,
      libraryLive: library.live,
      indexLive: index.live,
      runningLive: running.live,
      unavailable: !connected || failed,
      retryable: connected && failed,
      runningPending: connected && running.value === null && running.error === null,
      refresh: () => {
        library.refresh();
        running.refresh();
        index.refresh();
      },
      rereadRunning: running.reread,
    };
  });
}
