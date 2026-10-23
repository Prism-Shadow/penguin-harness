/**
 * The mark a Trace view puts where the thinking level changes: the new level's name as a label
 * pill, and the switch itself ("medium → high") on hover. `info`, the tone of a fact worth
 * noticing — a level is not a state, nothing about it is good or bad. The `request_begin` row at
 * the change and that round's navigator row both wear it; the round head does not.
 */
import { Pill } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import type { LevelChange } from "./trace-levels";

/** A level's display name; a spelling the dictionary does not know shows as recorded. */
function levelName(level: string): string {
  return S.chat.thinkingLevelNames[level] ?? level;
}

export function LevelPill({ change }: { change: LevelChange }) {
  const to = levelName(change.to);
  const tooltip =
    change.from === null
      ? S.traces.levelFirst(to)
      : S.traces.levelChanged(levelName(change.from), to);
  return (
    <Pill tone="info" tooltip={tooltip}>
      {to}
    </Pill>
  );
}
