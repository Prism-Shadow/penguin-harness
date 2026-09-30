/**
 * How often the Machines page re-probes the servers it installed.
 *
 * Each probe is an ssh round trip per installed machine, so the interval widens as the
 * answers stop changing: 15s, 30s, 45s, then a minute, two, three… up to ten. Something
 * that just moved is worth watching closely; a fleet that has read the same for an hour is
 * not worth an ssh child a minute.
 *
 * Any CHANGE resets it to the first step — a server that just went down, or an install that
 * just finished, is the moment the next few answers matter most. The schedule lives here,
 * on the page, rather than on the server: a timer over there would keep spawning ssh long
 * after the last person closed the tab.
 */

/** The widening steps, in milliseconds. The last one repeats forever. */
export const PROBE_STEPS_MS = [
  15_000, 30_000, 45_000, 60_000, 120_000, 180_000, 240_000, 300_000, 360_000, 420_000, 480_000,
  540_000, 600_000,
] as const;

/** The wait before the probe after `settledRounds` consecutive rounds that changed nothing. */
export function probeDelayMs(settledRounds: number): number {
  const index = Math.min(Math.max(settledRounds, 0), PROBE_STEPS_MS.length - 1);
  return PROBE_STEPS_MS[index]!;
}

/**
 * A fingerprint of everything a probe could have changed, compared between rounds to decide
 * whether the schedule widens or resets.
 *
 * `checkedAt` is deliberately NOT part of it: every probe moves that, so including it would
 * make every round look like a change and pin the interval at 15 seconds forever — which is
 * exactly the bug this function exists to avoid. What counts is the state, the port it
 * reports, and which machines are installed at all.
 */
export function probeFingerprint(
  machines: ReadonlyArray<{
    id: string;
    installed: { version: string } | null;
    status: { state: string; port?: number } | null;
  }>,
): string {
  return machines
    .map((machine) => {
      const status = machine.status;
      const state = status === null ? "-" : `${status.state}:${status.port ?? ""}`;
      return `${machine.id}=${machine.installed?.version ?? "-"}/${state}`;
    })
    .join("|");
}
