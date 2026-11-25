/**
 * How plugin packages reach and leave the data root's prefix, as a node (PluginPackages), so a
 * test stands in for it instead of running npm: the routes reach the prefix only through this.
 *
 * Which installer runs is decided per operation, by whether this machine has npm right now
 * (install.ts locateNpm): npm found, npm does it, exactly as it always has — a registry, a
 * scope, credentials or a proxy configured for npm (`.npmrc`, the environment) is honoured
 * only by npm, and a deployment with npm keeps installing the way it did. npm not found, a
 * package that needs nothing npm does is installed (and removed) without it
 * (direct-install.ts); one that does is refused with the reason and how to get npm. The node
 * keeps its name for the installer it uses wherever there is one.
 */
import { Component } from "@prismshadow/penguin-core/kernel";
import type { PluginPackages } from "./mechanisms.js";
import {
  checkFromRegistry,
  installChannel as installChannelWithoutNpm,
  installFiles as installFilesWithoutNpm,
  installFromRegistry,
  installTarball as installTarballWithoutNpm,
  removeWithoutNpm,
  type WithoutNpm,
} from "./direct-install.js";
import {
  checkPluginSource,
  installPluginChannel,
  installPluginFiles,
  installPluginSource,
  installPluginTarball,
  locateNpm,
  npm,
  removePluginPackage,
  type InstalledPackage,
  type NpmRun,
  type NpmSearch,
} from "./install.js";
import type { IndexChannel } from "./registry.js";

/** What the installer runs against: npm when there is one, and the network otherwise. */
export interface PluginPackagesIo {
  /** Whether this machine has npm now, and where it was looked for if not. */
  locate: () => NpmSearch;
  /** The npm to run when `locate` finds one. */
  npm: NpmRun;
  /** The fetch an install without npm downloads through; the global one (and its proxy) by default. */
  fetch: () => typeof fetch;
}

const machine: PluginPackagesIo = {
  locate: locateNpm,
  npm,
  fetch: () => globalThis.fetch,
};

@Component()
export class NpmPluginPackages implements PluginPackages {
  constructor(private readonly io: PluginPackagesIo = machine) {}

  /** The installer without npm, or null when npm is here and does the work. */
  private withoutNpm(extra: Partial<WithoutNpm> = {}): WithoutNpm | null {
    const search = this.io.locate();
    if (search.found) return null;
    return { fetch: this.io.fetch(), npmNotes: search.notes, ...extra };
  }

  /**
   * Whether the registry has a name, asked before it is installed: `npm view` within a short
   * window (install.ts checkPluginSource); without npm, the registry's document, each address
   * within the same window (direct-install.ts checkFromRegistry).
   */
  check(root: string, spec: string): Promise<void> {
    const direct = this.withoutNpm();
    return direct === null
      ? checkPluginSource(root, spec, this.io.npm)
      : checkFromRegistry(spec, direct);
  }

  /** By name or by link (install.ts installPluginSource; without npm, by name only). */
  install(root: string, source: string): Promise<InstalledPackage> {
    const direct = this.withoutNpm();
    return direct === null
      ? installPluginSource(root, source, this.io.npm)
      : installFromRegistry(root, source, direct);
  }

  /** An uploaded package's files (install.ts installPluginFiles). */
  installFiles(root: string, files: Record<string, Uint8Array>): Promise<InstalledPackage> {
    const direct = this.withoutNpm();
    const byPath = new Map(Object.entries(files));
    return direct === null
      ? installPluginFiles(root, byPath, this.io.npm)
      : installFilesWithoutNpm(root, byPath, direct);
  }

  /**
   * A verified package tarball on this machine, an offline archive: npm installs it
   * (install.ts installPluginTarball); without npm, it is placed directly
   * (direct-install.ts installTarball).
   */
  installTarball(root: string, file: string, name: string): Promise<InstalledPackage> {
    const direct = this.withoutNpm();
    return direct === null
      ? installPluginTarball(root, file, name, this.io.npm)
      : installTarballWithoutNpm(root, file, name, direct);
  }

  /** A version from the published index's release channel (install.ts installPluginChannel). */
  installChannel(
    root: string,
    channel: IndexChannel,
    opts: { onProgress?: (received: number, total: number | null) => void } = {},
  ): Promise<InstalledPackage> {
    const direct = this.withoutNpm({ onProgress: opts.onProgress });
    return direct === null
      ? installPluginChannel(root, channel, { npm: this.io.npm, onProgress: opts.onProgress })
      : installChannelWithoutNpm(root, channel, direct);
  }

  remove(root: string, name: string): Promise<void> {
    const direct = this.withoutNpm();
    return direct === null
      ? removePluginPackage(root, name, this.io.npm)
      : removeWithoutNpm(root, name);
  }
}
