/**
 * The plugin mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { InstalledPackage } from "../plugin/install.js";
import type { IndexChannel } from "../plugin/registry.js";

/**
 * PluginPackages: how plugin packages reach and leave the data root's npm prefix, as
 * NpmPluginPackages implements it (plugin/packages.ts) — with npm, or without it for a package
 * that needs nothing npm does on a machine that has none.
 */
@Interface()
export abstract class PluginPackages {
  /** A registry name (`name`, `name@range`) or a link npm fetches; answers which package that was. */
  abstract install(root: string, source: string): Promise<InstalledPackage>;
  /** An uploaded package's files, relative path → bytes (checked by the caller). */
  abstract installFiles(root: string, files: Record<string, Uint8Array>): Promise<InstalledPackage>;
  /** A version from the published index's release channel, its bytes verified against the entry's sha512. */
  abstract installChannel(
    root: string,
    channel: IndexChannel,
    opts?: { onProgress?: (received: number, total: number | null) => void },
  ): Promise<InstalledPackage>;
  abstract remove(root: string, name: string): Promise<void>;
}
