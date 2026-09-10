/**
 * "Create with AI" for the conversation on screen: AiCreatePanel with the schedule examples
 * and the in-Session instruction tail, prefilled into THIS conversation's composer rather than
 * a new one's — the built-in Scheduled Tasks guidance binds a task created from inside a
 * conversation to that conversation by default, so the agent that already holds the context is
 * the one asked. Like every other "Create with AI" surface, the dialog composes the prompt and
 * stops there (the panel's own fold is where it is copied from): pressing Send is the user's
 * move, on text they have read. Mounted fresh on every open, like AiCreateModal.
 */
import { useState } from "react";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { agentDisplayName } from "../../state/project";
import { Button } from "../../components/ui/button";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { MAGIC_WAND_ICON } from "../../components/ui/icons";
import { Modal } from "../../components/ui/modal";
import { AiCreatePanel, composeAiPrompt } from "../ai-create";
import { scheduleExamples } from "./schedule-suggestions";

export interface ScheduleAiModalProps {
  open: boolean;
  onClose: () => void;
  /** Seeds the draft each time the dialog opens (a suggestion's prompt). */
  initialValue?: string;
  agents: readonly AgentSummary[];
  /** The Session's own agent: no choice is offered, the task lands in this conversation. */
  agentId: string;
  /** Writes the composed prompt into this conversation's composer (the chat page's ComposerControl). */
  onPrefill: (text: string) => void;
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
  onPrefill,
}: ScheduleAiModalProps) {
  const [value, setValue] = useState(initialValue ?? "");
  const tail = S.schedule.aiCreateInSessionTail;
  const filled = value.trim() !== "";
  const agent = agents.find((a) => a.agentId === agentId) ?? null;

  const go = () => {
    onPrefill(composeAiPrompt(value, tail));
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
          {/*
            One exit, and its label says where the prompt goes rather than what happens to it.
            Copying lives on the prompt fold's own CopyButton (AiCreatePanel), which flips its
            glyph in place; a second copy control here would answer with a toast instead.
          */}
          <Button variant="primary" disabled={!filled} onClick={go}>
            <GlyphIcon d={MAGIC_WAND_ICON} />
            {S.schedule.editInSession}
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
      />
    </Modal>
  );
}
