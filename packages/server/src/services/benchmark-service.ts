/**
 * The benchmark domain's service moved to the benchmark domain package
 * (@prismshadow/penguin-library-benchmark/benchmark-service, services+http+cli restack S2) —
 * it speaks library vocabulary and structural ports. This file keeps the assembly: the
 * Provider binds the service's paths port to the server's `Paths` capability and its
 * workspace-files port to the `WorkspaceFiles` mechanism, and re-exports the moved shapes
 * for the server's own import paths.
 */
import { Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { Paths } from "../hmr/capabilities.js";
import type { WorkspaceFiles } from "../mechanisms/workspace.js";
import { Benchmarks } from "@prismshadow/penguin-library-benchmark/contract";
import { BenchmarkService } from "@prismshadow/penguin-library-benchmark/benchmark-service";

export { BenchmarkService } from "@prismshadow/penguin-library-benchmark/benchmark-service";
export type {
  BenchmarkCaseInput,
  BenchmarkCreateInput,
  BenchmarkImportOptions,
  BenchmarkArchive,
} from "@prismshadow/penguin-library-benchmark/types";

/** The benchmark assembly: binds the two structural ports. */
@Module()
export class BenchmarkServiceProvider {
  @Use() private readonly paths!: Paths;
  @Use() private readonly workspaceFiles!: WorkspaceFiles;
  @Provide() benchmarks!: Benchmarks;
  @Provide() service!: BenchmarkService;

  setup() {
    // The service's ports are decorator-injected fields; the server binds them by hand here.
    this.service = Object.assign(new BenchmarkService(), {
      paths: this.paths,
      workspaceFiles: this.workspaceFiles,
    });
    this.benchmarks = this.service;
  }
}
