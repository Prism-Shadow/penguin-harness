/**
 * "Ask AI" from a Benchmark detail dialog: the Create-with-AI kit's dialog, seeded with a
 * question rather than a description of something to build, and carrying the facts already on
 * screen as its fixed tail. The two dialogs that open it — one evaluation, one case — differ
 * only in their question, their examples and that tail, so everything else is settled here:
 * the Project's agents, and therefore the default agent the kit hands the prompt to, and the
 * one way out, which prefills a new conversation and leaves pressing Send to the reader.
 */
import { useProject } from "../../state/project";
import { AiCreateModal } from "../ai-create";
import type { AiExample } from "../ai-create";

export interface AskAiModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** One line under the title saying what the agent is given and what it does with it. */
  description: string;
  /** Seeds the prompt box; the reader edits it before sending. */
  question: string;
  examples: AiExample[];
  /** The structured facts appended after the question, previewed in the dialog's prompt fold. */
  tail: string;
}

export function AskAiModal({
  open,
  onClose,
  title,
  description,
  question,
  examples,
  tail,
}: AskAiModalProps) {
  const { agents } = useProject();
  return (
    <AiCreateModal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      initialValue={question}
      examples={examples}
      tail={tail}
      agents={agents}
    />
  );
}
