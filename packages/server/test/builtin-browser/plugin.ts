/**
 * The browser-automation plugin, for the browser suites that boot the real App: its server module
 * as the runtime loads it, and the few internals those suites drive directly. The one file in the
 * host's tests that reaches into the plugin's sources.
 *
 * The module classes come from the plugin's sources, paired with the manifests of the table the
 * plugin's build generates (`plugins/browser-automation/ifaces.json`) — the pairing the loader
 * does for the built package — so a suite that also imports an internal shares one copy of it.
 */
import path from "node:path";
import { readPluginTable } from "@prismshadow/penguin-core";
import { moduleDefOf } from "@prismshadow/penguin-core/kernel";
import type { ModuleClass } from "@prismshadow/penguin-core/kernel";
import { PluginHost } from "../../src/plugin/host.js";
import {
  BuiltinBrowserModule,
  ProcessShellPort,
} from "../../../../plugins/browser-automation/src/server/module.js";
import type { BrowserShellPort } from "../../../../plugins/browser-automation/src/server/shell-link.js";

export {
  FakeShell,
  tab,
} from "../../../../plugins/browser-automation/test/server/fake-shell.js";
export type { ExtensionSocket } from "../../../../plugins/browser-automation/src/server/extension-link.js";
export { PENGUIN_EXTENSION_ID } from "../../../../plugins/browser-automation/src/server/extension-origin.js";
export { ExtensionPairing } from "../../../../plugins/browser-automation/src/server/extension-pairing.js";
export { extensionUpgrade } from "../../../../plugins/browser-automation/src/server/extension-ws.js";
export { BuiltinBrowser } from "../../../../plugins/browser-automation/src/server/service.js";

const PLUGIN_DIR = path.resolve(import.meta.dirname, "../../../../plugins/browser-automation");

/**
 * A plugin host holding the browser's server module, for `createTestApp({ plugins })`. Given a
 * port, the module's shell-port node is that port's stand-in (a fake shell's, fake-shell.ts) —
 * built into the plugin's own subtree, which a test app's `nodes` stand-ins do not reach.
 */
export function browserPlugin(port?: BrowserShellPort): PluginHost {
  const table = readPluginTable(PLUGIN_DIR);
  if (table === null) throw new Error(`${PLUGIN_DIR} has no ifaces.json: build the plugin first`);
  const instances = new Map<ModuleClass, object>(
    port === undefined ? [] : [[ProcessShellPort, { current: () => port }]],
  );
  const host = new PluginHost();
  host.use({
    specifier: "@penguinharness/browser-automation",
    modules: [moduleDefOf(BuiltinBrowserModule, { manifests: table.manifests, instances })],
    replaces: [],
    ifaces: table.ifaces,
  });
  return host;
}
