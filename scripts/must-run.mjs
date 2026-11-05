/**
 * PENGUIN_MUST_RUN: a comma-separated list of the host-dependent suites, named by their
 * directory under plugins/, that a run requires to really run (CI sets it per platform). A
 * named suite this host cannot open fails with the reason; an unnamed one skips as before, and
 * so does a misspelled name. Spaces around a name are ignored.
 */

/** True when the suite can run here; throws when PENGUIN_MUST_RUN names it and it cannot. */
export function mustRun(suite, cannotOpen) {
  const required = (process.env.PENGUIN_MUST_RUN ?? "").split(",").map((name) => name.trim());
  if (cannotOpen !== null && required.includes(suite)) {
    throw new Error(
      `PENGUIN_MUST_RUN requires ${suite}, and this host cannot open it: ${cannotOpen}`,
    );
  }
  return cannotOpen === null;
}
