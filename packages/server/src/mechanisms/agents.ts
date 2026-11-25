/**
 * The agents mechanisms: what a node may require, declared apart from what implements it.
 * The agent domain's mechanisms (AgentConfig, Memory, Snapshots and the lifecycle,
 * AgentLifecycle) moved to the agent domain library (services+http+cli restack S3, S9d and
 * S10) and are re-exported here unchanged so the server's import paths keep one site.
 */
export { Benchmarks } from "@prismshadow/penguin-library-benchmark/contract";
export type {
  BenchmarkArchive,
  BenchmarkCreateInput,
  BenchmarkImportOptions,
} from "@prismshadow/penguin-library-benchmark/types";
export {
  AgentConfig,
  Memory,
  Snapshots,
  AgentLifecycle,
} from "@prismshadow/penguin-library-agent/contract";
export type { AgentPackage } from "@prismshadow/penguin-library-agent/contract";
export type { AgentCreation, AgentListItem } from "@prismshadow/penguin-library-agent/types";
