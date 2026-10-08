/**
 * The PROD bar, under the QA deploy: where PROD stands (its two stages, the last deploy, why it
 * cannot start now), and Deploy to PROD for an admin who owns the project. The button opens a
 * dialog whose confirm stays disabled until the product code is typed; the server checks the
 * code, the admin and that QA has the activity as it is now again. The run's log is the one the
 * section already follows.
 */
import { useEffect, useRef, useState } from "react";
import type {
  DeployProductionState,
  DeployRun,
  DeployRunResponse,
} from "@prismshadow/penguin-server/api";
import { ApiError, apiFetch } from "../../api/client";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { InfoPopover } from "../../components/ui/info-popover";
import { Input } from "../../components/ui/input";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime } from "../../lib/format";
import { S } from "../../lib/strings";
import { toneDot, toneInk } from "../../lib/tone";
import { prodBar, prodConfirmed, prodRefusalText, refusalText } from "./deploy-model";
import type { Announcement } from "./run-toasts";

const HEAD =
  "border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-400";
const TH = "whitespace-nowrap px-3 py-2 font-medium";
const TD = "px-3 py-2 align-top";

export function DeployProd({
  endpoint,
  editable,
  isAdmin,
  production,
  run,
  productCode,
  activityDataBranch,
  onRun,
  onSettled,
  onAnnounce,
}: {
  endpoint: string;
  /** Whether the viewer owns the project. */
  editable: boolean;
  /** Whether the viewer is a server admin: PROD is an admin's who owns the project. */
  isAdmin: boolean;
  production: DeployProductionState;
  /** The activity's latest run, QA's or PROD's. */
  run: DeployRun | null;
  productCode: string;
  /** The activity-data branch QA deployed, which PROD deploys too. */
  activityDataBranch: string;
  onRun: (run: DeployRun) => void;
  /** A start was refused because the state shown was out of date: read it again. */
  onSettled: () => void;
  onAnnounce: (announcement: Announcement) => void;
}) {
  const words = S.activities.deploy;
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const bar = prodBar(production, run, formatDateTime);
  const running = run?.status === "running";
  const prodRunning = running && run?.target === "prod";
  const confirmed = prodConfirmed(typed, productCode);

  function close() {
    setOpen(false);
    setTyped("");
  }

  async function start() {
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const value = await apiFetch<DeployRunResponse>(`${endpoint}/deploy`, {
        method: "POST",
        body: { stage: "prod", target: "prod", confirm: typed },
      });
      if (!alive.current) return;
      close();
      onRun(value.run);
      onAnnounce({ kind: "info", text: words.prod.started });
    } catch (cause) {
      if (!alive.current) return;
      close();
      const code = cause instanceof ApiError ? cause.code : undefined;
      const blocked = code === "deploy_blocked" || code === "deploy_running";
      setError(
        prodRefusalText(code) ??
          (blocked ? refusalText((cause as ApiError).detail) : null) ??
          apiErrorText(cause),
      );
      if (blocked) onSettled();
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <section
      className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-800"
      aria-labelledby="activity-deploy-prod-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4
          id="activity-deploy-prod-title"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          {words.prod.title}
          <InfoPopover label={words.prod.title}>
            <p>{words.prod.about}</p>
          </InfoPopover>
        </h4>
        {editable &&
          (isAdmin ? (
            <Button
              size="sm"
              variant="primary"
              disabled={busy || running || bar.blocker !== null}
              aria-busy={busy}
              onClick={() => {
                setError(null);
                setOpen(true);
              }}
            >
              {prodRunning ? words.prod.deploying : words.prod.deploy}
            </Button>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400" data-testid="deploy-prod-admin">
              {words.prod.adminOnly}
            </p>
          ))}
      </div>
      {bar.line && (
        <p
          role="status"
          className={`text-sm font-medium ${toneInk[bar.line.tone]}`}
          data-testid="deploy-prod-status"
        >
          {bar.line.text}
        </p>
      )}
      <p className="flex flex-wrap items-center gap-x-3 text-sm" data-testid="deploy-prod-last">
        <span>{bar.last}</span>
        {bar.lastUrl && (
          <a
            href={bar.lastUrl}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            {words.prod.openDeploy}
          </a>
        )}
      </p>
      {!running && (
        <p
          className={`text-xs ${bar.blocker ? "text-gray-500 dark:text-gray-400" : toneInk.success}`}
          data-testid="deploy-prod-blocker"
        >
          {bar.blocker ?? words.prod.ready}
        </p>
      )}
      {error && (
        <p role="alert" className={`text-xs ${toneInk.danger}`}>
          {error}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
        <table className="w-full text-sm" aria-label={words.prod.stagesLabel}>
          <thead>
            <tr className={HEAD}>
              <th className={TH}>{words.stageColumns.stage}</th>
              <th className={TH}>{words.stageColumns.state}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
            {bar.rows.map((row) => (
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmModal
        open={open}
        title={words.prod.confirmTitle}
        tone="primary"
        confirmLabel={words.prod.confirmButton}
        confirmDisabled={!confirmed}
        busy={busy}
        onClose={close}
        onConfirm={() => void start()}
      >
        <div className="space-y-3">
          <div className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
            <p>{words.prod.confirm(productCode)}</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>{words.prod.confirmItems.data(activityDataBranch)}</li>
              <li>{words.prod.confirmItems.jenkins}</li>
            </ul>
          </div>
          <Input
            size="sm"
            label={words.prod.confirmLabel(productCode)}
            hint={words.prod.confirmHint}
            value={typed}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
      </ConfirmModal>
    </section>
  );
}
