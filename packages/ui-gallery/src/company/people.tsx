/**
 * An employee where its work shows: its name, then its title in quieter ink, so a byline says who
 * did the work and what they do. `whoOf` is the same as one line of text, for a hint or a row
 * label that takes a string.
 */
import { AgentAvatar } from "@prismshadow/penguin-ui";
import { EMPLOYEES } from "./fixtures";
import type { Byline } from "./fixtures";
import { useWords } from "./use-words";
import type { Words } from "./words";

export const whoOf = (byline: Byline, W: Words): string =>
  W.who(W.people[byline].name, W.people[byline].title);

export function PersonName({ byline }: { byline: Byline }) {
  const W = useWords();
  const person = W.people[byline];
  return (
    <span>
      <span className="text-fg">{person.name}</span>{" "}
      <span className="text-fg-muted">{person.title}</span>
    </span>
  );
}

/** An employee's avatar, in the colour its Agent id gives it. */
export function PersonAvatar({ byline, size }: { byline: Byline; size: number }) {
  return <AgentAvatar id={EMPLOYEES[byline].agentId} size={size} />;
}
