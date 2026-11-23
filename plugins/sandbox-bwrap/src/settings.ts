/**
 * What this backend reads of its own settings group, shared by the backend (index.ts) and its
 * page in Settings (status.ts): the group's id, the reader it requires, the bubblewrap this
 * plugin ships for the host, and the settings it derives from the group's stored document.
 */
import { accessSync, constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { Interface } from "@prismshadow/penguin-core/plugin";

/** Default probe budget; a probe that hangs must not hang the first spawn forever. */
export const PROBE_TIMEOUT_MS = 5_000;

/** This backend's own settings, as it reads them from its group. */
export interface BwrapSettings {
  /** The bwrap program: a path or a command on PATH. */
  runner: string;
  /** How long the first check that the runner works may take. */
  probeTimeoutMs: number;
}

/**
 * The bwrap this plugin SHIPS for the host it is running on, or "" when it carries none.
 *
 * A deployment must not depend on the distribution having bubblewrap — most do not install it,
 * and an operator who has to run `apt install bubblewrap` before the sandbox works is an
 * operator whose sandbox is off. The binary lives beside the built module
 * (`vendor/<platform>-<arch>/bin/bwrap`, see scripts/vendor-bwrap.mjs) and finds its own
 * libcap through an `$ORIGIN/../lib` rpath, which is what lets a backend that only rewrites an
 * argv use it: there is no environment to set.
 */
export function vendoredRunner(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  runnable: (p: string) => boolean = executable,
): string {
  const candidate = fileURLToPath(
    new URL(`../vendor/${platform}-${arch}/bin/bwrap`, import.meta.url),
  );
  return runnable(candidate) ? candidate : "";
}

/** Present AND executable: a package installer may drop the exec bit, and then it is not ours to run. */
function executable(target: string): boolean {
  try {
    accessSync(target, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Its group's stored document (defaults merged) as settings; anything unusable falls back. */
export function bwrapSettingsOf(
  doc: Record<string, unknown>,
  vendored: string = vendoredRunner(),
): BwrapSettings {
  const runner = typeof doc.runner === "string" ? doc.runner.trim() : "";
  const seconds = doc.probeTimeoutSeconds;
  return {
    // What a deployment names wins; then the one shipped here; and only then a host's own.
    runner: runner !== "" ? runner : vendored !== "" ? vendored : "bwrap",
    probeTimeoutMs:
      typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
        ? seconds * 1000
        : PROBE_TIMEOUT_MS,
  };
}

/**
 * What this backend requires of plugin configuration: to read the group it declares. The
 * interface is the consumer's own, so the package depends on no harness type.
 */
@Interface()
export abstract class BwrapConfigReader {
  abstract get(name: string): Record<string, unknown>;
}

/** The settings group this backend declares (its contribution id): its page in Settings. */
export const BWRAP_GROUP = "sandbox-bwrap";
