/**
 * Removing a test directory that a child process has not finished letting go of.
 *
 * Windows keeps a directory locked while any live process has it open — as a working
 * directory, or as the image of a script it is still running — and answers `rmdir` with
 * EBUSY, EPERM or ENOTEMPTY until that process finishes exiting. Tests that spawn a child
 * and then tear down its directory therefore race the operating system rather than their
 * own code: the assertions have all passed by the time the teardown fails, and the failure
 * lands on whichever test happened to be last. POSIX unlinks a busy directory's entries
 * without complaint, so the race is invisible on Linux and macOS and shows up only in CI.
 *
 * Retrying to a deadline is the fix rather than ignoring the error: a directory that is
 * genuinely stuck — a process that never exits, a handle nothing releases — still fails,
 * one deadline later, with the original error rather than a swallowed one.
 */
import { rm } from "node:fs/promises";

/** Removes `dir`, retrying while Windows still holds it, then failing with the real error. */
export async function rmEventually(dir: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const transient = code === "EBUSY" || code === "ENOTEMPTY" || code === "EPERM";
      if (!transient || Date.now() > deadline) throw err;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}
