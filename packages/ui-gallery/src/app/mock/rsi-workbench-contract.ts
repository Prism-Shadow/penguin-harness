/**
 * The Self-Evolution Workbench's handler contract, as the gallery's mock answers it: the wire types
 * of its routes and its case pager (the package's `./api`), and the request its Start sends
 * (`buildRequest`, the package's `./prompts`), so the demo answers what a server running the
 * pinned package would. The gallery's modules and suites take them from here.
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
} from "@penguinharness/rsi-workbench/api";
export { casePage } from "@penguinharness/rsi-workbench/api";
export { buildRequest } from "@penguinharness/rsi-workbench/prompts";
export type { TaskSpec } from "@penguinharness/rsi-workbench/prompts";
