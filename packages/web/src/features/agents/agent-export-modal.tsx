/**
 * The Agents page's "Export agent" dialog, in three segments — the mirror of the import
 * dialog, which is the point: both halves of porting offer the same two paths, a form the
 * server answers and a prompt an agent answers.
 *
 * Two shapes are packed by the server and downloaded here: the API bundle (the integration
 * guide, endpoint reference and runnable examples) and the Docker bundle (an image that
 * imports the agent on first boot and serves the same API). Both carry the portable
 * definition with the agent's skills and hooks, so either re-imports. The third hands the
 * job to an agent for the shapes those two do not cover — an SDK, Kubernetes manifests, a
 * handover document.
 */
import { useState } from "react";
import type { AgentBundleKind, AgentSummary } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { Button } from "../../components/ui/button";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { MAGIC_WAND_ICON } from "../../components/ui/icons";
import { Modal } from "../../components/ui/modal";
import { Segmented } from "../../components/ui/segmented";
import { toastError } from "../../components/ui/toast";
import { AiCreatePanel, composeAiPrompt, pickDefaultAgent, useAiBridge } from "../ai-create";
import { downloadAgentBundle } from "./agent-bundle-file";

/** The dialog's three paths: the two server-packed kinds, plus the prompt handed to an agent. */
type ExportMode = AgentBundleKind | "ai";

export interface AgentExportModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** The agent being exported. */
  agentId: string;
  /** Agents of the Project: the AI path picks which one does the work. */
  agents: readonly AgentSummary[];
}

export function AgentExportModal(props: AgentExportModalProps) {
  // Mounted only while open, so every open starts on the API segment with an empty draft.
  return props.open ? <AgentExportDialog {...props} /> : null;
}

function AgentExportDialog({ open, onClose, projectId, agentId, agents }: AgentExportModalProps) {
  const [mode, setMode] = useState<ExportMode>("api");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [pickedAgent, setPickedAgent] = useState<string | null>(null);
  const { openAiChat } = useAiBridge();

  // The agent that would do the work, resolved on every render so a list that loads after the
  // dialog opened still yields one (the import dialog resolves its own the same way).
  const aiAgentId = pickedAgent ?? pickDefaultAgent(agents)?.agentId ?? null;
  const tail = S.agent.aiExportTail(projectId, agentId);
  const aiReady = aiAgentId !== null && draft.trim() !== "";

  /** Fetch first, save second, so a failure is a toast rather than an error page saved as a zip. */
  const runDownload = async (kind: AgentBundleKind) => {
    setBusy(true);
    try {
      await downloadAgentBundle(projectId, agentId, kind);
      onClose();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const go = (autoSend: boolean) => {
    if (aiAgentId === null) return;
    openAiChat({ agentId: aiAgentId, text: composeAiPrompt(draft, tail), autoSend });
    onClose();
  };

  return (
    <Modal
      open={open}
      title={`${S.agent.exportAgent}：${agentId}`}
      onClose={onClose}
      widthClass="sm:max-w-xl"
      footer={
        mode === "ai" ? (
          <>
            <Button onClick={onClose}>{S.common.cancel}</Button>
            <Button disabled={!aiReady} onClick={() => go(false)}>
              {S.aiCreate.editInChat}
            </Button>
            <Button variant="primary" disabled={!aiReady} onClick={() => go(true)}>
              <GlyphIcon d={MAGIC_WAND_ICON} />
              {S.aiCreate.send}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              {S.common.cancel}
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void runDownload(mode)}>
              {busy ? S.agent.exportBusy : S.agent.exportAction}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-gray-500 dark:text-gray-400">{S.agent.exportAgentDesc}</p>
        <Segmented
          cols={3}
          value={mode}
          onChange={setMode}
          options={[
            { value: "api", label: S.agent.exportModeApi },
            { value: "docker", label: S.agent.exportModeDocker },
            { value: "ai", label: S.agent.exportModeAi },
          ]}
        />
        {mode === "ai" ? (
          <AiCreatePanel
            value={draft}
            onChange={setDraft}
            intro={S.agent.aiExportIntro}
            examples={[...S.agent.aiExportExamples]}
            tail={tail}
            agents={agents}
            agentId={aiAgentId}
            onAgentChange={setPickedAgent}
            allowAgentChoice
          />
        ) : (
          // The two packed kinds need no form — what each one contains is the whole choice,
          // so the segment's description is the body rather than a field nobody would fill in.
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {mode === "docker" ? S.agent.exportModeDockerDesc : S.agent.exportModeApiDesc}
          </p>
        )}
      </div>
    </Modal>
  );
}
