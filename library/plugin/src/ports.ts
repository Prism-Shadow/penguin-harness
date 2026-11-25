/**
 * The ports the plugin domain's services need from the server's assembly. The server binds
 * them to its own mechanisms (see the shims and providers in packages/server); the package
 * defines the shapes so it never imports the server.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { IfaceTable, Resources } from "@prismshadow/penguin-core/kernel";

/** The process configuration, as far as the plugin domain reads it (the server's `Config` satisfies this structurally). */
@Interface()
export abstract class PluginConfig {
  /** Local data root directory. */
  abstract root: string;
}

/** The hot-update control object, as far as the plugin domain reads it (the server's `Hmr` satisfies this structurally). */
@Interface()
export abstract class PluginHmr {
  /** The registry resources of the running App (the plugin host is claimed through it). */
  abstract resources: Resources;
  /** The pushed bundle's assets directory, null when this process was not pushed. */
  abstract assetsDir(): string | null;
}

/** One change a re-assembly may write or undo, as `plugin-modules` hands it to the server. */
export interface ReassemblyChange {
  write(): Promise<void>;
  undo(): Promise<void>;
}

/** Re-assembling the App after a plugin module change (the server's `Reassembly` satisfies this structurally). */
@Interface()
export abstract class PluginReassembly {
  abstract reassemble(change?: ReassemblyChange): Promise<boolean>;
}

/** One live channel a module change notifies (the server's channel hub satisfies this structurally). */
@Interface()
export abstract class PluginChannel {
  abstract publish(data: unknown, event?: string): unknown;
}

/** The channel hub, as far as `plugin-modules` reads it: one user's live channel, by user id (the server composes it over its own hub and the user channel key). */
@Interface()
export abstract class PluginChannels {
  abstract peekUser(userId: string): PluginChannel | undefined;
}

/** The plugin domain's log surface: one line at a time (the server's `Log` satisfies it). */
@Interface()
export abstract class PluginLog {
  abstract line(text: string): void;
}

/** The plugin domain's clock (the server's `Clock` satisfies it). */
@Interface()
export abstract class PluginClock {
  abstract now(): Date;
}

/**
 * The server's own platform facts the plugin loader reads: where a pushed bundle's assets are
 * unpacked (the server's `unpackedAssetsDir`), and the platform's own interface table
 * (`ifaces.json`) the loader compares a plugin's host interfaces against. The server binds
 * these once at its import paths; the package reads them through `pluginPlatformPorts()`.
 */
export interface PluginPlatformPorts {
  unpackedAssetsDir(dir: string): string;
  platformIfaceTable: IfaceTable;
  /** Whether this process runs from a development checkout (offline archives ship their sources there). */
  isDevProfile(): boolean;
}

let platformPorts: PluginPlatformPorts | null = null;

/** Binds the server's platform facts; the server's import paths call this before anything loads. */
export function bindPluginPlatformPorts(next: PluginPlatformPorts): void {
  platformPorts = next;
}

/** The bound platform facts; throws when nothing bound them (a server import path always has). */
export function pluginPlatformPorts(): PluginPlatformPorts {
  if (platformPorts === null) {
    throw new Error(
      "the plugin platform ports are not bound: import the server's plugin loader path first",
    );
  }
  return platformPorts;
}

/**
 * The workbench service, as far as a plugin's uninstall reads it (the server's `Workbenches`
 * satisfies this structurally). `remove` throws when the workbench is gone; `notFound` tells
 * such an error from a real failure, so a part already removed is not reported as one.
 */
@Interface()
export abstract class PluginUninstallWorkbenches {
  abstract remove(projectId: string, agentId: string, workbenchId: string): Promise<void>;
  abstract notFound(err: unknown): boolean;
}

/**
 * The server's own-table listing: the boot-time steps that add packages to a Project's
 * `[plugins.<machineId>]` table by editing its config file directly. The server binds it at its
 * import paths; `UnparseableConfig` is the very class its reader throws, so a catch can tell a
 * file that is not TOML from one it cannot read or write.
 */
export interface OwnTableListingPort {
  listInOwnTable(
    root: string,
    projectId: string,
    machineId: string,
    packages: readonly string[],
  ): Promise<string[]>;
  UnparseableConfig: new (message: string) => Error;
}

let ownTableListingPort: OwnTableListingPort | null = null;

/** Binds the server's own-table listing; the server's import paths call this before anything boots. */
export function bindOwnTableListing(next: OwnTableListingPort): void {
  ownTableListingPort = next;
}

/** The bound own-table listing; throws when nothing bound it (a server import path always has). */
export function ownTableListing(): OwnTableListingPort {
  if (ownTableListingPort === null) {
    throw new Error(
      "the plugin own-table listing is not bound: import the server's preinstall-once path first",
    );
  }
  return ownTableListingPort;
}
