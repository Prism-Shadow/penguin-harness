/**
 * "Create with AI" as a dialog: AiCreatePanel plus one way out — the prompt lands in a new
 * conversation's composer, prefilled, for the user to read, edit and send. The dialog never
 * sends anything itself, so no surface has to weigh whether its prompt is safe to submit unread.
 * It owns the draft and the agent pick, and mounts its body fresh on every open, so a reopened
 * dialog starts from `initialValue` again.
 */
import { useState } from "react";
import { S } from "../../lib/strings";
import { Button } from "../../components/ui/button";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { MAGIC_WAND_ICON } from "../../components/ui/icons";
import { Modal } from "../../components/ui/modal";
import { useAiBridge } from "./ai-bridge";
import { AiCreatePanel } from "./ai-create-panel";
import type { AiCreatePanelProps } from "./ai-create-panel";
import { composeAiPrompt } from "./ai-create-prompt";
import { pickDefaultAgent } from "./default-agent";

export interface AiCreateModalProps extends Omit<
  AiCreatePanelProps,
  "value" | "onChange" | "agentId" | "onAgentChange"
> {
  open: boolean;
  onClose: () => void;
  title: string;
  /** One line under the title saying what the agent will create. */
  description?: string;
  /** Seeds the draft each time the dialog opens. */
  initialValue?: string;
  /** The preselected agent; defaults to pickDefaultAgent(agents). */
  agentId?: string | null;
  /** Pins the new conversation's Workspace ("" is the temporary Workspace). */
  workspace?: string;
  /** Skills to preselect in the new conversation's composer. */
  skills?: string[];
}

export function AiCreateModal(props: AiCreateModalProps) {
  // Mounted only while open, so the body's state (draft, agent pick) starts fresh every time.
  return props.open ? <AiCreateDialog {...props} /> : null;
}

function AiCreateDialog({
  open,
  onClose,
  title,
  description,
  initialValue,
  agentId: initialAgentId,
  workspace,
  skills,
  tail,
  agents,
  ...panel
}: AiCreateModalProps) {
  const { openAiChat } = useAiBridge();
  const [value, setValue] = useState(initialValue ?? "");
  const [picked, setPicked] = useState<string | null>(null);
  // An explicit pick wins, then the caller's choice, then the Project's default agent — resolved
  // on every render, so an agent list that loads after the dialog opened still yields one.
  const agentId = picked ?? initialAgentId ?? pickDefaultAgent(agents)?.agentId ?? null;
  const ready = agentId !== null && value.trim() !== "";

  const go = () => {
    if (agentId === null) return;
    openAiChat({
      agentId,
      text: composeAiPrompt(value, tail),
      ...(workspace !== undefined ? { workspace } : {}),
      ...(skills !== undefined ? { skills } : {}),
    });
    onClose();
  };

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      widthClass="sm:max-w-xl"
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            {S.common.cancel}
          </Button>
          {/*
            One exit, and its label says where the prompt goes rather than what happens to it:
            the wand marks it as the AI path, and pressing Send is still the user's own move on
            the next screen. Disabled until there is a prompt and an agent to take it.
          */}
          <Button size="sm" variant="primary" disabled={!ready} onClick={go}>
            <GlyphIcon d={MAGIC_WAND_ICON} />
            {S.aiCreate.editInChat}
          </Button>
        </>
      }
    >
      {description !== undefined && (
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">{description}</p>
      )}
      <AiCreatePanel
        {...panel}
        agents={agents}
        value={value}
        onChange={setValue}
        agentId={agentId}
        onAgentChange={setPicked}
        {...(tail !== undefined ? { tail } : {})}
      />
    </Modal>
  );
}
