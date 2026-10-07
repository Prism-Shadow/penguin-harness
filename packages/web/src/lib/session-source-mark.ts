/**
 * The source mark a row of the sidebar's Background folder carries: which program opened the
 * Session (the Agent API, a scheduled task, a parent agent or `penguin run`), as a registry
 * glyph and the tooltip that names it.
 *
 * A scheduled task's run takes the calendar, not the alarm clock: the alarm is the separate mark
 * of a scheduled task still to fire into a conversation (the row's `scheduledLabel`), and one
 * row must never show two alarms that mean different things.
 */
import type { SessionInfo, SessionSource } from "@prismshadow/penguin-server/api";
import { ICONS } from "@prismshadow/penguin-ui";
import { sessionCategory } from "./session-grouping";
import { S } from "./strings";

const SOURCE_GLYPHS: Record<Exclude<SessionSource, "user">, string> = {
  api: ICONS.plug,
  schedule: ICONS.calendar,
  subagent: ICONS.robotPair,
  cli: ICONS.terminalPrompt,
};

/** A row's source mark, as `SessionRow` takes it. */
export interface SourceMark {
  sourceGlyph: string;
  sourceLabel: string;
}

/** The mark of a row in the Background folder; null for an active or an archived row. */
export function backgroundSourceMark(s: SessionInfo): SourceMark | null {
  if (sessionCategory(s) !== "background" || s.source === undefined || s.source === "user") {
    return null;
  }
  return { sourceGlyph: SOURCE_GLYPHS[s.source], sourceLabel: S.chat.sessionSource[s.source] };
}
