/**
 * Test browser (admin only, server-global): whether the Chromium that quality checks and
 * tests open an activity's player in is installed on this server, and a button that installs
 * it. The install runs on the server and takes minutes, so the page asks again every couple
 * of seconds while it runs, and says so in words. A failed install names why and shows the
 * end of the installer's own output, which is where the reason is.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { TestBrowserStatus } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { toneInk } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { SectionShell } from "./section-shell";
import { TEST_BROWSER_POLL_MS, shouldPollTestBrowser, testBrowserView } from "./test-browser";

export function TestBrowserSection() {
  const [status, setStatus] = useState<TestBrowserStatus | null>(null);
  const [starting, setStarting] = useState(false);
  /** Whether this page started or watched an install, so its end is announced once. */
  const watching = useRef(false);
  /**
   * Failed reads in a row. A failed read leaves `status` as it was, so it also bumps `retry`
   * to keep an install's polling going; only the first failure of a run is toasted.
   */
  const failures = useRef(0);
  const [retry, setRetry] = useState(0);

  const load = useCallback(async () => {
    try {
      const next = (await api.adminGetTestBrowser()).browser;
      if (watching.current && !next.installing) {
        watching.current = false;
        if (next.installed && next.error === null)
          toastSuccess(S.settings.testBrowser.installed(next.version));
      }
      failures.current = 0;
      setStatus(next);
    } catch (e) {
      if (failures.current === 0) toastError(apiErrorText(e));
      failures.current += 1;
      setRetry((n) => n + 1);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!shouldPollTestBrowser(status)) return;
    watching.current = true;
    const timer = window.setTimeout(() => void load(), TEST_BROWSER_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [status, retry, load]);

  const install = async () => {
    setStarting(true);
    try {
      setStatus((await api.adminInstallTestBrowser()).browser);
    } catch (e) {
      // Someone else's install is already running: show it rather than an error.
      if (e instanceof ApiError && e.status === 409) await load();
      else toastError(apiErrorText(e));
    } finally {
      setStarting(false);
    }
  };

  const strings = S.settings.testBrowser;
  const view = status === null ? null : testBrowserView(status);
  return (
    <SectionShell
      actions={
        <Button
          size="sm"
          variant="primary"
          disabled={view === null || !view.canInstall || starting}
          onClick={() => void install()}
        >
          {strings.install}
        </Button>
      }
    >
      <div aria-live="polite">
        {view !== null && (
          <p
            className={`text-sm font-medium ${toneInk[view.tone]}`}
            data-testid="test-browser-status"
          >
            {view.line}
          </p>
        )}
        {status?.available && (
          <p className="mt-1 break-all text-xs text-gray-500 dark:text-gray-400">
            {strings.location(status.path)}
          </p>
        )}
        {view?.failure && <p className={`mt-3 text-sm ${toneInk.danger}`}>{view.failure}</p>}
      </div>
      {view?.log && (
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{strings.logLabel}</p>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border border-gray-200 bg-gray-50 p-2 font-mono text-xs dark:border-gray-800 dark:bg-gray-900/60">
            {view.log}
          </pre>
        </div>
      )}
    </SectionShell>
  );
}
