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
import { useEffect, useState, type ReactNode } from "react";

import type { AgentSummary } from "@prismshadow/penguin-server/api";
import { Button, ConfirmModal, GlyphIcon, ICONS, toastError } from "@prismshadow/penguin-ui";
import type { FailedWorkbench } from "../../lib/workbench-load-failure";
import { useAiBridge, type AiChatRequest } from "./ai-bridge";

import { apiErrorText } from "../../lib/api-error";
import { pickDefaultAgent } from "../../lib/default-agent";
import { failureOf, toldFailure } from "../../lib/failure";
import { readMachineAgents, useMachineInfo } from "../../lib/machine-agent-lists";
import { S } from "../../lib/strings";
import { toastFailure } from "../../lib/toast-api-error";
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

/**
 * `repair(target)` asks first; `modal` is the question, to render once on the page; `busy` while
 * the confirmed repair reads the Agents it picks from.
 *
 * The default Agent is picked from the list of the server the workbench lives on, read when the
 * user confirms rather than taken from whatever a page read before: a machine's list is held only
 * once a page that lists Agents has asked that machine, and an empty hold is no proof that the
 * machine has no Agent. A machine's list goes through the store every page shares (it answers from
 * a fresh read, or asks the machine, joining a read in flight); this server's is the Project's,
 * read again only while it has not arrived. Only a list that came back empty says there is no
 * Agent; a read that failed says so, with its report.
 */
export function useWorkbenchRepair(): {
  repair: (target: FailedWorkbench) => void;
  modal: ReactNode;
  busy: boolean;
} {
  const { openAiChat } = useAiBridge();
  const { currentProject, agents: localAgents, agentsLoading, reloadAgents } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const [pending, setPending] = useState<FailedWorkbench | null>(null);
  const [busy, setBusy] = useState(false);
  /** A repair on this server whose Project list was just read: picked on the render that has it. */
  const [readHere, setReadHere] = useState<FailedWorkbench | null>(null);
  const machine = useMachineInfo(pending?.machineId ?? null);

  const settle = () => {
    setBusy(false);
    setPending(null);
  };
  const open = (target: FailedWorkbench, agents: readonly AgentSummary[], label: string | null) => {
    settle();
    const request = workbenchRepairRequest(target, agents, label);
    if (request === null) {
      toastError(S.plugins.repairNoAgent);
      return;
    }
    openAiChat(request);
  };
  // The Project's store has applied the list by the time the read resolves, so the render that
  // carries `readHere` reads it.
  useEffect(() => {
    if (readHere === null) return;
    setReadHere(null);
    open(readHere, localAgents, null);
  }, [readHere]);

  const confirm = () => {
    const target = pending;
    if (target === null || projectId === null || busy) return;
    if (target.machineId === null && !agentsLoading) {
      open(target, localAgents, null);
      return;
    }
    setBusy(true);
    if (target.machineId === null) {
      reloadAgents().then(
        () => setReadHere(target),
        (err: unknown) => {
          settle();
          toastFailure(
            failureOf(err, {
              text: S.workbenches.repairAgentsFailed(apiErrorText(err)),
              what: "the Agents to hand a workbench repair to could not be read",
            }),
          );
        },
      );
      return;
    }
    const label = machine?.label ?? null;
    readMachineAgents(projectId, target.machineId).then(
      (agents) => open(target, agents, label),
      (err: unknown) => {
        settle();
        // The store keeps a failed read as words (and rejects with them), which a machine's
        // answer can fill with its host names: they are masked as in every machine report.
        const words = err instanceof Error && err.message !== "" ? err.message : null;
        toastFailure(
          toldFailure(S.workbenches.repairAgentsFailed(words ?? S.common.unknownError), {
            what: "a machine's Agents could not be read for a workbench repair",
            detail: words,
            mask: { hosts: true, values: label === null ? [] : [label] },
          }),
        );
      },
    );
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
        busy={busy}
        onClose={() => {
          if (!busy) setPending(null);
        }}
        onConfirm={confirm}
      >
        <p>{S.plugins.repairBody(pending.name)}</p>
      </ConfirmModal>
    );
  return { repair: setPending, modal, busy };
}

/** The secondary button beside a failed pane's Reload, with the question it asks. */
export function WorkbenchRepairButton({ target }: { target: FailedWorkbench }) {
  const { currentProject } = useProject();
  const { repair, modal, busy } = useWorkbenchRepair();
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        // No draft to keep the prompt in until the Project is read: a moment, on a window opened
        // by its address.
        disabled={currentProject === null}
        loading={busy}
        leading={<GlyphIcon d={ICONS.sparkles} />}
        onClick={() => repair(target)}
      >
        {S.plugins.repair}
      </Button>
      {modal}
    </>
  );
}
