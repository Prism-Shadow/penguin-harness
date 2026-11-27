/**
 * Where a Project's Benchmarks were before the Self-Evolution Workbench kept them per Agent: the
 * old Evaluation Center's data folder, the system Agent's agent-level data of the app `benchmark`
 * (PRFC-0034, PRFC-0032's `agent` level),
 *
 *   <root>/projects/<p>/agents/system_agent/app/data/benchmark/<benchmark_id>/
 *
 * and, before 2026-11, the Project's `benchmarks/` beside `agents/`. Benchmarks now live in the
 * data folder of the workbench `benchmark` of the Agent it is installed on (the default Agent's
 * `agents/default_agent/app/data/benchmark/`), which the workbench reads and writes itself.
 *
 * BACKWARD COMPATIBILITY. Nothing reads these folders any more except the steps that move them:
 * the layout migration (state/layout-migration/, `benchmarks/` → the system Agent's folder) and
 * the server's one-time move into the default Agent's workbench data
 * (packages/server's services/rsi-workbench-migration.ts), plus the server's `AppData` until its
 * seam goes. Each move leaves a link at the place it emptied. A Project whose `system_agent` is an
 * Agent of the user's (compat C1, system-agent.ts) never had the system Agent's folder: its
 * Benchmarks stayed in `benchmarks/`, which {@link resolveBenchmarksDir} names. This file goes with
 * those migrations at 1.0; whoever prepares 1.0 removes it
 * (changelog/unreleased/2026-11-26-backward-compatibility.md).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { SYSTEM_AGENT_ID } from "./builtin-agents.js";
import { projectDir, systemConfigPath, workbenchDataDir } from "./paths.js";
import { isSystemAgent } from "./system-agent.js";

/** The app id the old Evaluation Center kept its data under, and the Self-Evolution Workbench's workbench id. */
export const BENCHMARK_APP_ID = "benchmark";

/** `<root>/projects/<p>/agents/system_agent/app/data/benchmark`: where the Project's Benchmarks were in 0.2.19 and 0.2.20. */
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
