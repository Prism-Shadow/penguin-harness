/**
 * What the App sees of the test browser: the Chromium Penguin owns for quality checks and
 * tests, and the admin install that fetches it. Type-only, so the web can import it.
 *
 * The server words none of it: a failed install is a code, and the tail of the installer's
 * own output, for the App to show as it is.
 */

/** Why the last install did not leave a browser behind. */
export type TestBrowserInstallError =
  /** The installer exited with an error. */
  | "failed"
  /** The installer ran past its time limit and was stopped. */
  | "timed_out"
  /** The installer could not be started at all. */
  | "not_started"
  /** The installer reported success, yet the browser is not where it should be. */
  | "incomplete";

export interface TestBrowserStatus {
  /**
   * Whether this copy of Penguin can install and drive the test browser at all. False where
   * Playwright is not shipped (the desktop app); the page then offers no install.
   */
  available: boolean;
  /** Whether the browser's executable is on disk. */
  installed: boolean;
  /** The Chromium version this server's Playwright drives, e.g. "149.0.7827.55". */
  version: string | null;
  /** The directory the browser lives in (or will, once installed). */
  path: string;
  /** Whether an install is running now. */
  installing: boolean;
  /** Why the last install failed; null when it succeeded or none has run. */
  error: TestBrowserInstallError | null;
  /** The end of the last failed install's output; null otherwise. */
  log: string | null;
}

export interface TestBrowserStatusResponse {
  browser: TestBrowserStatus;
}
