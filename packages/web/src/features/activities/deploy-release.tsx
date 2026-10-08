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
import { DeployTimeline } from "./deploy-timeline";
import {
  appendLog,
  isProdRun,
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

/** What this section starts: the release, the QA deploy or one of their stages. PROD is the PROD bar's. */
type QaSelection = Exclude<DeployStageSelection, "prod">;

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
  const [confirm, setConfirm] = useState<QaSelection | null>(null);
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
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

  async function start(selection: QaSelection) {
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
  // A PROD run's line is the PROD bar's.
  const line = run && isProdRun(run) ? null : runLine(run);
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
    <section className="space-y-4" aria-labelledby="activity-deploy-release-title">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4 dark:border-gray-800 dark:bg-gray-900/40">
        <div>
          <h4
            id="activity-deploy-release-title"
            className="flex items-center gap-2 text-base font-semibold"
          >
            {words.workflowTitle}
            <InfoPopover label={words.workflowTitle}>
              <p>{words.releaseAbout}</p>
              <p className="mt-2">{words.qaAbout}</p>
            </InfoPopover>
          </h4>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{words.workflowSummary}</p>
        </div>
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
              size="md"
              variant="primary"
              disabled={!canRelease}
              aria-describedby={!canRelease && first?.blocker ? "deploy-start-blocker" : undefined}
              aria-busy={busy === "start" && confirm === "qa"}
              onClick={() => setConfirm("qa")}
            >
              {running && run?.selection === "qa" ? words.deployingQa : words.deployQa}
            </Button>
          </div>
        )}
      </div>
      {!running && first?.blocker && (
        <p id="deploy-start-blocker" className="text-xs text-gray-500 dark:text-gray-400">
          {first.blocker}
        </p>
      )}
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
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(16rem,0.7fr)]">
        <div className="min-w-0 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
            <h5 className="text-xs font-semibold">{words.stagesLabel}</h5>
            {editable && (
              <Button size="sm" aria-pressed={advanced} onClick={() => setAdvanced(!advanced)}>
                {words.advanced}
              </Button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
            {(
              [
                { key: "module", stages: rows.slice(0, 4) },
                { key: "data", stages: rows.slice(4, 8) },
                { key: "qa", stages: rows.slice(8) },
              ] as const
            ).map((phase) => (
              <div key={phase.key} className="min-w-0">
                <p className="text-xs font-medium">{words.phaseLabels[phase.key]}</p>
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={phase.stages.length}
                  aria-valuenow={phase.stages.filter((row) => row.status === "done").length}
                  className="mt-2 flex gap-1"
                  aria-label={words.phaseLabels[phase.key]}
                  aria-valuetext={words.stageProgress(
                    phase.stages.filter((row) => row.status === "done").length,
                    phase.stages.length,
                  )}
                >
                  {phase.stages.map((row) => (
                    <span
                      key={row.stage}
                      aria-hidden
                      className={`h-1 flex-1 rounded-full ${row.status === "pending" ? "bg-gray-200 dark:bg-gray-800" : toneDot[row.tone]}`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <DeployTimeline
            rows={rows}
            advanced={advanced && editable}
            disabled={running || busy !== null}
            onRun={runStage}
          />
        </div>
        <div className="min-w-0 space-y-4">
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
          <section
            aria-labelledby="activity-deploy-log-title"
            className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800"
          >
            <h5
              id="activity-deploy-log-title"
              className="border-b border-gray-200 px-4 py-3 text-xs font-semibold dark:border-gray-800"
            >
              {words.log}
            </h5>
            <pre
              ref={logRef}
              data-testid="deploy-log"
              onScroll={(event) => {
                const element = event.currentTarget;
                follow.current =
                  element.scrollTop + element.clientHeight >= element.scrollHeight - 8;
              }}
              tabIndex={0}
              aria-labelledby="activity-deploy-log-title"
              className="min-h-40 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words bg-gray-50/50 p-4 font-mono text-xs leading-relaxed dark:bg-gray-900/40"
            >
              {lines.length ? lines.map((entry) => entry.text).join("\n") : words.logEmpty}
            </pre>
          </section>
        </div>
      </div>
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
