/**
 * Display names for the settings tabs a kernel update reports in `advanced` / `kept`: a known
 * tab key renders as that tab's own label, and an unknown key (a tab a newer server manages
 * and this build does not know) falls back to the raw key — never hidden, never crashing.
 *
 * Built per call rather than at module scope: `S` is swapped on a language change.
 */
import { S } from "../../lib/strings";

export function kernelTabLabel(tab: string): string {
  const labels: Record<string, string> = {
    prompt: S.agent.tabPrompt,
    runtime: S.agent.tabRuntime,
    tools: S.agent.tabTools,
    skills: S.agent.tabSkills,
    memory: S.agent.tabMemory,
    vault: S.agent.tabVault,
    schedules: S.agent.tabSchedules,
  };
  return labels[tab] ?? tab;
}
