/**
 * Edits of one Project's plugin tables (the `[plugins]` key of `.project_config.toml`: the shared
 * table and each machine's own), shared by the administrator's installed-plugins routes and the
 * plugin-modules service (PRFC-0031).
 *
 * An edit that changes what THIS server runs for the Project is a re-assembly change: read and
 * written inside the re-assembly's queue, so two edits never interleave, and undone — the tables
 * as they were — when the new tree fails to boot. An edit that only concerns other machines is
 * written as it is: re-assembling would rebuild the App for a tree that stays the same.
 */
import {
  effectivePluginTable,
  type PluginRequirement,
  type PluginTables,
} from "@prismshadow/penguin-core";
import type { ProjectConfigStore } from "@prismshadow/penguin-library-project";
import type { ReassemblyChange } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import { PLUGINS_FILE } from "../plugin/loader.js";

export interface PluginTablesDeps {
  /** This server's own machine id: the `[plugins.<machineId>]` table that is its own. */
  machineId: string;
  projectConfig: Pick<ProjectConfigStore, "getPluginTables" | "setPluginTables">;
  /**
   * Writes the change and re-assembles the App on it. Answers whether the running tree is the
   * new one; false when its boot failed (the change is then undone and the previous App
   * restored) or when the runtime cannot re-assemble at all (the change stays written, for the
   * restart that will read it).
   */
  apply: (change: ReassemblyChange) => Promise<boolean>;
}

export interface PluginTableEdits {
  /** The Project's tables; 400 `invalid_plugins_file` when its config will not parse. */
  tablesOf(projectId: string): Promise<PluginTables>;
  /** Writes `next` of the Project's tables; answers whether the App took it (always, when this server's tree is unchanged). */
  edit(projectId: string, next: (tables: PluginTables) => PluginTables): Promise<boolean>;
  /** Lists `name` in the Project's shared table, or — with `machineId` — in that machine's own. */
  list(
    projectId: string,
    name: string,
    requirement: PluginRequirement,
    machineId: string | null,
  ): Promise<boolean>;
}

export function pluginTableEdits(deps: PluginTablesDeps): PluginTableEdits {
  const tablesOf = (projectId: string): Promise<PluginTables> =>
    deps.projectConfig.getPluginTables(projectId).catch((err: unknown) => {
      // A Project whose config will not parse cannot be answered for — its models are just
      // as unreadable — and saying "no plugins" would read as a healthy empty deployment.
      throw new HttpError(
        400,
        "invalid_plugins_file",
        `${projectId}: ${PLUGINS_FILE} could not be read: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

  const edit = async (
    projectId: string,
    next: (tables: PluginTables) => PluginTables,
  ): Promise<boolean> => {
    const current = await tablesOf(projectId);
    const same = (a: PluginTables, b: PluginTables) =>
      JSON.stringify(effectivePluginTable(a, deps.machineId)) ===
      JSON.stringify(effectivePluginTable(b, deps.machineId));
    if (same(current, next(current))) {
      await deps.projectConfig.setPluginTables(projectId, next(current));
      return true;
    }
    let previous: PluginTables | null = null;
    return deps.apply({
      write: async () => {
        previous = await deps.projectConfig.getPluginTables(projectId);
        await deps.projectConfig.setPluginTables(projectId, next(previous));
      },
      undo: async () => {
        if (previous !== null) await deps.projectConfig.setPluginTables(projectId, previous);
      },
    });
  };

  const list = (
    projectId: string,
    name: string,
    requirement: PluginRequirement,
    machineId: string | null,
  ) =>
    edit(projectId, (tables) =>
      machineId === null
        ? { ...tables, all: { ...tables.all, [name]: requirement } }
        : {
            ...tables,
            machines: {
              ...tables.machines,
              [machineId]: { ...tables.machines[machineId], [name]: requirement },
            },
          },
    );

  return { tablesOf, edit, list };
}

/** `packages` added to `machineId`'s own table, each as an administrator's entry reads: any version. */
export function withOwnListing(
  tables: PluginTables,
  machineId: string,
  packages: readonly string[],
): PluginTables {
  const own = { ...tables.machines[machineId] };
  for (const pkg of packages) own[pkg] = {};
  return { ...tables, machines: { ...tables.machines, [machineId]: own } };
}
