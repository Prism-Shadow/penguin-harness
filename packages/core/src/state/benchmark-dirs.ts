/**
 * Where a Project's Benchmarks are: the Evaluation Center's data folder, which is the system
 * Agent's agent-level data of the app `benchmark` (PRFC-0034, PRFC-0032's `agent` level):
 *
 *   <root>/projects/<p>/agents/system_agent/app/data/benchmark/<benchmark_id>/
 *
 * Agent level, because a Benchmark is the Project's data and the system Agent is never deleted
 * or exported, so the folder lives exactly as long as the Project does. Where they sit does not
 * change what they are: a Benchmark is a peer of an Agent, not something an Agent owns — one
 * Benchmark can evaluate several Agents, and the Agent under test is recorded on each scoreboard
 * evaluation.
 *
 * Before 2026-11 they were the Project's `benchmarks/`, beside `agents/`; the layout migration
 * (state/layout-migration/) moves them and leaves a link there until 1.0. A Project whose
 * `system_agent` is an Agent of the user's (compat C1, system-agent.ts) has no Evaluation Center
 * data folder: its Benchmarks stay in the old place, which {@link resolveBenchmarksDir} names.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { SYSTEM_AGENT_ID } from "./builtin-agents.js";
import { projectDir, systemConfigPath, workbenchDataDir } from "./paths.js";
import { isSystemAgent } from "./system-agent.js";

/** The Evaluation Center's app id: the name of its data folder under the system Agent's `app/data/`. */
export const BENCHMARK_APP_ID = "benchmark";

/** `<root>/projects/<p>/agents/system_agent/app/data/benchmark`: the Project's Benchmarks (none until the first one is written). */
export function benchmarksDir(root: string, projectId: string): string {
  return workbenchDataDir(root, projectId, SYSTEM_AGENT_ID, BENCHMARK_APP_ID);
}

/**
 * `<root>/projects/<p>/benchmarks`: where a Project's Benchmarks were before 2026-11. After the
 * migration it is a link to {@link benchmarksDir}; it stays the folder only in a Project whose
 * `system_agent` is the user's own Agent. Both uses go at 1.0.
 */
export function legacyBenchmarksDir(root: string, projectId: string): string {
  return path.join(projectDir(root, projectId), "benchmarks");
}

/**
 * The folder the Project's Benchmarks are read from and written to: {@link benchmarksDir}, or
 * the old {@link legacyBenchmarksDir} while the Project's `system_agent` is an Agent of the
 * user's (compat C1, kept until 1.0 with the system Agent's own case). A Project with no
 * `system_agent` yet gets the new folder: the system Agent is provisioned where the id is free.
 */
export async function resolveBenchmarksDir(root: string, projectId: string): Promise<string> {
  const config = systemConfigPath(root, projectId, SYSTEM_AGENT_ID);
  const held = await fs
    .access(config)
    .then(() => true)
    .catch(() => false);
  if (held && !(await isSystemAgent(root, projectId, SYSTEM_AGENT_ID))) {
    return legacyBenchmarksDir(root, projectId);
  }
  return benchmarksDir(root, projectId);
}
