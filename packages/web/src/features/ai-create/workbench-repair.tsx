/**
 * "Fix with AI" for a workbench whose files do not load: the plugin repair's hand-off
 * (features/plugins/plugin-repair.tsx, whose words it shares) — a confirm that says what is about
 * to happen, then a new chat for the default Agent in a temporary Workspace with the repair prompt
 * in its composer, never sent on the user's behalf. The repair may change the workbench's files,
 * so reading the prompt and pressing send stays the user's step.
 *
 * The folder sits in its own Agent's Agent State, in no Workspace of the user's, and a repair must
 * not start inside one: hence the temporary Workspace. The default Agent reaches the folder all
 * the same — its system prompt names the App Data Dir and has every Agent reach another Agent's
 * Agent State directly — so the prompt names the folder by that path. A workbench on a machine is
 * repaired there: by that machine's default Agent, in that machine's temporary Workspace, where
 * the same path is the machine's own.
 *
 * It lives beside the bridge rather than with the workbenches: the bridge opens the chat page's
 * draft, and the workbenches module, which the Agent settings import, stays clear of the chat. The
 * pane that shows a load error takes the button from its caller (workbench-page-status.tsx).
 */
import { useState, type ReactNode } from "react";

import type { AgentSummary } from "@prismshadow/penguin-server/api";
import { Button, ConfirmModal, GlyphIcon, ICONS, toastError } from "@prismshadow/penguin-ui";
import type { FailedWorkbench } from "../workbenches";
import { useAiBridge, type AiChatRequest } from "./ai-bridge";

import { pickDefaultAgent } from "../../lib/default-agent";
import { useAgentsOn, useMachineInfo } from "../../lib/machine-agent-lists";
import { S } from "../../lib/strings";
import { useProject } from "../../state/project";

/**
 * The chat a repair opens: the default Agent of the server the workbench lives on (see
 * pickDefaultAgent), that server's temporary Workspace, and the prompt. `machineLabel` is the
 * machine's alias when the page knows it. Null when that server has no Agent to hand it to.
 */
export function workbenchRepairRequest(
  target: FailedWorkbench,
  agents: readonly AgentSummary[],
  machineLabel: string | null = null,
): AiChatRequest | null {
  const agent = pickDefaultAgent(agents);
  if (agent === null) return null;
  return {
    agentId: agent.agentId,
    text: S.workbenches.repairPrompt({
      id: target.workbenchId,
      name: target.name,
      agentId: target.agentId,
      machine: target.machineId === null ? null : { label: machineLabel },
      error: target.error,
    }),
    workspace: "",
    machineId: target.machineId,
  };
}

/** `repair(target)` asks first; `modal` is the question, to render once on the page. */
export function useWorkbenchRepair(): {
  repair: (target: FailedWorkbench) => void;
  modal: ReactNode;
} {
  const { openAiChat } = useAiBridge();
  const [pending, setPending] = useState<FailedWorkbench | null>(null);
  // The Agents of the server the workbench in question lives on: one of them takes the repair.
  const machineId = pending?.machineId ?? null;
  const agents = useAgentsOn(machineId);
  const machine = useMachineInfo(machineId);
  const confirm = () => {
    if (pending === null) return;
    const request = workbenchRepairRequest(pending, agents, machine?.label ?? null);
    setPending(null);
    if (request === null) {
      toastError(S.plugins.repairNoAgent);
      return;
    }
    openAiChat(request);
  };
  const modal =
    pending === null ? null : (
      <ConfirmModal
        open
        title={S.plugins.repairTitle(pending.name)}
        tone="primary"
        glyph={ICONS.wand}
        confirmLabel={S.plugins.repairOpen}
        cancelLabel={S.common.cancel}
        onClose={() => setPending(null)}
        onConfirm={confirm}
      >
        <p>{S.plugins.repairBody(pending.name)}</p>
      </ConfirmModal>
    );
  return { repair: setPending, modal };
}

/** The secondary button beside a failed pane's Reload, with the question it asks. */
export function WorkbenchRepairButton({ target }: { target: FailedWorkbench }) {
  const { currentProject, agentsLoading } = useProject();
  const { repair, modal } = useWorkbenchRepair();
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        // Until the Project and its Agents are read there is no Agent to hand the repair to, nor a
        // draft to keep its prompt in: a moment, on a window opened by its address.
        disabled={currentProject === null || agentsLoading}
        onClick={() => repair(target)}
      >
        <GlyphIcon d={ICONS.sparkles} />
        {S.plugins.repair}
      </Button>
      {modal}
    </>
  );
}
