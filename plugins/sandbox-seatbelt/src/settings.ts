/**
 * What this backend reads of its own settings group, shared by the backend (index.ts) and its
 * page in Settings (status.ts): the group's id, the reader it requires, the program macOS ships,
 * and the settings it derives from the group's stored document.
 */
import { existsSync } from "node:fs";
import { Interface } from "@prismshadow/penguin-core/plugin";

/** This backend's own settings, as it reads them from its group. */
export interface SeatbeltSettings {
  /** The sandbox-exec program: a path or a command on PATH. */
  runner: string;
}

/**
 * Where macOS keeps the program this backend runs.
 *
 * Unlike the Linux backend, which ships its own bubblewrap, there is nothing to vendor here:
 * `sandbox-exec` is part of macOS, lives at a fixed path on every install, and is Apple's to
 * distribute, not ours. What the shipped binary bought there — never depending on the host's
 * setup — this buys by naming the absolute path instead of a bare command: a PATH that lacks
 * `/usr/bin`, or that puts something else called `sandbox-exec` earlier, no longer decides what
 * confines a command. A host missing it is caught by the probe at load, with the reason.
 */
export const SYSTEM_RUNNER = "/usr/bin/sandbox-exec";

/** The program to run when the settings name none: the OS's own, else a PATH lookup. */
export function defaultRunner(exists: (p: string) => boolean = existsSync): string {
  return exists(SYSTEM_RUNNER) ? SYSTEM_RUNNER : "sandbox-exec";
}

/** Its group's stored document as settings; an empty runner falls back to the OS's own. */
export function seatbeltSettingsOf(
  doc: Record<string, unknown>,
  fallback: string = defaultRunner(),
): SeatbeltSettings {
  const runner = typeof doc.runner === "string" ? doc.runner.trim() : "";
  return { runner: runner !== "" ? runner : fallback };
}

/**
 * What this backend requires of plugin configuration: to read the group it declares. The
 * interface is the consumer's own, so the package depends on no harness type.
 */
@Interface()
export abstract class SeatbeltConfigReader {
  abstract get(name: string): Record<string, unknown>;
}

/** The settings group this backend declares (its contribution id): its page in Settings. */
export const SEATBELT_GROUP = "sandbox-seatbelt";
