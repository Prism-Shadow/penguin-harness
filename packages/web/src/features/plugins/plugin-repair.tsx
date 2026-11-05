/**
 * "Fix with AI" for an installed plugin the running build cannot fully run (the server's
 * `InstalledPlugin.unsatisfied`): a confirm that says what is about to happen, then the same
 * hand-off every "with AI" surface uses — a new chat in a temporary Workspace with the repair
 * prompt in its composer, never sent on the user's behalf. The repair may change an
 * installed plugin, so reading the prompt and pressing send stays the user's step.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import { ConfirmModal, ICONS, toastError } from "@prismshadow/penguin-ui";
import { useAiBridge } from "../ai-create/ai-bridge";
import type { AiChatRequest } from "../ai-create/ai-bridge";
import { pickDefaultAgent } from "../ai-create/default-agent";
import { S } from "../../lib/strings";

/** The plugin to repair, as its row has it. */
export interface RepairTarget {
  specifier: string;
  /** The whole plugin is left out, rather than running without part of itself. */
  disabled: boolean;
  /** The platform's reason, verbatim. */
  reason: string;
}

/**
 * The chat a repair opens: the Agent that carries the preinstalled library (see
 * pickDefaultAgent), the temporary Workspace — the plugin is not in any Workspace of the
 * user's, and a repair must not start inside one — and the prompt. Null when the Project has
 * no Agent to hand it to.
 */
export function repairChatRequest(
  target: RepairTarget,
  agents: readonly AgentSummary[],
): AiChatRequest | null {
  const agent = pickDefaultAgent(agents);
  if (agent === null) return null;
  return {
    agentId: agent.agentId,
    text: S.plugins.repairPrompt(target.specifier, target.disabled, target.reason),
    workspace: "",
  };
}

/** `repair(target)` asks first; `modal` is the question, to render once on the page. */
export function usePluginRepair(agents: readonly AgentSummary[]): {
  repair: (target: RepairTarget) => void;
  modal: ReactNode;
} {
  const { openAiChat } = useAiBridge();
  const [pending, setPending] = useState<RepairTarget | null>(null);
  const confirm = () => {
    if (pending === null) return;
    const request = repairChatRequest(pending, agents);
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
        title={S.plugins.repairTitle(pending.specifier)}
        tone="primary"
        glyph={ICONS.wand}
        confirmLabel={S.plugins.repairOpen}
        cancelLabel={S.common.cancel}
        onClose={() => setPending(null)}
        onConfirm={confirm}
      >
        <p>{S.plugins.repairBody(pending.specifier)}</p>
      </ConfirmModal>
    );
  return { repair: setPending, modal };
}
