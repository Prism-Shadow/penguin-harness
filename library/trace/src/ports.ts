/**
 * The ports the trace domain's services need from the server's assembly. The server binds
 * them to its own mechanisms (see the Providers in packages/server); the package defines the
 * shapes so it never imports the server.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { TieredRates } from "@prismshadow/penguin-library-model";

/** Where the harness root is. The server's `Paths` capability satisfies this structurally. */
@Interface()
export abstract class TracePaths {
  abstract root: string;
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
