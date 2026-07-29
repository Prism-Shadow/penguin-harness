/**
 * Update dialog, opened from the user menu's single update row once a newer release is known.
 * It is the only place the update story is told, so it carries everything the menu used to
 * spread across three rows: the new version, the release-notes link, and — for admins only —
 * the self-update action. It explains that the release is downloaded into the install
 * directory and that the service must be restarted afterwards, then runs
 * POST /api/version/update and shows the outcome: the CLI's own output tail in a scrollable
 * <pre> for the failed/unsupported states, a restart hint on success. Non-admins get the same
 * information plus the link, with no action to run (the endpoint is admin-only anyway).
 * Closing is blocked while the update runs (the request can take minutes; navigating away
 * would just hide the result).
 */
import { useEffect, useState } from "react";
import type { UpdateRunResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { Button } from "../ui/button";
import { Modal } from "../ui/modal";

type Phase = "confirm" | "running" | "done";

export function UpdateDialog({
  open,
  onClose,
  latestVersion,
  releaseUrl = null,
  canUpdate,
}: {
  open: boolean;
  onClose: () => void;
  latestVersion: string | null;
  /** Release page of the new version; omitted/null when the check couldn't resolve one. */
  releaseUrl?: string | null;
  /** Admin: the self-update action is offered. Otherwise the dialog is read-only. */
  canUpdate: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("confirm");
  const [result, setResult] = useState<UpdateRunResponse | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhase("confirm");
    setResult(null);
  }, [open]);

  const run = async () => {
    setPhase("running");
    try {
      setResult(await api.runUpdate());
    } catch (e) {
      // The request itself failed (e.g. the connection dropped mid-run): surface it the
      // same way as a failed run, with the error text where the output tail would be.
      setResult({ status: "failed", output: apiErrorText(e), needsRestart: false });
    }
    setPhase("done");
  };

  const statusLine =
    result === null
      ? null
      : result.status === "updated"
        ? { text: S.update.updated, className: "text-green-600 dark:text-green-400" }
        : result.status === "unsupported"
          ? { text: S.update.unsupported, className: "text-amber-600 dark:text-amber-400" }
          : { text: S.update.failed, className: "text-red-600 dark:text-red-400" };

  return (
    <Modal
      open={open}
      title={S.update.updateNow}
      onClose={phase === "running" ? () => undefined : onClose}
      footer={
        phase === "done" || !canUpdate ? (
          <Button onClick={onClose}>{S.common.close}</Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={phase === "running"}>
              {S.common.cancel}
            </Button>
            <Button variant="primary" disabled={phase === "running"} onClick={() => void run()}>
              {phase === "running" ? S.update.updating : S.update.updateNow}
            </Button>
          </>
        )
      }
    >
      {phase === "done" && result !== null && statusLine !== null ? (
        <div className="space-y-3">
          <p className={`text-sm font-medium ${statusLine.className}`}>{statusLine.text}</p>
          {result.status === "updated" && (
            <p className="text-sm text-gray-600 dark:text-gray-400">{S.update.restartHint}</p>
          )}
          {result.output !== "" && (
            <pre className="max-h-56 overflow-auto rounded-md bg-gray-100 p-3 text-xs leading-relaxed whitespace-pre-wrap text-gray-700 dark:bg-gray-800 dark:text-gray-300">
              {result.output}
            </pre>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {latestVersion !== null && (
            <p className="text-sm font-medium">{S.update.newVersion(latestVersion)}</p>
          )}
          {/* Release notes: the menu no longer carries this link, so it lives here. */}
          {releaseUrl !== null && (
            <p>
              <a
                href={releaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-brand-600 underline-offset-2 hover:underline dark:text-brand-300"
              >
                {S.update.releaseNotes}
              </a>
            </p>
          )}
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {canUpdate ? S.update.confirmBody : S.update.adminOnly}
          </p>
          {phase === "running" && (
            <p className="text-sm text-gray-500 dark:text-gray-400">{S.update.updating}</p>
          )}
        </div>
      )}
    </Modal>
  );
}
