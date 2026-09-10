/**
 * "Create with AI" as a dialog: AiCreatePanel plus the two ways out — send the prompt to the
 * agent in a new conversation (submitted on arrival), or open that conversation with the prompt
 * prefilled for editing. The dialog owns the draft and the agent pick, and mounts its body fresh
 * on every open, so a reopened dialog starts from `initialValue` again. Which of the two exits
 * the footer emphasises is the surface's call (`primaryExit`) — a surface that warns about what
 * the prompt carries should not lead with the button that sends it unread.
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
  /**
   * Which of the two exits the footer emphasises; "send" by default. A surface whose own copy
   * warns about what the prompt will carry — a secret typed into it reaching the model provider,
   * the Trace and a command line — sets "edit", so the emphasised, rightmost button is
   * "Edit in a new conversation", the exit that copy recommends. Both exits stay available
   * either way; only the emphasis and their order change.
   */
  primaryExit?: PrimaryExit;
}

/** The emphasised exit of the dialog's footer (see AiCreateModalProps.primaryExit). */
export type PrimaryExit = "send" | "edit";

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
  primaryExit = "send",
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

  const go = (autoSend: boolean) => {
    if (agentId === null) return;
    openAiChat({
      agentId,
      text: composeAiPrompt(value, tail),
      ...(workspace !== undefined ? { workspace } : {}),
      ...(skills !== undefined ? { skills } : {}),
      autoSend,
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
        <AiCreateFooter primaryExit={primaryExit} ready={ready} onCancel={onClose} onGo={go} />
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

/**
 * The dialog's footer: Cancel, then the two exits. The emphasised one sits rightmost — last on
 * the path the eye and the pointer take across a right-aligned footer — so `primaryExit` moves
 * both the accent and the position together; anything else would emphasise one button and put
 * another under the pointer. The wand stays welded to "Send to agent" in either order: it names
 * that action, and a label that gains and loses its icon by position reads as two different
 * buttons. Split out of the dialog because the dialog itself cannot be rendered without a router
 * and a portal, and the order of these three is worth a test.
 */
export function AiCreateFooter({
  primaryExit,
  ready,
  onCancel,
  onGo,
}: {
  primaryExit: PrimaryExit;
  /** Both exits need a prompt and an agent; Cancel never does. */
  ready: boolean;
  onCancel: () => void;
  /** Takes an exit: true submits the prompt on arrival, false opens the conversation for editing. */
  onGo: (autoSend: boolean) => void;
}) {
  const send = (
    <Button
      variant={primaryExit === "send" ? "primary" : "secondary"}
      disabled={!ready}
      onClick={() => onGo(true)}
    >
      <GlyphIcon d={MAGIC_WAND_ICON} />
      {S.aiCreate.send}
    </Button>
  );
  const edit = (
    <Button
      variant={primaryExit === "edit" ? "primary" : "secondary"}
      disabled={!ready}
      onClick={() => onGo(false)}
    >
      {S.aiCreate.editInChat}
    </Button>
  );
  const [first, second] = primaryExit === "edit" ? [send, edit] : [edit, send];
  return (
    <>
      <Button onClick={onCancel}>{S.common.cancel}</Button>
      {first}
      {second}
    </>
  );
}
