/**
 * PENGUIN_MUST_RUN: a comma-separated list of the host-dependent suites, named by their
 * directory under plugins/, that a run requires to really run (CI sets it per platform). A
 * named suite this host cannot open fails with the reason; an unnamed one skips as before, and
 * so does a misspelled name.
 */

/** True when the suite can run here; throws when PENGUIN_MUST_RUN names it and it cannot. */
export function mustRun(suite, cannotOpen) {
  if (cannotOpen !== null && (process.env.PENGUIN_MUST_RUN ?? "").split(",").includes(suite)) {
    throw new Error(
      `PENGUIN_MUST_RUN requires ${suite}, and this host cannot open it: ${cannotOpen}`,
    );
  }
  return cannotOpen === null;
}
