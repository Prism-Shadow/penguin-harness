/**
 * The harness history moved to the trace domain package
 * (@prismshadow/penguin-library-trace/harness-history, services+http+cli restack S12) — it
 * speaks library vocabulary and structural ports. This file keeps the assembly: the provider
 * binds the store's ports to the server's capabilities (paths, clock, log, the runtime's
 * upgrade channel, the channel hub, the hmr build readers, the platform's own interface
 * table) and re-exports the moved shapes for the server's own import paths.
 */
import { Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { Channels, Clock, HmrControl, Log, Paths } from "../hmr/capabilities.js";
import { readHarnessInfo } from "../hmr/manifest.js";
import { readPushedBuild } from "../hmr/pushed-build.js";
import { summarizeTable } from "@prismshadow/penguin-hmr";
import table from "../ifaces.json" with { type: "json" };
import {
  HarnessHistoryIface,
  HarnessHistoryStore,
} from "@prismshadow/penguin-library-trace/harness-history";
import type {
  HarnessHistoryBuilds,
  HarnessHistoryRuntime,
  HarnessTable,
} from "@prismshadow/penguin-library-trace/ports";

export {
  HarnessHistoryStore,
  HarnessHistoryIface,
  HISTORY_KEEP,
  KEEP_VERSIONS,
  versionId,
} from "@prismshadow/penguin-library-trace/harness-history";
export type { HarnessInfo } from "@prismshadow/penguin-core";

/** The harness-history assembly: binds the store's ports to the server's capabilities. */
@Module({ name: "HarnessHistoryStore" })
export class HarnessHistoryServiceProvider {
  @Use() private readonly paths!: Paths;
  @Use() private readonly clock!: Clock;
  @Use() private readonly log!: Log;
  @Use() private readonly hmrControl!: HmrControl;
  @Use() private readonly channels!: Channels;
  @Provide() HarnessHistoryStore!: HarnessHistoryStore;
  @Provide() HarnessHistoryIface!: HarnessHistoryIface;

  setup(ctx: ClassCtx): void {
    // The store's ports are decorator-injected fields; the server binds them by hand here.
    const own = table as unknown as HarnessTable;
    this.HarnessHistoryStore = Object.assign(new HarnessHistoryStore(), {
      paths: this.paths,
      clock: this.clock,
      log: this.log,
      hmrControl: {
        current: () => this.hmrControl.current(),
        endpoint: (request: Request) => this.hmrControl.endpoint(request),
      } satisfies HarnessHistoryRuntime,
      channels: this.channels,
      builds: {
        info: (root: string) => readHarnessInfo(root),
        pushedBuild: (root: string) => readPushedBuild(root),
      } satisfies HarnessHistoryBuilds,
      ownTable: {
        own: () => ({
          table: own,
          summary: summarizeTable(own as unknown as Parameters<typeof summarizeTable>[0]),
        }),
      },
    });
    this.HarnessHistoryIface = this.HarnessHistoryStore;
    // The store's boot record: setup defers it to the commit landing (the swap that is
    // booting this platform), and its disposed effect rides the provider's own effects.
    this.HarnessHistoryStore.setup(ctx);
  }
}
