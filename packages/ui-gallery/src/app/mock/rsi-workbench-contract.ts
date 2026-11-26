/**
 * The Self-Evolution Workbench's handler contract, as the gallery's mock answers it: the wire types
 * of its routes, its case pager, and the request its Start sends (`buildRequest`), so the demo
 * answers what a server running the pinned package would.
 *
 * The package publishes these in its handler's source (`workbenches/benchmark/lib/`) but exports
 * only `./format` and `./package.json`, so they are reached by path, and only from here: every
 * other gallery module and suite imports this one. Once the package exports them (`./api` for the
 * types and the pager, `./prompts` for `buildRequest` and `TaskSpec`), the paths below become those
 * specifiers and nothing else changes.
 */
export type {
  BenchmarkCaseSummary,
  BenchmarkCasesResponse,
  BenchmarkCreateResponse,
  BenchmarkEvaluation,
  BenchmarksResponse,
  BenchmarkStatus,
  BenchmarkSummary,
  CaseFilesResponse,
  CaseMaterial,
  PromptResponse,
  TaskRecord,
  TaskRecordResponse,
  TasksResponse,
  WorkbenchTaskKind,
} from "../../../node_modules/@penguinharness/rsi-workbench/workbenches/benchmark/lib/api";
export { casePage } from "../../../node_modules/@penguinharness/rsi-workbench/workbenches/benchmark/lib/api";
export { buildRequest } from "../../../node_modules/@penguinharness/rsi-workbench/workbenches/benchmark/lib/prompts";
export type { TaskSpec } from "../../../node_modules/@penguinharness/rsi-workbench/workbenches/benchmark/lib/prompts";
