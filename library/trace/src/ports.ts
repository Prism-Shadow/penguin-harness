/**
 * The ports the trace domain's services need from the server's assembly. The server binds
 * them to its own mechanisms (see the Providers in packages/server); the package defines the
 * shapes so it never imports the server.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { HarnessInfo, IfacesSummary } from "@prismshadow/penguin-core";
import type { TieredRates } from "@prismshadow/penguin-library-model";

/** Where the harness root is. The server's `Paths` capability satisfies this structurally. */
@Interface()
export abstract class TracePaths {
  abstract root: string;
}

/** Where the harness root is, for the harness history (the server's `Paths` satisfies it). */
@Interface()
export abstract class HarnessHistoryPaths {
  abstract root: string;
}

/** The harness history's clock (the server's `Clock` satisfies it). */
@Interface()
export abstract class HarnessHistoryClock {
  abstract now(): Date;
}

/** The harness history's log surface: one line at a time (the server's `Log` satisfies it). */
@Interface()
export abstract class HarnessHistoryLog {
  abstract line(text: string): void;
}

/** What the harness history notifies through: live clients reload once a version lands (the server's `Channels` satisfies it). */
@Interface()
export abstract class HarnessHistoryChannels {
  abstract broadcast(prefix: string, data: unknown, event?: string): void;
}

/**
 * The runtime's frozen operations, reached in-process (the server's `HmrControl` capability
 * satisfies it): when the boot's swap is over, and the upgrade endpoint a rollback drives.
 */
@Interface()
export abstract class HarnessHistoryRuntime {
  /** Resolves when the swap that booted this platform is over — the runtime's commit included. */
  abstract current(): Promise<unknown>;
  /** The runtime's own upgrade endpoint, minus the network: no bind address, scheme gate or token. */
  abstract endpoint(request: Request): Promise<Response>;
}

/** What the history reads of the harness build on disk (the server's hmr manifest readers satisfy it). */
@Interface()
export abstract class HarnessHistoryBuilds {
  /** The runtime's current commit (harness.json), or null on a packaged boot. */
  abstract info(root: string): Promise<HarnessInfo | null>;
  /** The pushed upgrade body — bundles, web archive, assets, provenance — or null when nothing was pushed here. */
  abstract pushedBuild(root: string): Buffer | null;
}

/** An interface table as this platform was built from it: a hash plus its members, carried as written. */
export type HarnessTable = {
  hash: string;
  ifaces: unknown;
  types: unknown;
  modules: unknown;
};

/** This platform's own interface table, as compiled into it. */
@Interface()
export abstract class HarnessHistoryTable {
  /** The raw table with its summary — one reader, so the two cannot drift. */
  abstract own(): { table: HarnessTable; summary: IfacesSummary };
}

/** Where a Project's pricing table lives. The server's `ProjectConfigStore` satisfies this structurally. */
@Interface()
export abstract class TracePricing {
  /** The Project's current price for a paired reference; resolves undefined when it carries none. */
  abstract getPricing(
    projectId: string,
    provider: string,
    modelId: string,
  ): Promise<TieredRates | undefined>;
}
