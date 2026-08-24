/**
 * What this server has installed on which machine, remembered across restarts and hot
 * pushes in one JSON file under the data root.
 *
 * Without it, "installed" is a property of the ONE in-memory job: it dies with the process,
 * and installing on a second machine erases the first machine's answer. The record is what
 * makes the picker able to say which hosts already carry this program and which version
 * they got, without an ssh round trip per host at page load — the whole reason the list is
 * config text in the first place.
 *
 * It is a record of what WE did, not a survey of the far side. A machine someone wiped by
 * hand still reads as installed here; the install itself is what corrects that, since it
 * probes the remote before deciding anything (an unchanged version is a no-op, a missing
 * one installs). Treating the file as authoritative about the remote would be a lie, so
 * nothing here does.
 *
 * Pure functions over the file's text; the service owns the I/O.
 */

/** One machine's last successful install, as this server carried it out. */
export interface InstallRecord {
  /** The version that landed — the image version this server sent, or what the remote already had. */
  version: string;
  /** ISO timestamp, so the picker can say "installed" with a date rather than just a flag. */
  at: string;
  /**
   * That machine's own id, once a probe has learned it. Kept here so an identity survives a
   * restart without another ssh round trip; absent for a machine whose server has never
   * started, which is exactly when nothing has minted one.
   */
  machineId?: string;
}

/**
 * Parses the file's text: machine id → record. Damage, a wrong shape, or a missing file all
 * read as "nothing remembered" — this is a convenience over the ssh config, and refusing to
 * serve the machines list because a cache file got corrupted would be the worse failure.
 */
export function parseInstallRecords(raw: string | null): Record<string, InstallRecord> {
  if (raw === null || raw.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, InstallRecord> = {};
    for (const [machineId, value] of Object.entries(parsed)) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
      const entry = value as Record<string, unknown>;
      if (typeof entry.version !== "string" || entry.version === "") continue;
      if (typeof entry.at !== "string" || entry.at === "") continue;
      out[machineId] = {
        version: entry.version,
        at: entry.at,
        ...(typeof entry.machineId === "string" && entry.machineId !== ""
          ? { machineId: entry.machineId }
          : {}),
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** The file's next text after updating one machine's record (null forgets it). */
export function withInstallRecord(
  raw: string | null,
  machineId: string,
  record: InstallRecord | null,
): string {
  const all = parseInstallRecords(raw);
  if (record === null) delete all[machineId];
  else all[machineId] = record;
  return JSON.stringify(all, null, 2) + "\n";
}
