/**
 * The subagent row: what a spawned child session leaves in the parent's transcript (the child's
 * own conversation lives elsewhere, in the app's subagents panel). A full-width bar in the family
 * of the transcript's other collapsed rows — the work group's header, the thinking row: a ruled
 * box on the muted ground, content left-aligned — holding the agent's avatar, its name and a short
 * session id, the spinner while the child runs, and an attention dot while an approval is pending
 * anywhere under it, so a nested approval stays discoverable with the panel closed. Pressing it
 * opens the child.
 *
 * The row's accessible name is the caller's (it folds in the waiting state the dot shows); the
 * spinner and the dot are decoration beside it.
 */
import { AgentAvatar } from "../../icons/avatars/agent-avatar";
import { Dot } from "../../icons/dot/dot";
import { Spinner } from "../../icons/spinner/spinner";

export interface SubagentChipProps {
  /** The child's agent, by name. */
  label: string;
  /** The row's accessible name and tooltip ("Subagent Researcher · Awaiting approval"). */
  name: string;
  /** What the avatar's colour hashes: the agent id, or the session id when none is known. */
  avatarId: string;
  /** A short id after the name (the child session's), telling two runs of one agent apart. */
  tag?: string;
  /** The child is running: the spinner shows. */
  running: boolean;
  /** An approval waits somewhere under the child: the attention dot shows. */
  pending: boolean;
  onOpen?: () => void;
}

export function SubagentChip({
  label,
  name,
  avatarId,
  tag,
  running,
  pending,
  onOpen,
}: SubagentChipProps) {
  return (
    <button
      type="button"
      aria-label={name}
      data-tooltip={name}
      onClick={onOpen}
      className="flex w-full items-center gap-2 rounded-md border border-line bg-surface-muted px-3 py-2 text-left transition-colors duration-150 hover:bg-line-muted"
    >
      <AgentAvatar id={avatarId} name={label} size={16} />
      <span className="min-w-0 truncate text-xs font-medium text-fg">{label}</span>
      {tag !== undefined && tag !== "" && (
        <span className="shrink-0 font-mono text-xs text-fg-subtle">{tag}</span>
      )}
      {running && (
        <span aria-hidden className="flex shrink-0 text-fg-subtle">
          <Spinner size="xs" label="" />
        </span>
      )}
      {pending && <Dot tone="attention" />}
      <span className="min-w-0 flex-1" />
    </button>
  );
}
