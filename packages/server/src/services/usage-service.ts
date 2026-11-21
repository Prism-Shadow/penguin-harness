/**
 * The usage domain's service moved to the observability domain package
 * (@prismshadow/penguin-library-observability/usage-service, services+http+cli restack S6) —
 * it speaks library vocabulary and structural ports. This file keeps the assembly: the
 * Provider binds the service's clock port to the server's `Clock` capability and re-exports
 * the moved shapes for the server's own import paths.
 */
import { Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { Clock } from "../hmr/capabilities.js";
import type { ProjectConfigStore } from "@prismshadow/penguin-library-project";
import type { ErrorLog, UsageQueries, UsageStore } from "@prismshadow/penguin-library-observability";
import { UsageService } from "@prismshadow/penguin-library-observability/usage-service";

export { UsageService } from "@prismshadow/penguin-library-observability/usage-service";
export type {
  PricingRates,
  TieredRates,
  PricingLookup,
} from "@prismshadow/penguin-library-observability/usage-service";
export {
  requestCostUsd,
  requestCostParts,
  sumCostParts,
  ZERO_COST_PARTS,
  ratesAt,
} from "@prismshadow/penguin-library-observability/usage-service";

/** The usage assembly: binds the clock port (the storage and config ports are decorator-injected fields the kernel fills). */
@Module()
export class UsageServiceProvider {
  @Use() private readonly usage!: UsageStore;
  @Use() private readonly errors!: ErrorLog;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Use() private readonly clock!: Clock;
  @Provide() usageQueries!: UsageQueries;
  @Provide() service!: UsageService;

  setup() {
    // The service's ports are decorator-injected fields; the server binds them by hand here.
    this.service = Object.assign(new UsageService(), {
      usage: this.usage,
      errors: this.errors,
      projectConfig: this.projectConfig,
      clock: this.clock,
    });
    this.usageQueries = this.service;
  }
}
