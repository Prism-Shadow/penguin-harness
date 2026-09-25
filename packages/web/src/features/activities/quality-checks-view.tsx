/**
 * Quality, below Build in the Module section: Check quality opens every scene of the played
 * activity in the test browser, and the two results — Easy for everyone to use, and Right
 * reading level — show their status, what they found and where, and when they last ran.
 *
 * The run is an ordinary activity run, so the page's history polling follows it; this view
 * reads the reports again once it settles.
 */
import { useEffect, useRef, useState } from "react";
import type {
  ActivityRun,
  ActivityRunSummary,
  QualityReport,
} from "@prismshadow/penguin-server/api";
import { ApiError, apiFetch } from "../../api/client";
import { Button } from "../../components/ui/button";
import { InfoPopover } from "../../components/ui/info-popover";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import {
  STATUS_TONE,
  checkBlocked,
  findingRows,
  latestQualityRun,
  readQualityState,
  statusText,
  type QualityState,
} from "./quality-model";

const HEAD =
  "border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-400";
const TH = "whitespace-nowrap px-3 py-2 font-medium";
const TD = "px-3 py-2 align-top";

function ReportBlock({
  id,
  title,
  about,
  report,
  extra,
}: {
  id: string;
  title: string;
  about: string;
  report: QualityReport | null;
  extra?: string | null;
}) {
  const words = S.activities.quality;
  const rows = report ? findingRows(report) : [];
  return (
    <section className="space-y-2" aria-labelledby={id}>
      <h4 id={id} className="flex items-center gap-2 text-xs font-semibold">
        {title}
        <InfoPopover label={title}>
          <p>{about}</p>
        </InfoPopover>
      </h4>
      {!report ? (
        <p className="text-xs text-gray-500">{words.notChecked}</p>
      ) : (
        <>
          <p
            className={`text-sm ${toneInk[STATUS_TONE[report.status]]}`}
            data-testid={`${id}-status`}
          >
            {statusText(report)}
          </p>
          {extra && <p className="text-xs text-gray-500">{extra}</p>}
          {report.status !== "skipped" &&
            (rows.length ? (
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
                <table className="w-full text-sm" aria-label={words.findingsLabel(title)}>
                  <thead>
                    <tr className={HEAD}>
                      <th className={TH}>{words.columns.severity}</th>
                      <th className={TH}>{words.columns.rule}</th>
                      <th className={TH}>{words.columns.where}</th>
                      <th className={TH}>{words.columns.detail}</th>
                      <th className={TH}>
                        <span className="sr-only">{words.columns.link}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td className={`${TD} whitespace-nowrap font-medium`}>{row.severity}</td>
                        <td className={`${TD} break-words`}>
                          <span className="font-mono text-xs">{row.rule}</span>
                          {row.subject && <span className="block break-words">{row.subject}</span>}
                        </td>
                        <td className={`${TD} break-all text-xs`}>{row.where}</td>
                        <td className={`${TD} break-words text-xs`}>
                          {row.detail}
                          {row.waived && (
                            <span className="block text-gray-500 dark:text-gray-400">
                              {row.waived}
                            </span>
                          )}
                        </td>
                        <td className={`${TD} whitespace-nowrap text-xs`}>
                          {row.helpUrl && (
                            <a
                              href={row.helpUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={words.learnMoreAbout(row.rule)}
                              className="text-brand-600 hover:text-brand-700 dark:text-brand-300"
                            >
                              {words.learnMore}
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-gray-500">{words.noFindings}</p>
            ))}
        </>
      )}
    </section>
  );
}

export function QualityChecksView({
  endpoint,
  runs,
  editable,
  onStarted,
}: {
  /** The activity's API path. */
  endpoint: string;
  runs: ActivityRunSummary[];
  editable: boolean;
  /** A quality run has started; the page adds it to the history it polls. */
  onStarted: (run: ActivityRun) => void;
}) {
  const words = S.activities.quality;
  const [state, setState] = useState<QualityState | null>(null);
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
  const latest = latestQualityRun(runs);
  const running = latest?.status === "running";
  // Read again when the latest quality run settles, or another one starts.
  const settledKey = latest ? `${latest.runId}:${latest.status}` : "";
  useEffect(() => {
    let cancelled = false;
    apiFetch<unknown>(`${endpoint}/quality`)
      .then((value) => {
        if (cancelled) return;
        setState(readQualityState(value));
        setLoadError(null);
      })
      .catch((cause) => {
        if (!cancelled) setLoadError(apiErrorText(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint, settledKey]);

  const blocked = checkBlocked({
    editable,
    browserInstalled: state?.browserInstalled ?? true,
    runs,
    starting,
  });

  async function start() {
    setStarting(true);
    setStartError(null);
    try {
      const run = await apiFetch<ActivityRun>(`${endpoint}/quality`, { method: "POST" });
      if (alive.current) onStarted(run);
    } catch (cause) {
      if (!alive.current) return;
      if (cause instanceof ApiError && cause.code === "test_browser_missing")
        setState((current) => ({ quality: current?.quality ?? null, browserInstalled: false }));
      else setStartError(apiErrorText(cause));
    } finally {
      if (alive.current) setStarting(false);
    }
  }

  const quality = state?.quality ?? null;
  const readability = quality?.readability ?? null;
  const lastFailed =
    latest && !running && latest.status !== "succeeded" && latest.runId !== quality?.runId
      ? latest
      : null;
  return (
    <section className="space-y-4" aria-labelledby="activity-quality-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="activity-quality-title" className="flex items-center gap-2 text-sm font-semibold">
          {words.title}
          <InfoPopover label={words.title}>
            <p>{words.about}</p>
          </InfoPopover>
        </h3>
        {editable && (
          <Button size="sm" disabled={blocked !== null} onClick={() => void start()}>
            {words.check}
          </Button>
        )}
      </div>
      {editable && state && !state.browserInstalled && (
        <p className={`text-xs ${toneInk.attention}`}>{words.browserMissing}</p>
      )}
      {running && (
        <p role="status" className="text-xs text-gray-500">
          {words.checking}
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
      ) : (
        <>
          <p className="text-xs text-gray-500">
            {quality
              ? words.lastChecked(new Date(quality.accessibility.checkedAt).toLocaleString())
              : words.notChecked}
          </p>
          <ReportBlock
            id="quality-accessibility"
            title={words.accessibility.title}
            about={words.accessibility.about}
            report={quality?.accessibility ?? null}
          />
          <ReportBlock
            id="quality-readability"
            title={words.readability.title}
            about={words.readability.about}
            report={readability}
            extra={
              readability && readability.status !== "skipped"
                ? [
                    readability.gradeBand
                      ? words.readability.gradeBand(readability.gradeBand)
                      : null,
                    readability.readingGrade !== undefined
                      ? words.readability.readingGrade(readability.readingGrade)
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : null
            }
          />
        </>
      )}
    </section>
  );
}
