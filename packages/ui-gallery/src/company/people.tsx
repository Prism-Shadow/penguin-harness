/**
 * A member where its work shows: its penguin's name, then its role in quieter ink, so a byline
 * says who did the work and what they do. Every member is named after a penguin species.
 */
import { AgentAvatar } from "@prismshadow/penguin-ui";
import { AGENT_ID, MEMBERS } from "./fixtures";
import type { MemberId } from "./fixtures";
import { useWords } from "./use-words";

export function memberName(id: MemberId, W: ReturnType<typeof useWords>): string {
  return W.species[MEMBERS[id].species];
}

export function PersonAvatar({ id, size }: { id: MemberId; size: number }) {
  return <AgentAvatar id={AGENT_ID[MEMBERS[id].species]} size={size} />;
}

export function PersonName({ id }: { id: MemberId }) {
  const W = useWords();
  return (
    <span className="whitespace-nowrap">
      <span className="text-fg">{memberName(id, W)}</span>{" "}
      <span className="text-fg-muted">{W.roles[id].title}</span>
    </span>
  );
}

/** A member as an avatar and a name, the way a ticket's header lists its hands. */
export function Byline({ id }: { id: MemberId }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <PersonAvatar id={id} size={16} />
      <PersonName id={id} />
    </span>
  );
}
