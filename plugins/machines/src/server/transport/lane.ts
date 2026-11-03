/**
 * One thing at a time per machine.
 *
 * The rule this directory keeps is structural, not a budget: a machine has one connection
 * for small commands, one forward, and one bulk transfer at a time, and everything else
 * queues behind them. There is no count of how many may be open and no number to tune —
 * a caller cannot open a second one however many times it asks, because the second ask
 * waits for the first. The incident behind it was a machine taken down by hundreds of
 * connections from one controller, each trigger arriving with its own idea of "a few".
 *
 * Keyed by the machine's address, module-level, so every caller in the process shares the
 * same lane whichever App it lives in.
 */
const lanes = new Map<string, Promise<unknown>>();

/** Runs `work` after everything already queued for that machine has finished. */
export function inLane<T>(address: string, work: () => Promise<T>): Promise<T> {
  const next = (lanes.get(address) ?? Promise.resolve()).then(work);
  // The lane must survive a rejection, or one failure would stall every later command.
  lanes.set(
    address,
    next.catch(() => undefined),
  );
  return next;
}
