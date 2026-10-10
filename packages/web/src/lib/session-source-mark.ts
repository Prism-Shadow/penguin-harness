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

/** The sources the Background folder holds: a person's and a company Session are never in it. */
type BackgroundSource = Exclude<SessionSource, "user" | "company">;

const SOURCE_GLYPHS: Record<BackgroundSource, string> = {
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

/** The mark of a row in the Background folder; null for any other row. */
export function backgroundSourceMark(s: SessionInfo): SourceMark | null {
  const source = s.source;
  if (sessionCategory(s) !== "background" || !isBackgroundSource(source)) return null;
  return { sourceGlyph: SOURCE_GLYPHS[source], sourceLabel: S.chat.sessionSource[source] };
}

function isBackgroundSource(source: SessionSource | undefined): source is BackgroundSource {
  return source !== undefined && source !== "user" && source !== "company";
}
