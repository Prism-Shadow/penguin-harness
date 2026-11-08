/**
 * An Agent settings page's "Copy agent" dialog (agent-settings-page.tsx): a new Agent that starts
 * from this Agent's current Agent State, on the server this Agent lives on. It asks for the copy's
 * name and id only. The server copies the rest (POST …/agents with `copyFrom`): the description,
 * config, prompt, Skills, hooks, memory, schedules and version — and none of the vault, Sessions,
 * Traces or API keys. Running the same baseline under several methods, as a self-evolution
 * experiment does, is what this is for.
 *
 * A record dialog under the settings commit model, mounted only while open, as the Create dialog
 * is: the name starts as "<name> copy" without counting as an edit, Copy is live once the id keeps
 * the naming rule, closing after an edit asks first, and a refusal (a taken id) lands under the id.
 */
import { useState } from "react";
import type { AgentCreateRequest } from "@prismshadow/penguin-server/api";
import {
  Button,
  Input,
  Modal,
  discardUnsaved,
  useFormDraft,
  useGuardedClose,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { SEMANTIC_ID_PATTERN } from "../../lib/semantic-id";
import { SemanticIdField } from "../semantic-id/semantic-id-field";

interface CopyAgentDraft {
  name: string;
  agentId: string;
}

const trimCopy = (draft: CopyAgentDraft) => ({
  name: draft.name.trim(),
  agentId: draft.agentId.trim(),
});

export interface CopyAgentDialogProps {
  open: boolean;
  projectId: string | null;
  /** The Agent copied, and the server it lives on (null: this one), where the copy is created too. */
  sourceId: string;
  sourceName: string;
  machineId: string | null;
  onClose: () => void;
  /** The copy exists: the page closes the dialog and goes to it. */
  onCopied: (agentId: string) => Promise<void>;
}

export function CopyAgentDialog(props: CopyAgentDialogProps) {
  return props.open ? <CopyAgentForm {...props} /> : null;
}

function CopyAgentForm({
  projectId,
  sourceId,
  sourceName,
  machineId,
  onClose,
  onCopied,
}: CopyAgentDialogProps) {
  const form = useFormDraft<CopyAgentDraft>(
    { name: S.agent.copyNameOf(sourceName), agentId: "" },
    { normalize: trimCopy },
  );
  const { name, agentId } = form.draft;
  /** What the server refused, under the id. Cleared by the next edit of the id. */
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const requestClose = useGuardedClose(onClose, form.scope, { locked: busy });

  const id = agentId.trim();
  const idValid = SEMANTIC_ID_PATTERN.test(id);
  const idError = refused ?? (id !== "" && !idValid ? S.agent.idHint : undefined);

  const copy = async () => {
    if (!projectId || !idValid || busy) return;
    setBusy(true);
    setRefused(undefined);
    try {
      // A blank name keeps the source's; the server copies everything else.
      const body: AgentCreateRequest = { agentId: id, copyFrom: sourceId };
      if (name.trim()) body.name = name.trim();
      const res = await api.createAgent(projectId, body, machineId);
      // The page navigates to the copy next: what was typed is saved, so the leave guard must
      // not ask about it.
      discardUnsaved(form.scope);
      await onCopied(res.agent.agentId);
    } catch (e) {
      setRefused(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={S.agent.copyTitle(sourceName)}
      onClose={requestClose}
      footer={
        <>
          <Button size="sm" onClick={requestClose}>
            {S.common.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!idValid || busy}
            onClick={() => void copy()}
          >
            {S.agent.copyConfirm}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.agent.copyIntro}</p>
        <Input
          label={S.common.name}
          size="sm"
          value={name}
          onChange={(e) => form.patch({ name: e.target.value })}
          autoFocus
        />
        <SemanticIdField
          projectId={projectId}
          kind="agent"
          label={S.agent.id}
          hint={S.agent.idHint}
          generateHint={S.agent.idGenerateHint}
          value={agentId}
          source={name.trim()}
          error={idError}
          disabled={busy}
          onChange={(next) => {
            form.patch({ agentId: next });
            setRefused(undefined);
          }}
        />
      </div>
    </Modal>
  );
}
