/**
 * The collect-window signal shared by the two tools that can hand a running call back as a
 * background task (`exec_command`, `run_subagent`).
 */

/**
 * Union of the two channels that end a collect window: an interruption (`signal`) and a
 * per-call detach request (`detachSignal`). Collecting stops on either, but what each MEANS
 * is different — an interruption ends the call, a detach promotes it — so the caller reads
 * the two signals separately once the window is over and decides there.
 */
export function collectUntil(
  signal?: AbortSignal,
  detachSignal?: AbortSignal,
): AbortSignal | undefined {
  if (!signal) return detachSignal;
  if (!detachSignal) return signal;
  return AbortSignal.any([signal, detachSignal]);
}
