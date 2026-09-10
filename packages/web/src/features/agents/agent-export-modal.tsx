/**
 * The Agents page's "Export agent" dialog: the two bundle shapes the server packs, picked with a
 * segmented control. That control is a form parameter, not a choice between doing it here and
 * asking an agent — the AI path is its own entry on the card (the wand beside the export icon),
 * so both paths are visible at once instead of one hiding inside the other.
 *
 * Two shapes are packed by the server and downloaded here: the API bundle (the integration
 * guide, endpoint reference and runnable examples) and the Docker bundle (an image that
 * imports the agent on first boot and serves the same API). Both carry the portable
 * definition with the agent's skills and hooks, so either re-imports.
 */
import { useState } from "react";
import type { AgentBundleKind } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { Button } from "../../components/ui/button";
import { Modal } from "../../components/ui/modal";
import { Segmented } from "../../components/ui/segmented";
import { toastError } from "../../components/ui/toast";
import { downloadAgentBundle } from "./agent-bundle-file";

export interface AgentExportModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** The agent being exported. */
  agentId: string;
}

export function AgentExportModal(props: AgentExportModalProps) {
  // Mounted only while open, so every open starts on the API shape.
  return props.open ? <AgentExportDialog {...props} /> : null;
}

function AgentExportDialog({ open, onClose, projectId, agentId }: AgentExportModalProps) {
  const [kind, setKind] = useState<AgentBundleKind>("api");
  const [busy, setBusy] = useState(false);

  /** Fetch first, save second, so a failure is a toast rather than an error page saved as a zip. */
  const runDownload = async (pick: AgentBundleKind) => {
    setBusy(true);
    try {
      await downloadAgentBundle(projectId, agentId, pick);
      onClose();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={`${S.agent.exportAgent}：${agentId}`}
      onClose={onClose}
      widthClass="sm:max-w-xl"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void runDownload(kind)}>
            {busy ? S.agent.exportBusy : S.agent.exportAction}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-gray-500 dark:text-gray-400">{S.agent.exportAgentDesc}</p>
        <Segmented
          cols={2}
          value={kind}
          onChange={setKind}
          options={[
            { value: "api", label: S.agent.exportModeApi },
            { value: "docker", label: S.agent.exportModeDocker },
          ]}
        />
        {/* Neither shape needs a form — what each one contains is the whole choice, so the
            segment's description is the body rather than a field nobody would fill in. */}
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {kind === "docker" ? S.agent.exportModeDockerDesc : S.agent.exportModeApiDesc}
        </p>
      </div>
    </Modal>
  );
}
