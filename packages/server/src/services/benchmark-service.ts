/**
 * The benchmark domain's service moved to the benchmark domain package
 * (@prismshadow/penguin-library-benchmark/benchmark-service, services+http+cli restack S2) —
 * it speaks library vocabulary and structural ports. This file keeps the assembly: the
 * Provider binds the service's paths port to the server's `Paths` capability and its
 * workspace-files port to the `WorkspaceFiles` mechanism, contributes the `benchmark` kind of
 * semantic id, and re-exports the moved shapes for the server's own import paths.
 */
import { Bind, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { Paths } from "../hmr/capabilities.js";
import type { WorkspaceFiles } from "../mechanisms/workspace.js";
import type { SemanticIdKindSource } from "./semantic-id-kinds.js";
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
@Module({
  contributes: {
    "SemanticIdModule.kinds": [
      // Writing a Benchmark is Project management: owner only, as its create route demands.
      { id: "BenchmarkService.semanticIdKind", kind: "benchmark", access: "owner" },
    ],
  },
})
export class BenchmarkServiceProvider {
  @Use() private readonly paths!: Paths;
  @Use() private readonly workspaceFiles!: WorkspaceFiles;
  @Provide() benchmarks!: Benchmarks;
  @Provide() service!: BenchmarkService;
  /** The `benchmark` kind of semantic id: the create dialog proposes an id from the title. */
  @Bind("BenchmarkService.semanticIdKind") semanticIdKind!: SemanticIdKindSource;

  setup() {
    this.service = new BenchmarkService();
    this.benchmarks = this.service;
    this.semanticIdKind = { takenIds: (projectId) => this.service.takenIds(projectId) };
  }
}
