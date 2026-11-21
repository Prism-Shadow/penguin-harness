/**
 * The ports the trace domain's services need from the server's assembly. The server binds
 * them to its own mechanisms (see the Providers in packages/server); the package defines the
 * shapes so it never imports the server.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { PricingLookup } from "./cost.js";

/** Where the harness root is. The server's `Paths` capability satisfies this structurally. */
export abstract class TracePaths extends Interface<{ readonly root: string }>() {}

/** Where a Project's pricing table lives. The server's `ProjectConfigStore` satisfies this structurally. */
export abstract class TracePricing extends Interface<{ getPricing: PricingLookup }>() {}
