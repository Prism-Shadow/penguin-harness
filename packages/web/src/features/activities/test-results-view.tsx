/**
 * Test results, in the Module section below Quality: Run tests has the chosen agent write and
 * run one check per acceptance criterion against the played activity, and the latest report
 * shows each criterion with passed, failed or skipped, how long it took and why it failed.
 *
 * The run is an ordinary activity run, so the page's history polling follows it and its
 * Session shows its approvals; this view reads the report again once it settles.
 */
import { useEffect, useRef, useState } from "react";
import type { ActivityRun, ActivityRunSummary } from "@prismshadow/penguin-server/api";
import { ApiError, apiFetch } from "../../api/client";
import { Button } from "../../components/ui/button";
import { InfoPopover } from "../../components/ui/info-popover";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneDot, toneInk } from "../../lib/tone";
import {
  TEST_TONE,
  countText,
  latestTestRun,
  overallText,
  readTestState,
  resultRows,
  testBlocked,
  type TestState,
} from "./test-results-model";

const HEAD =
  "border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-400";
const TH = "whitespace-nowrap px-3 py-2 font-medium";
const TD = "px-3 py-2 align-top";

export function TestResultsView({
  endpoint,
  runs,
  editable,
  runner,
  revision,
  unsaved,
  onStarted,
}: {
  /** The activity's API path. */
  endpoint: string;
  runs: ActivityRunSummary[];
  editable: boolean;
  /** Who writes and runs the tests, as the stage routes take it; null when no agent is chosen. */
  runner: Record<string, string> | null;
  /** The draft revision the tests start from. */
  revision: string;
  unsaved: boolean;
  /** A test run has started; the page adds it to the history it polls. */
  onStarted: (run: ActivityRun) => void;
}) {
  const words = S.activities.tests;
  const [state, setState] = useState<TestState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const latest = latestTestRun(runs);
  const running = latest?.status === "running";
  // Read again when the latest test run settles, or another one starts, or the draft changes
  // (its criteria may have).
  const settledKey = latest ? `${latest.runId}:${latest.status}` : "";
  useEffect(() => {
    let cancelled = false;
    apiFetch<unknown>(`${endpoint}/test-report`)
      .then((value) => {
        if (cancelled) return;
        setState(readTestState(value));
        setLoadError(null);
      })
      .catch((cause) => {
        if (!cancelled) setLoadError(apiErrorText(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint, settledKey, revision]);

  const criteria = state?.criteria ?? 0;
  const blocked = testBlocked({
    editable,
    hasAgent: runner !== null,
    unsaved,
    browserInstalled: state?.browserInstalled ?? true,
    criteria,
    runs,
    starting,
  });

  async function start() {
    if (!runner) return;
    setStarting(true);
    setStartError(null);
    try {
      const run = await apiFetch<ActivityRun>(`${endpoint}/test`, {
        method: "POST",
        body: { ...runner, expectedRevision: revision },
      });
      if (alive.current) onStarted(run);
    } catch (cause) {
      if (!alive.current) return;
      if (cause instanceof ApiError && cause.code === "test_browser_missing")
        setState((current) => ({
          report: current?.report ?? null,
          runId: current?.runId ?? null,
          criteria: current?.criteria ?? 0,
          stale: current?.stale ?? false,
          browserInstalled: false,
        }));
      else setStartError(apiErrorText(cause));
    } finally {
      if (alive.current) setStarting(false);
    }
  }

  const report = state?.report ?? null;
  const rows = report ? resultRows(report) : [];
  const count = report ? countText(report) : null;
  const lastFailed =
    latest && !running && latest.status !== "succeeded" && latest.runId !== state?.runId
      ? latest
      : null;
  const hint =
    blocked === "agent"
      ? words.noAgent
      : blocked === "unsaved"
        ? words.saveFirst
        : blocked === "browser"
          ? words.browserMissing
          : null;
  return (
    <section className="space-y-3" aria-labelledby="activity-tests-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="activity-tests-title" className="flex items-center gap-2 text-sm font-semibold">
          {words.title}
          <InfoPopover label={words.title}>
            <p>{words.about}</p>
          </InfoPopover>
        </h3>
        {editable && (
          <Button size="sm" disabled={blocked !== null} onClick={() => void start()}>
            {words.run}
          </Button>
        )}
      </div>
      {editable && hint && (
        <p className={`text-xs ${blocked === "browser" ? toneInk.attention : "text-gray-500"}`}>
          {hint}
        </p>
      )}
      {state && criteria === 0 && <p className="text-xs text-gray-500">{words.noCriteria}</p>}
      {running && (
        <p role="status" className="text-xs text-gray-500">
          {words.running}
        </p>
      )}
      {startError && (
        <p role="alert" className={`text-xs ${toneInk.danger}`}>
          {startError}
        </p>
      )}
      {lastFailed && (
        <p className={`text-xs ${toneInk.danger}`}>
          {words.lastFailed(lastFailed.error ?? S.activities.status[lastFailed.status])}
        </p>
      )}
      {loadError ? (
        <p role="alert" className={`text-xs ${toneInk.danger}`}>
          {words.loadFailed} {loadError}
        </p>
      ) : !report ? (
        <p className="text-xs text-gray-500">{words.notRun}</p>
      ) : (
        <>
          {state?.stale && (
            <p className={`text-xs ${toneInk.attention}`} data-testid="tests-stale">
              {words.stale}
            </p>
          )}
          <p
            className={`text-sm ${toneInk[TEST_TONE[report.overallStatus]]}`}
            data-testid="tests-status"
          >
            {overallText(report)}
            {count && <span className="text-gray-500 dark:text-gray-400"> · {count}</span>}
          </p>
          <p className="text-xs text-gray-500">
            {words.lastRun(new Date(report.checkedAt).toLocaleString())}
            {report.reused && ` · ${words.reused}`}
          </p>
          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
              <table className="w-full text-sm" aria-label={words.resultsLabel}>
                <thead>
                  <tr className={HEAD}>
                    <th className={TH}>{words.columns.criterion}</th>
                    <th className={TH}>{words.columns.test}</th>
                    <th className={TH}>{words.columns.status}</th>
                    <th className={TH}>{words.columns.duration}</th>
                    <th className={TH}>{words.columns.error}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <td className={`${TD} break-words`}>{row.criterion}</td>
                      <td className={`${TD} break-words text-xs`}>{row.testName}</td>
                      <td className={`${TD} whitespace-nowrap`}>
                        <span className="flex items-center gap-1.5">
                          <span
                            aria-hidden="true"
                            className={`size-1.5 shrink-0 rounded-full ${toneDot[TEST_TONE[row.status]]}`}
                          />
                          {row.statusText}
                        </span>
                      </td>
                      <td className={`${TD} whitespace-nowrap text-xs`}>{row.duration}</td>
                      <td className={`${TD} break-words text-xs`}>{row.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
