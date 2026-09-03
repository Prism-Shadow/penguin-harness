/**
 * "Create with AI" for the conversation on screen: AiCreatePanel with the schedule examples
 * and the in-Session instruction tail, sent INTO the current Session rather than to a new one
 * — the built-in Scheduled Tasks guidance binds a task created from inside a conversation to
 * that conversation by default, so the agent that already holds the context is the one asked.
 * Delivery is the chat page's (a task when idle, a steering message while a Task runs — its
 * approval and queue rules apply unchanged); the dialog only composes the prompt (the
 * panel's own fold is where it is copied from). Mounted fresh on every open, like AiCreateModal.
 */
import { useState } from "react";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { agentDisplayName } from "../../state/project";
import { Button } from "../../components/ui/button";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { MAGIC_WAND_ICON } from "../../components/ui/icons";
import { Modal } from "../../components/ui/modal";
import { toastSuccess } from "../../components/ui/toast";
import { AiCreatePanel, composeAiPrompt } from "../ai-create";
import { scheduleExamples } from "./schedule-suggestions";

/** How the chat page delivered the prompt: as a new task, as a steering message into the running one, or not at all (the page has toasted the error). */
export type SessionSendOutcome = "sent" | "steered" | "failed";

export interface ScheduleAiModalProps {
  open: boolean;
  onClose: () => void;
  /** Seeds the draft each time the dialog opens (a suggestion's prompt). */
  initialValue?: string;
  agents: readonly AgentSummary[];
  /** The Session's own agent: no choice is offered, the task lands in this conversation. */
  agentId: string;
  /** The chat page's delivery into the current Session. */
  onSend: (text: string) => Promise<SessionSendOutcome>;
}

export function ScheduleAiModal(props: ScheduleAiModalProps) {
  // Mounted only while open, so the draft starts from `initialValue` every time.
  return props.open ? <ScheduleAiDialog {...props} /> : null;
}

function ScheduleAiDialog({
  open,
  onClose,
  initialValue,
  agents,
  agentId,
  onSend,
}: ScheduleAiModalProps) {
  const [value, setValue] = useState(initialValue ?? "");
  const [sending, setSending] = useState(false);
  const tail = S.schedule.aiCreateInSessionTail;
  const prompt = composeAiPrompt(value, tail);
  const filled = value.trim() !== "";
  const agent = agents.find((a) => a.agentId === agentId) ?? null;

  const send = async () => {
    setSending(true);
    const outcome = await onSend(prompt);
    if (outcome === "failed") {
      // The page has toasted the error; the draft stays for another try.
      setSending(false);
      return;
    }
    toastSuccess(outcome === "steered" ? S.schedule.steeredToSession : S.schedule.sentToSession);
    onClose();
  };

  return (
    <Modal
      open={open}
      title={S.schedule.aiCreateTitle}
      onClose={onClose}
      widthClass="sm:max-w-xl"
      footer={
        <>
          <Button onClick={onClose}>{S.common.cancel}</Button>
          {/* Copying lives on the prompt fold's own CopyButton (AiCreatePanel), which flips
              its glyph in place; a second copy control here would answer with a toast instead. */}
          <Button variant="primary" disabled={!filled || sending} onClick={() => void send()}>
            <GlyphIcon d={MAGIC_WAND_ICON} />
            {S.schedule.sendToSession}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
        {S.schedule.aiCreateInSessionDesc}
      </p>
      <AiCreatePanel
        value={value}
        onChange={setValue}
        examples={scheduleExamples("session")}
        tail={tail}
        agents={agents}
        agentId={agentId}
        byLine={agent !== null ? S.schedule.byAgentInSession(agentDisplayName(agent)) : null}
        disabled={sending}
      />
    </Modal>
  );
}
