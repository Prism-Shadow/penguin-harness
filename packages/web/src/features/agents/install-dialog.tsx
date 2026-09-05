/**
 * Install an Agent from a source — a gist, npm, a GitHub repository or release, a git URL,
 * or a tarball URL. Two steps in one dialog: read the source (nothing is written; the
 * package's name, description, file count, size and resolved origin come back for the user
 * to look at), then choose the new Agent's id and install. The kind is detected from the
 * shape of what was typed; the select forces one when the shape is ambiguous. Errors from
 * the read — not a package, an unsafe path, nothing there — render inline under the input.
 */
import { useEffect, useState } from "react";
import type {
  AgentPackagePreviewResponse,
  AgentPackageSourceKind,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { Select } from "../../components/ui/select";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { apiErrorText } from "../../lib/api-error";
import { formatBytes } from "../../lib/format";
import { SEMANTIC_ID_PATTERN } from "../../lib/semantic-id";
import { S } from "../../lib/strings";

export function InstallFromGistDialog({
  open,
  onClose,
  projectId,
  onInstalled,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onInstalled: (agentId: string) => void;
}) {
  const [gist, setGist] = useState("");
  const [kind, setKind] = useState<AgentPackageSourceKind | "">("");
  const [gistError, setGistError] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<AgentPackagePreviewResponse | null>(null);
  const [agentId, setAgentId] = useState("");
  const [idError, setIdError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setGist("");
    setKind("");
    setGistError(undefined);
    setPreview(null);
    setAgentId("");
    setIdError(undefined);
  }, [open]);

  const read = async () => {
    if (busy || gist.trim() === "") return;
    setBusy(true);
    setGistError(undefined);
    try {
      const res = await api.previewAgentPackage(gist.trim(), kind === "" ? undefined : kind);
      setPreview(res);
      setAgentId(res.suggestedId);
    } catch (e) {
      setPreview(null);
      if (e instanceof ApiError) setGistError(apiErrorText(e));
      else toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    if (busy || preview === null) return;
    if (!SEMANTIC_ID_PATTERN.test(agentId)) {
      setIdError(S.agent.idHint);
      return;
    }
    setBusy(true);
    try {
      const res = await api.installAgentPackage({
        source: gist.trim(),
        ...(kind === "" ? {} : { kind }),
        projectId,
        agentId,
      });
      toastSuccess(S.agent.installed(res.agentId));
      onInstalled(res.agentId);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === "agent_exists") setIdError(apiErrorText(e));
      else toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={S.agent.installTitle}
      onClose={onClose}
      widthClass="sm:max-w-lg"
      footer={
        <>
          <Button onClick={onClose}>{S.common.cancel}</Button>
          {preview === null ? (
            <Button
              variant="primary"
              disabled={busy || gist.trim() === ""}
              onClick={() => void read()}
            >
              {busy ? S.agent.installReading : S.agent.installRead}
            </Button>
          ) : (
            <Button variant="primary" disabled={busy} onClick={() => void install()}>
              {busy ? S.agent.installing : S.agent.install}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-gray-600 dark:text-gray-300">{S.agent.installDesc}</p>
        <Input
          label={S.agent.installGist}
          size="sm"
          value={gist}
          hint={S.agent.installSourceHint}
          placeholder="https://github.com/… · npm:… · https://gist.github.com/…"
          error={gistError}
          disabled={preview !== null}
          onChange={(e) => {
            setGist(e.target.value);
            setGistError(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && preview === null) void read();
          }}
        />
        {preview === null && (
          <Select
            label={S.agent.installKind}
            size="sm"
            value={kind}
            onChange={(e) => setKind(e.target.value as AgentPackageSourceKind | "")}
          >
            <option value="">{S.agent.installKindAuto}</option>
            <option value="gist">gist</option>
            <option value="npm">npm</option>
            <option value="github">{S.agent.installKindGithub}</option>
            <option value="github-release">{S.agent.installKindRelease}</option>
            <option value="git">git</option>
            <option value="url">{S.agent.installKindUrl}</option>
          </Select>
        )}
        {preview !== null && (
          <>
            <div className="rounded-md border border-gray-200 px-3 py-2 dark:border-gray-800">
              <p className="font-medium">{preview.manifest.name}</p>
              <p className="mt-0.5 break-all font-mono text-xs text-gray-500">{preview.source}</p>
              {preview.manifest.description !== "" && (
                <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                  {preview.manifest.description}
                </p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                {S.agent.packageSummary(preview.manifest.files.length, formatBytes(preview.bytes))}
                {" · "}
                {S.agent.packagedBy(preview.manifest.packagedBy)}
              </p>
              <button
                type="button"
                className="mt-1 text-xs text-gray-500 underline-offset-2 hover:underline"
                onClick={() => setPreview(null)}
              >
                {S.agent.installChangeGist}
              </button>
            </div>
            <Input
              label={S.agent.id}
              required
              size="sm"
              value={agentId}
              error={idError}
              hint={S.agent.idHint}
              onChange={(e) => {
                setAgentId(e.target.value);
                setIdError(undefined);
              }}
            />
          </>
        )}
      </div>
    </Modal>
  );
}
