/**
 * The module release and the QA deploy, in the Deploy section: each stage with its state and
 * why it cannot run now, Deploy to QA and Release module (each behind a confirmation, since
 * they push branches and start Jenkins jobs), one stage at a time under "Run one stage", Stop,
 * the log, followed every second while a run goes, and once QA has the activity, a link to it.
 */
import { useEffect, useRef, useState } from "react";
import type {
  DeployLogLine,
  DeployLogResponse,
  DeployRun,
  DeployRunResponse,
  DeployStage,
  DeployStageSelection,
  DeployStageState,
} from "@prismshadow/penguin-server/api";
import { ApiError, apiFetch } from "../../api/client";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { InfoPopover } from "../../components/ui/info-popover";
import { Input } from "../../components/ui/input";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneDot, toneInk } from "../../lib/tone";
import {
  appendLog,
  preflightFindings,
  qaResult,
  refusalText,
  runLine,
  stageConfirmText,
  stageName,
  stageRows,
  versionProblem,
} from "./deploy-model";
import type { Announcement } from "./run-toasts";

const HEAD =
  "border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-400";
const TH = "whitespace-nowrap px-3 py-2 font-medium";
const TD = "px-3 py-2 align-top";

/** How often the log is asked for while a release runs. */
const POLL_MS = 1000;

