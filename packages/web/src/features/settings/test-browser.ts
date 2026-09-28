/**
 * What the Test browser page shows for a status from the server: one status line and its
 * tone, the failure of the last install and its output, and whether the Install button may
 * be pressed. Pure, so web vitest can pin it without a DOM.
 */
import type { TestBrowserStatus } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import type { Tone } from "../../lib/tone";

/** How often the page asks again while an install runs. */
export const TEST_BROWSER_POLL_MS = 2000;

export interface TestBrowserView {
  tone: Tone;
  /** The state, in words: colour never carries it alone. */
  line: string;
  /** Why the last install failed, in words; null when it did not. */
  failure: string | null;
  /** The end of the failed install's output; null when there is none to show. */
  log: string | null;
  /** Whether the Install button is enabled. */
  canInstall: boolean;
}

export function testBrowserView(status: TestBrowserStatus): TestBrowserView {
  const strings = S.settings.testBrowser;
  // This copy of Penguin cannot install or run it (the desktop app): say so, offer nothing.
  if (!status.available) {
    return {
      tone: "muted",
      line: strings.unavailable,
      failure: null,
      log: null,
      canInstall: false,
    };
  }
  const failure =
    status.installing || status.error === null
      ? null
      : strings.failed(strings.reasons[status.error]);
  const line = status.installing
    ? strings.installing
    : status.installed
      ? strings.installed(status.version)
      : strings.missing;
  const tone: Tone = status.installing ? "busy" : status.installed ? "success" : "attention";
  const log = failure !== null && status.log ? status.log : null;
  return { tone, line, failure, log, canInstall: !status.installing };
}

/** Whether the page should keep asking: only while an install is running. */
export function shouldPollTestBrowser(status: TestBrowserStatus | null): boolean {
  return status?.installing === true;
}
