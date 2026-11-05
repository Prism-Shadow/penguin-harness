/**
 * The plugin mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { InstalledPackage } from "../plugin/install.js";

/**
 * PluginPackages: how plugin packages reach and leave the data root's npm prefix, as
 * NpmPluginPackages implements it with npm (plugin/install.ts).
 */
@Interface()
export abstract class PluginPackages {
  /** A registry name (`name`, `name@range`) or a link npm fetches; answers which package that was. */
  abstract install(root: string, source: string): Promise<InstalledPackage>;
  /** An uploaded package's files, relative path → bytes (checked by the caller). */
  abstract installFiles(root: string, files: Record<string, Uint8Array>): Promise<InstalledPackage>;
  abstract remove(root: string, name: string): Promise<void>;
}
