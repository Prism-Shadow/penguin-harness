/**
 * The storage plugin, for the Storage suites that boot the real App: its server module as the
 * runtime loads it. The one file in the host's tests that reaches into the plugin's sources.
 *
 * The module class comes from the plugin's sources, paired with the manifests of the table the
 * plugin's build generates (`plugins/storage/ifaces.json`) — the pairing the loader does for the
 * built package.
 */
import path from "node:path";
import { readPluginTable } from "@prismshadow/penguin-core";
import { moduleDefOf } from "@prismshadow/penguin-core/kernel";
import { PluginHost } from "../../src/plugin/host.js";
import { StorageModule } from "../../../../plugins/storage/src/server/module.js";

export type * from "../../../../plugins/storage/src/types.js";

const PLUGIN_DIR = path.resolve(import.meta.dirname, "../../../../plugins/storage");

/** A plugin host holding the storage plugin's server module, for `createTestApp({ plugins })`. */
export function storagePlugin(): PluginHost {
  const table = readPluginTable(PLUGIN_DIR);
  if (table === null) throw new Error(`${PLUGIN_DIR} has no ifaces.json: build the plugin first`);
  const host = new PluginHost();
  host.use({
    specifier: "@penguinharness/storage",
    modules: [moduleDefOf(StorageModule, { manifests: table.manifests })],
    replaces: [],
    ifaces: table.ifaces,
  });
  return host;
}
