/**
 * The employee machine picker (pure, unit tested): which machines an employee can be
 * pinned to. Single-machine builds run every employee here, so the only enabled option
 * is this server (value "", stored as absent); connected remotes list disabled with a
 * reason, so the picker stays correct the day a second machine appears — the option
 * set is data, not a fork in the dialog. Entries without a stable id (a server that
 * never started there) are not offered at all: there is nothing to pin to.
 */
export interface MachinePick {
  /** The value to store: "" for this server, else the machine's stable id. */
  value: string;
  /** What the row shows beside the label strings. */
  alias: string;
  disabled: boolean;
}

export function machineOptions(
  machines: ReadonlyArray<{ alias: string; local: boolean; machineId: string | null }>,
): MachinePick[] {
  const local = machines.find((m) => m.local);
  const out: MachinePick[] = [{ value: "", alias: local?.alias ?? "local", disabled: false }];
  for (const m of machines) {
    if (m.local) continue;
    if (m.machineId === null) continue;
    out.push({ value: m.machineId, alias: m.alias, disabled: true });
  }
  return out;
}

/** Whether the picked value differs from the stored pin (absent, "" and "local" all mean here). */
export function machineDirty(stored: string | undefined, picked: string): boolean {
  const norm = (v: string | undefined): string | null =>
    v === undefined || v === "" || v === "local" ? null : v;
  return norm(stored) !== norm(picked === "" ? undefined : picked);
}
