/**
 * Deploy runs of an organization that is being deleted (DeployService.retire): a script still
 * running there works in the organization's shared workspace, which on Windows keeps the
 * directory from moving to the trash. Each is stopped — SIGTERM, then SIGKILL after the grace —
 * and awaited; its outcome is recorded by its own exit listener, as for any killed run. The
 * organization's runs are then forgotten; other organizations' runs are left alone.
 */
import type { ProposalDeployRun } from "@prismshadow/penguin-server/api";
import type { DeployProcess } from "./deploy-process.js";

/** What retiring needs of a live run. */
export interface RetiringRun {
  run: Pick<ProposalDeployRun, "id" | "status">;
  orgKey: string;
  proc: Pick<DeployProcess, "kill">;
  /** Settles once the script has exited. */
  ended: Promise<void>;
}

export async function retireRuns(
  runs: Map<string, RetiringRun>,
  orgKey: string,
  graceMs: number,
): Promise<void> {
  const mine = [...runs.values()].filter((r) => r.orgKey === orgKey);
  const running = mine.filter((r) => r.run.status === "running");
  for (const r of running) {
    r.proc.kill("SIGTERM");
    setTimeout(() => r.proc.kill("SIGKILL"), graceMs).unref();
  }
  await Promise.all(running.map((r) => r.ended));
  for (const r of mine) runs.delete(r.run.id);
}
