/**
 * The oldest Node the server and the CLI run on, checked where each process starts.
 *
 * `engines` in package.json is advice npm prints and moves past, and two ways of running
 * PenguinHarness take whatever Node the machine has: the npm-installed CLI, and a source
 * checkout's `pnpm dev`. Below the floor the program does not fail cleanly — Node 22, for
 * one, starts the server and then rejects syntax the factory command-policy rules relied on —
 * so the entry refuses up front and names both versions. The desktop app runs its server on
 * Electron's own Node, and the release packages carry theirs; both are above the floor.
 */

/** The floor, as `major.minor.patch`. */
export const NODE_FLOOR = "24.0.0";

/** A version's three numbers; null when it does not start with them. */
function versionParts(version: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Whether `version` — `process.version`'s shape, with or without the leading "v", a
 * pre-release tail allowed — is at or above `floor`. A version that cannot be read passes:
 * the check exists to name a known-old runtime, not to turn away an unfamiliar one.
 */
export function meetsNodeFloor(version: string, floor: string = NODE_FLOOR): boolean {
  const have = versionParts(version);
  const need = versionParts(floor);
  if (have === null || need === null) return true;
  for (let i = 0; i < 3; i++) {
    if (have[i] !== need[i]) return have[i]! > need[i]!;
  }
  return true;
}

/** What an entry prints before it exits on a runtime below the floor; null when it may run. */
export function nodeFloorRefusal(version: string = process.version): string | null {
  if (meetsNodeFloor(version)) return null;
  const floor = NODE_FLOOR.replace(/(\.0)+$/, "");
  return `PenguinHarness needs Node ${floor} or newer; this is ${version}.`;
}
