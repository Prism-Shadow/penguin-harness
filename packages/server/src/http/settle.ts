/**
 * Convergent wait for delete routes (currently used by agents DELETE; sessions DELETE
 * uses the same inline pattern and could later be unified onto this): waits for aborted
 * runs to wind down, up to ms milliseconds; returns whether all of them settled within
 * the window. The timer is unref'd so it never blocks process exit.
 */
export async function settleWithin(promises: Promise<unknown>[], ms: number): Promise<boolean> {
  if (promises.length === 0) return true;
  return Promise.race([
    Promise.allSettled(promises).then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms).unref?.()),
  ]);
}
