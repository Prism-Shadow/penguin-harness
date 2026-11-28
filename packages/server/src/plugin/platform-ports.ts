/**
 * The server's platform facts the plugin library package reads through ports, bound once here:
 * where a pushed bundle's assets are unpacked (hmr/asset-archives.ts), the platform's own
 * interface table (ifaces.json), and whether this process runs from a development checkout.
 * The server's plugin import paths call {@link ensurePluginPlatformPorts} before anything loads.
 */
import {
  bindPluginPlatformPorts,
  type PluginUninstallWorkbenches,
} from "@prismshadow/penguin-library-plugin/ports";
import { unpackedAssetsDir } from "../hmr/asset-archives.js";
import { profileFromEnv } from "../machines/layout.js";
import type { Workbenches } from "../mechanisms/workbenches.js";
import { WorkbenchNotFound } from "../workbenches/errors.js";
import platformTable from "../ifaces.json" with { type: "json" };
import type { IfaceTable } from "@prismshadow/penguin-core/kernel";

let bound = false;

/** Binds the plugin platform ports; safe to call again (it binds the same facts). */
export function ensurePluginPlatformPorts(): void {
  if (bound) return;
  bound = true;
  bindPluginPlatformPorts({
    unpackedAssetsDir,
    platformIfaceTable: platformTable as unknown as IfaceTable,
    isDevProfile: () => profileFromEnv(process.env) === "dev",
  });
}

/** The workbench service behind the uninstall port: `notFound` tells its own 404 from a failure. */
export function pluginUninstallWorkbenches(
  workbenches: Pick<Workbenches, "remove">,
): PluginUninstallWorkbenches {
  return {
    remove: (projectId, agentId, workbenchId) =>
      workbenches.remove(projectId, agentId, workbenchId),
    notFound: (err) => err instanceof WorkbenchNotFound,
  };
}
