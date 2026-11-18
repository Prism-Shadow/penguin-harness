import type {
  InstalledPluginsResponse,
  PluginGroupItem,
  PluginIndexEntry,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { createCatalogStore } from "../../lib/catalog-storage";
import { useMachineCatalogs } from "../../lib/machine-catalogs";
import { moduleParts, pluginRows, type PluginRow } from "./plugin-groups";

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

export function useMachineMarkets(projectId: string | null) {
  const libs = useMachineCatalogs(libraries, projectId, loadLibrary);
  const registry = useMachineCatalogs(indexes, projectId, loadIndex);
  const installed = useMachineCatalogs(deployments, projectId, api.getInstalledPlugins);
  return libs.map((library, i) => {
    const index = registry[i]!;
    const deployment = installed[i]!;
    const { machineId, label } = library.machine;
    const rows = pluginRows(library.value ?? [], moduleParts(deployment.value, index.value ?? []));
    return {
      machineId,
      label,
      groups: library.value ?? [],
      deployment,
      index,
      retryable:
        library.machine.link === "connected" &&
        Boolean(library.error || deployment.error || index.error),
      unavailable:
        library.machine.link !== "connected" ||
        !!(library.error || deployment.error || index.error),
      rows: rows.map((row) => ({
        ...row,
        key: machineId + "/" + row.key,
        origin: {
          machineId,
          label,
          live: row.library
            ? library.live
            : deployment.live && (row.module?.entry ? index.live : true),
        },
      })),
      refresh: () => {
        library.refresh();
        deployment.refresh();
        index.refresh();
      },
    };
  });
}

export type MachineMarket = ReturnType<typeof useMachineMarkets>[number];

/** Common packages get one card; installations or versions available only elsewhere keep their origin. */
export function combinedMarketRows(local: PluginRow[], machines: MachineMarket[]): PluginRow[] {
  const packageKey = (row: PluginRow) => row.library?.package ?? row.module?.specifier ?? row.name;
  const here = new Map(local.map((row) => [packageKey(row), row]));
  return [
    ...local,
    ...machines.flatMap((machine) =>
      machine.rows.filter((row) => {
        const other = here.get(packageKey(row));
        if (!other) return true;
        if (row.library && (!other.library || other.library.version !== row.library.version))
          return true;
        return (
          row.module && row.module.state !== "none" && row.module.state !== other.module?.state
        );
      }),
    ),
  ];
}
