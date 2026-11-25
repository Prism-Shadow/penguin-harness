/**
 * The trace index moved to the trace domain package
 * (@prismshadow/penguin-library-trace/trace-index, services+http+cli restack S9) — it speaks
 * library vocabulary and a structural paths port. This file keeps the assembly: the Provider
 * binds the index's paths port to the server's `Paths` capability and re-exports the moved
 * shapes for the server's own import paths.
 */
import { Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { Paths } from "../hmr/capabilities.js";
import type { SessionOrigins } from "@prismshadow/penguin-library-session";
import type { TraceIndex, TraceIndexStore } from "@prismshadow/penguin-library-trace";
import { TraceIndexService } from "@prismshadow/penguin-library-trace/trace-index";

export { TraceIndexService, traceFilePath } from "@prismshadow/penguin-library-trace/trace-index";

/** The trace-index assembly: binds the index's paths port and its store (the ports are decorator-injected fields the server binds by hand). */
@Module()
export class TraceIndexServiceProvider {
  @Use() private readonly paths!: Paths;
  @Use() private readonly repo!: TraceIndexStore;
  @Use() private readonly sources?: SessionOrigins;
  @Provide() index!: TraceIndex;
  @Provide() service!: TraceIndexService;

  setup() {
    // The index's ports are decorator-injected fields; the server binds them by hand here.
    this.service = Object.assign(new TraceIndexService(), {
      paths: this.paths,
      repo: this.repo,
      sources: this.sources,
    });
    this.index = this.service;
  }
}
