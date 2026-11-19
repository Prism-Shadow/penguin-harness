/**
 * What a machine's failure puts in its problem report (lib/failure.tsx's told failures): a failed
 * job, a reconnecting streak's last failure, a config sync that did not go through.
 *
 * ssh's own words never go in. By design they carry the address it tried, the account and the
 * key it loaded, and the job's log and the sync's detail say the same of the person's machines;
 * the dialog shows them on screen, and the report names only the step, the kind of job and the
 * reason ssh's words were read as (`sshReason`), with a line saying the words were left out.
 */
import type { ToldFailure } from "@prismshadow/penguin-ui";
import type { MachineInfo, MachineJob } from "@prismshadow/penguin-server/api";

/** A finished job that did not go through: where it stopped and why, as a report says it. */
export function machineJobFailure(job: MachineJob): ToldFailure | null {
  const result = job.result;
  if (job.queued || job.running || result === null || result.ok) return null;
  return {
    what: "a machine job failed",
    ...(result.sshReason !== undefined ? { code: result.sshReason } : {}),
    facts: [
      ["Job", job.kind],
      ["Step", result.step],
    ],
  };
}

/** The reconnecting streak's last failure; null before one. */
export function machineReconnectFailure(machine: MachineInfo): ToldFailure | null {
  const streak = machine.reconnect;
  if (streak === undefined || streak.lastError === null) return null;
  return {
    what: "a machine could not be reconnected",
    ...(streak.sshReason !== undefined ? { code: streak.sshReason } : {}),
  };
}

/** The last config sync, when it did not go through. */
export function machineConfigSyncFailure(machine: MachineInfo): ToldFailure | null {
  if (machine.configSync === undefined || machine.configSync.ok) return null;
  return { what: "a machine's config sync failed" };
}
