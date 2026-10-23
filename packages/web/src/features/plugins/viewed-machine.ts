/**
 * Which machine the Plugins page views: the one picked in its header while the picker still
 * offers it, this server otherwise. A machine out of reach stays among the choices (as last
 * seen), so a pick holds through a reconnect; a picked machine leaves them only when the
 * Project stops naming it (removed from the machine list and from every table) — and with no
 * other machine left the picker is gone, so a pick that outlived its machine would hold the
 * page on it with no way back. Derived on every render rather than reset in an effect, so it
 * never renders the stale pick.
 */
export function viewedMachine(
  picked: string | null,
  choices: readonly string[],
  selfId: string | undefined,
): string | undefined {
  return picked !== null && choices.includes(picked) ? picked : selfId;
}

/** A read or confirmation belongs to both a Project and a machine, not just a picker value. */
export function samePluginTarget(
  target: { projectId: string; machineId: string },
  current: { projectId: string | null; machineId: string | undefined },
): boolean {
  return target.projectId === current.projectId && target.machineId === current.machineId;
}
