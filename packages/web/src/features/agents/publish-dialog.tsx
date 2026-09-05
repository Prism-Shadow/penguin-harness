/**
 * Publish an Agent's definition to a GitHub gist. The dialog first shows exactly what would
 * be sent — the file list, its size, and that state, memory and the vault are not in it —
 * then publishes. The gist an Agent was published to is remembered BY THE SERVER, beside the
 * Agent, so a republish updates that same gist from any browser or machine; the field is
 * there only to point a publish at a different gist. Which GitHub identity the server would
 * use (the machine's `gh` login, or a stored token) is shown, and when it has neither the
 * dialog says how to give it one instead of failing on the button.
 */
import { useEffect, useState } from "react";
import type { AgentPackageResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { Switch } from "../../components/ui/switch";
import { toastError } from "../../components/ui/toast";
import { apiErrorText } from "../../lib/api-error";
import { formatBytes } from "../../lib/format";
import { S } from "../../lib/strings";
import { toneInk, toneStrip } from "../../lib/tone";

export function PublishAgentDialog({
  open,
  onClose,
  projectId,
  agentId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  agentId: string;
}) {
  const [pkg, setPkg] = useState<AgentPackageResponse | null>(null);
  /** Empty = publish to the Agent's remembered gist (or create the first one). */
  const [gistId, setGistId] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    url: string;
    files: number;
    bytes: number;
    unchanged: boolean;
  } | null>(null);
  const [showFiles, setShowFiles] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPkg(null);
    setResult(null);
    setShowFiles(false);
    setGistId("");
    let cancelled = false;
    api
      .getAgentPackage(projectId, agentId)
      .then((res) => {
        if (!cancelled) setPkg(res);
      })
      .catch((e: unknown) => {
        if (!cancelled) toastError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, agentId]);

  const publish = async () => {
    if (pkg === null || busy) return;
    setBusy(true);
    try {
      const res = await api.publishAgentPackage(projectId, agentId, {
        ...(gistId.trim() !== "" ? { gistId: gistId.trim() } : {}),
        public: isPublic,
      });
      setResult(res);
      // Refresh the view so the remembered gist is the server's, not this dialog's guess.
      api.getAgentPackage(projectId, agentId).then(setPkg, () => undefined);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const target = gistId.trim() !== "" ? gistId.trim() : (pkg?.publishedGist?.gistId ?? null);
  const updating = target !== null;
  return (
    <Modal
      open={open}
      title={S.agent.publishTitle}
      onClose={onClose}
      widthClass="sm:max-w-lg"
      footer={
        <>
          <Button onClick={onClose}>{result === null ? S.common.cancel : S.common.close}</Button>
          {result === null && (
            <Button
              variant="primary"
              disabled={pkg === null || !pkg.canPublish || busy}
              onClick={() => void publish()}
            >
              {busy ? S.agent.publishing : updating ? S.agent.publishUpdate : S.agent.publish}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-gray-600 dark:text-gray-300">{S.agent.publishDesc}</p>
        {pkg === null ? (
          <p className="text-xs text-gray-500">{S.common.loading}</p>
        ) : (
          <>
            <div className="rounded-md border border-gray-200 px-3 py-2 dark:border-gray-800">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{pkg.manifest.name}</span>
                <button
                  type="button"
                  className="text-xs text-gray-500 underline-offset-2 hover:underline"
                  aria-expanded={showFiles}
                  onClick={() => setShowFiles((v) => !v)}
                >
                  {S.agent.packageSummary(pkg.manifest.files.length, formatBytes(pkg.bytes))}
                </button>
              </div>
              {showFiles && (
                <ul className="mt-2 max-h-40 overflow-y-auto font-mono text-xs text-gray-600 dark:text-gray-400">
                  {pkg.manifest.files.map((f) => (
                    <li key={f.path}>{f.path}</li>
                  ))}
                </ul>
              )}
            </div>
            <p className="text-xs text-gray-500">{S.agent.packageExcludes}</p>
            {pkg.canPublish && pkg.publishVia !== null && (
              <p className="text-xs text-gray-500">
                {pkg.publishVia === "gh" ? S.agent.publishViaGh : S.agent.publishViaToken}
              </p>
            )}
            {pkg.publishedGist !== null && result === null && (
              <p className="text-xs text-gray-500">
                {S.agent.publishUpdates}{" "}
                <a
                  href={pkg.publishedGist.url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all font-mono underline-offset-2 hover:underline"
                >
                  {pkg.publishedGist.url}
                </a>
              </p>
            )}
            {!pkg.canPublish && (
              <div className={`rounded-md px-3 py-2 text-xs ${toneStrip.attention}`}>
                {S.agent.publishNoToken}
              </div>
            )}
            {result === null ? (
              <>
                <Input
                  label={S.agent.publishGistId}
                  size="sm"
                  value={gistId}
                  placeholder={S.agent.publishGistIdPlaceholder}
                  hint={S.agent.publishGistIdHint}
                  onChange={(e) => setGistId(e.target.value)}
                />
                {!updating && (
                  <div className="flex items-center justify-between gap-3">
                    <span>{S.agent.publishPublic}</span>
                    <Switch checked={isPublic} onChange={setIsPublic} />
                  </div>
                )}
              </>
            ) : (
              <div className={`rounded-md px-3 py-2 text-xs ${toneStrip.success}`}>
                <p className={toneInk.success}>
                  {result.unchanged
                    ? S.agent.publishUnchanged
                    : S.agent.published(result.files, formatBytes(result.bytes))}
                </p>
                <a
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block break-all font-mono underline-offset-2 hover:underline"
                >
                  {result.url}
                </a>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