export function DeployRelease({
  endpoint,
  editable,
  run,
  stages,
  branch,
  activityDataBranch,
  productCode,
  onRun,
  onSettled,
  onAnnounce,
}: {
  endpoint: string;
  editable: boolean;
  run: DeployRun | null;
  stages: readonly DeployStageState[];
  /** The module's deploy branch, which the confirmation names. */
  branch: string;
  /** The activity-data branch a QA deploy pushes, which its confirmation names. */
  activityDataBranch: string;
  productCode: string;
  /** A run started, or the log poll brought a newer state of it. */
  onRun: (run: DeployRun) => void;
  /** A followed run ended: the stage states and readiness are read again. */
  onSettled: () => void;
  onAnnounce: (announcement: Announcement) => void;
}) {
  const words = S.activities.deploy;
  const [confirm, setConfirm] = useState<DeployStageSelection | null>(null);
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<DeployLogLine[]>([]);
  const logRef = useRef<HTMLPreElement | null>(null);
  const follow = useRef(true);
  const callbacks = useRef({ onRun, onSettled, onAnnounce });
  callbacks.current = { onRun, onSettled, onAnnounce };
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const runId = run?.runId ?? null;
  const running = run?.status === "running";
  // Follows the run's log from the start: every second while it runs, at once while pages are
  // full; when it ends, the stages are read again and the end is announced.
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cursor = 0;
    let sawRunning = false;
    setLines([]);
    follow.current = true;
    const tick = async () => {
      try {
        const res = await apiFetch<DeployLogResponse>(
          `${endpoint}/deploy/runs/${runId}/log?after=${cursor}`,
        );
        if (cancelled) return;
        cursor = res.log.next;
        setLines((previous) => appendLog(previous, res.log));
        callbacks.current.onRun(res.run);
        if (res.run.status === "running") sawRunning = true;
        if (res.log.done) {
          if (sawRunning) {
            const line = runLine(res.run);
            if (line)
              callbacks.current.onAnnounce({
                kind:
                  res.run.status === "succeeded"
                    ? "success"
                    : res.run.status === "failed"
                      ? "error"
                      : "attention",
                text: line.text,
              });
            callbacks.current.onSettled();
          }
          return;
        }
        timer = setTimeout(() => void tick(), res.log.lines.length >= 500 ? 0 : POLL_MS);
      } catch {
        if (!cancelled) timer = setTimeout(() => void tick(), POLL_MS * 2);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [endpoint, runId]);

  // Keeps the newest line in view unless the reader scrolled up to read an older one.
  useEffect(() => {
    const element = logRef.current;
    if (element && follow.current) element.scrollTop = element.scrollHeight;
  }, [lines]);

  async function start(selection: DeployStageSelection) {
    const problem = selection === "release" ? versionProblem(version) : null;
    if (problem) return;
    setBusy("start");
    setError(null);
    try {
      const value = await apiFetch<DeployRunResponse>(`${endpoint}/deploy`, {
        method: "POST",
        body: {
          stage: selection,
          ...(selection === "release" && version.trim() ? { moduleVersion: version.trim() } : {}),
        },
      });
      if (!alive.current) return;
      setConfirm(null);
      onRun(value.run);
      onAnnounce({
        kind: "info",
        text:
          selection === "release"
            ? words.releaseStarted
            : selection === "qa"
              ? words.deployQaStarted
              : words.stageStarted(stageName(selection)),
      });
    } catch (cause) {
      if (alive.current) {
        setConfirm(null);
        // The stages shown were out of date (another tab or owner moved them): say why in the
        // stage list's words, and read the stages again.
        const blocked =
          cause instanceof ApiError &&
          (cause.code === "deploy_blocked" || cause.code === "deploy_running");
        setError((blocked && refusalText((cause as ApiError).detail)) || apiErrorText(cause));
        if (blocked) onSettled();
      }
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function stop() {
    setBusy("stop");
    setError(null);
    try {
      const value = await apiFetch<DeployRunResponse>(`${endpoint}/deploy/stop`, {
        method: "POST",
      });
      if (alive.current) onRun(value.run);
    } catch (cause) {
      if (alive.current) setError(apiErrorText(cause));
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  const branches = { deploy: branch, activityData: activityDataBranch };

  /** A stage that pushes or starts a Jenkins job asks first; the others only work here or wait. */
  function runStage(stage: DeployStage) {
    if (stageConfirmText(stage, branches) !== null) setConfirm(stage);
    else void start(stage);
  }

  const rows = stageRows(run, stages);
  const line = runLine(run);
  const first = rows[0];
  const canRelease = editable && !running && busy === null && first !== undefined && !first.blocker;
  const versionError = versionProblem(version);
  const buildUrl = run?.metadata.moduleBuildUrl;
  const resolved = run?.metadata.resolvedModuleVersion;
  const onQa = qaResult(stages);
  const findings = preflightFindings(run, stages);
  const confirmText =
    confirm === null || confirm === "release" || confirm === "qa"
      ? null
      : stageConfirmText(confirm, branches);
  return (
    <section className="space-y-3" aria-labelledby="activity-deploy-release-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4
          id="activity-deploy-release-title"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          {words.releaseTitle}
          <InfoPopover label={words.releaseTitle}>
            <p>{words.releaseAbout}</p>
            <p className="mt-2">{words.qaAbout}</p>
          </InfoPopover>
        </h4>
        {editable && (
          <div className="flex flex-wrap gap-2">
            {running && (
              <Button
                size="sm"
                disabled={busy !== null}
                aria-busy={busy === "stop"}
                onClick={() => void stop()}
              >
                {busy === "stop" ? words.stopping : words.stop}
              </Button>
            )}
            <Button
              size="sm"
              disabled={!canRelease}
              aria-busy={busy === "start" && confirm === "release"}
              onClick={() => setConfirm("release")}
            >
              {running && run?.selection === "release" ? words.releasing : words.releaseModule}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!canRelease}
              aria-busy={busy === "start" && confirm === "qa"}
              onClick={() => setConfirm("qa")}
            >
              {running && run?.selection === "qa" ? words.deployingQa : words.deployQa}
            </Button>
          </div>
        )}
      </div>
      {line && (
        <p
          role="status"
          className={`text-sm font-medium ${toneInk[line.tone]}`}
          data-testid="deploy-run-status"
        >
          {line.text}
        </p>
      )}
      {error && (
        <p role="alert" className={`text-xs ${toneInk.danger}`}>
          {error}
        </p>
      )}
      {run?.skipped?.length ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">{words.releaseSkipped}</p>
      ) : null}
      {onQa && (
        <p className="flex flex-wrap items-center gap-x-3 text-sm" data-testid="deploy-qa-result">
          <a
            href={onQa.url}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline underline-offset-2"
          >
            {words.openQa}
          </a>
          {onQa.version && <span>{words.qaVersion(onQa.version)}</span>}
        </p>
      )}
      {(resolved || buildUrl) && (
        <p className="flex flex-wrap gap-x-3 text-sm">
          {resolved && <span>{words.resolvedVersion(resolved)}</span>}
          {buildUrl && (
            <a
              href={buildUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              {words.openBuild}
            </a>
          )}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
        <table className="w-full text-sm" aria-label={words.stagesLabel}>
          <thead>
            <tr className={HEAD}>
              <th className={TH}>{words.stageColumns.stage}</th>
              <th className={TH}>{words.stageColumns.state}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
            {rows.map((row) => (
              <tr key={row.stage}>
                <td className={`${TD} whitespace-nowrap font-medium`}>{row.label}</td>
                <td className={`${TD} text-xs`}>
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={`size-1.5 shrink-0 rounded-full ${toneDot[row.tone]}`}
                    />
                    {row.statusText}
                  </span>
                  {row.error && <p className={`mt-1 ${toneInk.danger}`}>{row.error}</p>}
                  {row.blocker && !running && (
                    <p className="mt-1 text-gray-500 dark:text-gray-400">{row.blocker}</p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {findings && (
        <section aria-labelledby="activity-deploy-preflight-title" className="space-y-1">
          <h5 id="activity-deploy-preflight-title" className="text-xs font-semibold">
            {words.preflightTitle}
          </h5>
          {findings.errors.length > 0 && (
            <>
              <h6 id="activity-deploy-preflight-errors" className={`text-xs ${toneInk.danger}`}>
                {words.preflightErrors}
              </h6>
              <ul
                aria-labelledby="activity-deploy-preflight-errors"
                className="list-disc space-y-1 pl-5 text-xs"
              >
                {findings.errors.map((text, index) => (
                  <li key={index} className={toneInk.danger}>
                    {text}
                  </li>
                ))}
              </ul>
            </>
          )}
          {findings.warnings.length > 0 && (
            <>
              <h6
                id="activity-deploy-preflight-warnings"
                className="text-xs text-gray-600 dark:text-gray-300"
              >
                {words.preflightWarnings}
              </h6>
              <ul
                aria-labelledby="activity-deploy-preflight-warnings"
                className="list-disc space-y-1 pl-5 text-xs"
              >
                {findings.warnings.map((text, index) => (
                  <li key={index} className="text-gray-600 dark:text-gray-300">
                    {text}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {editable && (
        <details className="space-y-2">
          <summary className="cursor-pointer text-xs font-medium">{words.advanced}</summary>
          <ul className="mt-2 space-y-1">
            {rows.map((row) => (
              <li key={row.stage} className="flex items-center justify-between gap-2 text-sm">
                <span>{row.label}</span>
                <Button
                  size="sm"
                  aria-label={words.runStage(row.label)}
                  disabled={running || busy !== null || row.blocker !== null}
                  onClick={() => runStage(row.stage)}
                >
                  {words.run}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <section aria-labelledby="activity-deploy-log-title" className="space-y-1">
        <h5 id="activity-deploy-log-title" className="text-xs font-semibold">
          {words.log}
        </h5>
        <pre
          ref={logRef}
          data-testid="deploy-log"
          onScroll={(event) => {
            const element = event.currentTarget;
            follow.current = element.scrollTop + element.clientHeight >= element.scrollHeight - 8;
          }}
          className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-gray-200 p-2 font-mono text-xs dark:border-gray-800"
        >
          {lines.length ? lines.map((entry) => entry.text).join("\n") : words.logEmpty}
        </pre>
      </section>
      <ConfirmModal
        open={confirm !== null}
        title={
          confirm === "qa"
            ? words.deployQaConfirmTitle
            : confirm === "release" || confirm === null
              ? words.releaseConfirmTitle
              : words.stageConfirmTitle(stageName(confirm))
        }
        tone="primary"
        confirmLabel={
          confirm === "release"
            ? words.releaseConfirmLabel
            : confirm === "qa"
              ? words.deployQaConfirmLabel
              : words.run
        }
        confirmDisabled={confirm === "release" && versionError !== null}
        busy={busy === "start"}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && void start(confirm)}
      >
        <div className="space-y-3">
          {confirm === "qa" ? (
            <div className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
              <p>{words.deployQaConfirm(productCode)}</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>{words.deployQaConfirmItems.release(branch)}</li>
                <li>{words.deployQaConfirmItems.media}</li>
                <li>{words.deployQaConfirmItems.data(activityDataBranch)}</li>
                <li>{words.deployQaConfirmItems.deploy}</li>
              </ul>
            </div>
          ) : (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {confirm === "release" ? words.releaseConfirm(branch) : confirmText}
            </p>
          )}
          {confirm === "release" && (
            <Input
              size="sm"
              label={words.moduleVersion}
              hint={words.moduleVersionHint}
              error={versionError ?? undefined}
              value={version}
              inputMode="decimal"
              onChange={(event) => setVersion(event.target.value)}
            />
          )}
        </div>
      </ConfirmModal>
    </section>
  );
}
