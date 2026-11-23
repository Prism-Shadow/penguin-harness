/**
 * Benchmarks: the mechanism the benchmark domain's service implements. Moved from the
 * server's mechanisms/agents.ts so the contract lives beside its implementation
 * (services+http+cli restack S2).
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type {
  BenchmarkArchive,
  BenchmarkCasesResponse,
  BenchmarkCreateInput,
  BenchmarkImportOptions,
  BenchmarkSummary,
  BenchmarksResponse,
  CaseMaterial,
} from "./types.js";
import type {
  WorkspaceFileContent,
  WorkspaceFileReadOptions,
  WorkspaceFilesResponse,
} from "@prismshadow/penguin-library-workspace/types";

/** Benchmarks: the mechanism BenchmarkService implements. */
@Interface()
export abstract class Benchmarks {
  abstract list(projectId: string): Promise<BenchmarksResponse>;
  /** Every id `create` refuses as taken, as names only, including a folder that does not list. */
  abstract takenIds(projectId: string): Promise<string[]>;
  abstract create(projectId: string, input: BenchmarkCreateInput): Promise<BenchmarkSummary>;
  abstract remove(projectId: string, benchmarkId: string): Promise<void>;
  /**
   * Writes the package an uploaded zip holds, with origin `zip` or the git origin `options` names;
   * a taken id is a 409 unless `overwrite`, and an overwrite of one still being evaluated a 409 too.
   */
  abstract importArchive(
    projectId: string,
    archive: Uint8Array,
    options: BenchmarkImportOptions,
  ): Promise<BenchmarkSummary>;
  /** A published Benchmark's package as a zip. */
  abstract exportArchive(projectId: string, benchmarkId: string): Promise<BenchmarkArchive>;
  abstract listCases(projectId: string, benchmarkId: string): Promise<BenchmarkCasesResponse>;
  abstract listCaseFiles(
    projectId: string,
    benchmarkId: string,
    caseId: string,
    rel: string,
    material: CaseMaterial,
  ): Promise<WorkspaceFilesResponse>;
  abstract readCaseFile(
    projectId: string,
    benchmarkId: string,
    caseId: string,
    rel: string,
    material: CaseMaterial,
    options?: WorkspaceFileReadOptions,
  ): Promise<WorkspaceFileContent>;
}
