/**
 * The trace service moved to the trace domain package
 * (@prismshadow/penguin-library-trace/trace-service, services+http+cli restack S9) — it speaks
 * library vocabulary and a structural paths port. This file keeps the assembly: the Provider
 * binds the service's paths port to the server's `Paths` capability and re-exports the moved
 * shapes for the server's own import paths.
 */
import { Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { Paths } from "../hmr/capabilities.js";
import type { ProjectConfigStore } from "@prismshadow/penguin-library-project";
import type { SessionIndex, SessionOrigins } from "@prismshadow/penguin-library-session";
import type { TraceIndex, TraceIndexStore, Traces } from "@prismshadow/penguin-library-trace";
import { TraceService } from "@prismshadow/penguin-library-trace/trace-service";

export {
  TraceService,
  MESSAGES_PAGE_MAX_BYTES,
  rewriteSummaryPaths,
  toolExecutionInterval,
} from "@prismshadow/penguin-library-trace/trace-service";
export type { TraceSessionIndex } from "@prismshadow/penguin-library-trace/trace-service";

/** The trace assembly: binds the service's paths port (index/store/sessions/sources/config are decorator-injected fields the kernel fills). */
@Module()
export class TraceServiceProvider {
  @Use() private readonly paths!: Paths;
  @Use() private readonly index!: TraceIndex;
  @Use() private readonly store!: TraceIndexStore;
  @Use() private readonly sessions?: SessionIndex;
  @Use() private readonly sources?: SessionOrigins;
  @Use() private readonly projectConfig?: ProjectConfigStore;
  @Provide() traces!: Traces;
  @Provide() service!: TraceService;

  setup() {
    // The service's ports are decorator-injected fields; the server binds them by hand here.
    this.service = Object.assign(new TraceService(), {
      paths: this.paths,
      index: this.index,
      store: this.store,
      sessions: this.sessions,
      sources: this.sources,
      projectConfig: this.projectConfig,
    });
    this.traces = this.service;
  }
}
