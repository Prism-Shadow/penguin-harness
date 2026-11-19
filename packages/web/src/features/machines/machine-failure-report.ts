/**
 * What a machine's failure puts in its problem report (lib/failure.tsx's told failures): a failed
 * job, a reconnecting streak's last failure, a config sync that did not go through.
 *
 * A report carries as much as it can: the step, the kind of job, the reason ssh's words were read
 * as (`sshReason`), the failure's own words and the job log's last lines. Those words name the
 * person's machines by design — the address ssh tried, the account, the key it loaded — so they
 * are masked on their way in: host names, IP addresses and `user@host` (`mask.hosts`), and the
 * machine's own alias, host name, account and key file, which the page knows (`mask.values`).
 */
import type { ReportMask, ToldFailure } from "@prismshadow/penguin-ui";
import type { MachineInfo, MachineJob, SshHostResponse } from "@prismshadow/penguin-server/api";

/** How many of the job log's last lines a report carries. */
const LOG_LINES = 40;

/** The masking for a machine's words: hosts, and the names the page knows for this machine. */
function machineMask(alias: string, host: SshHostResponse | null | undefined): ReportMask {
  const known = [alias, host?.hostName, host?.user, host?.identityFile];
  return {
    hosts: true,
    values: known.filter((value): value is string => value !== undefined && value !== ""),
  };
}

/** A finished job that did not go through: where it stopped and why, as a report says it. */
export function machineJobFailure(
  job: MachineJob,
  host?: SshHostResponse | null,
): ToldFailure | null {
  const result = job.result;
  if (job.queued || job.running || result === null || result.ok) return null;
  const log = job.log.slice(-LOG_LINES).join("\n");
  return {
    what: "a machine job failed",
    ...(result.sshReason !== undefined ? { code: result.sshReason } : {}),
    facts: [
      ["Job", job.kind],
      ["Step", result.step],
    ],
    detail: log === "" ? result.message : `${result.message}\n\nJob log (last lines):\n${log}`,
    mask: machineMask(job.alias, host),
  };
}

/** The reconnecting streak's last failure; null before one. */
export function machineReconnectFailure(
  machine: MachineInfo,
  host?: SshHostResponse | null,
): ToldFailure | null {
  const streak = machine.reconnect;
  if (streak === undefined || streak.lastError === null) return null;
  return {
    what: "a machine could not be reconnected",
    ...(streak.sshReason !== undefined ? { code: streak.sshReason } : {}),
    detail: streak.lastError,
    mask: machineMask(machine.alias, host),
  };
}

/** The last config sync, when it did not go through. */
export function machineConfigSyncFailure(
  machine: MachineInfo,
  host?: SshHostResponse | null,
): ToldFailure | null {
  const sync = machine.configSync;
  if (sync === undefined || sync.ok) return null;
  return {
    what: "a machine's config sync failed",
    detail: sync.detail ?? null,
    mask: machineMask(machine.alias, host),
  };
}
