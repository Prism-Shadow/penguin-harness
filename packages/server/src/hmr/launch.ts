/**
 * Starting the runtime that is CURRENT for a data root, rather than the one on disk.
 *
 * The platform ships by push and takes effect in seconds. The runtime — this server — could
 * not, because a process does not swap out the code it is executing, so a machine's runtime
 * only ever advanced by reinstalling the program. That made the two halves of one build
 * travel by different roads: the platform over HTTP to anywhere, the runtime only as a
 * published release a remote could download. A machine whose release was older than the
 * pushed platform then sat refusing it, with no path forward that a push could take.
 *
 * So the runtime is pushed too, and adopted the only way it can be: at the NEXT START. This
 * is that start. The packaged entry asks here first; when the store names a runtime that is
 * not this file, the pushed one is imported and becomes the process, and the packaged code
 * below it never runs.
 *
 * The same shape `penguin-hmr` already uses for the CLI (packages/cli/src/penguin-hmr.ts) —
 * a thin entry that resolves the pushed bundle and hands over. The difference is what a
 * failure costs: a CLI that cannot load its bundle can say so and exit, while a server that
 * cannot start is a machine with nothing serving. So every failure here — a missing file, a
 * malformed manifest, a bundle that throws on import — falls back to the packaged runtime
 * and says why. A push must never be able to take a server off the air.
 */
import { pathToFileURL } from "node:url";
import { resolveRuntimeBundlePath } from "./manifest.js";

/**
 * Set on the pushed runtime's own process so it does not look for a runtime to hand over
 * to. Without it the bundle — which contains this same launcher — would resolve itself and
 * import forever.
 */
const HANDED_OVER = "PENGUIN_RUNTIME_HANDED_OVER";

/**
 * Hands over to the pushed runtime, or answers false for the caller to start the packaged
 * one. Never throws: every way this can fail is a reason to run what is already here.
 *
 * `warn` rather than a thrown error even for a bundle that fails to import: the packaged
 * runtime is a working server, and starting it is strictly better than not starting one —
 * the operator is told, and the next push can replace the bundle that failed.
 */
export async function handOverToPushedRuntime(
  root: string,
  warn: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): Promise<boolean> {
  if (process.env[HANDED_OVER] === "1") return false;
  let bundlePath: string | null;
  try {
    bundlePath = await resolveRuntimeBundlePath(root);
  } catch {
    return false; // An unreadable root is the packaged runtime's problem to report, not ours.
  }
  if (bundlePath === null) return false;
  process.env[HANDED_OVER] = "1";
  try {
    // Cache-busted like the CLI's: a re-push writes a new content-addressed file, but a
    // rollback can reuse a path this process already imported.
    await import(`${pathToFileURL(bundlePath).href}?v=${Date.now()}`);
    return true;
  } catch (err) {
    warn(
      `[hmr] the pushed runtime failed to start, using the packaged one: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    delete process.env[HANDED_OVER];
    return false;
  }
}

/** The pointer this process started from, for reporting whether a push is still pending. */
export async function bootedRuntimePointer(root: string): Promise<string | null> {
  if (process.env[HANDED_OVER] !== "1") return null;
  try {
    return await resolveRuntimeBundlePath(root);
  } catch {
    return null;
  }
}
