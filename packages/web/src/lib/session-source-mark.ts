/**
 * The source mark of a Session a program opened (the Agent API, a scheduled task or `penguin
 * run`), as a registry glyph and the tooltip that names it — the mark a sidebar row carries once
 * the user has unarchived such a Session. The archive page and the archived stub name the source
 * in words instead, in a pill (programSource gives the source, `S.chat.sessionSource` the word).
 *
 * A scheduled task's run takes the calendar, not the alarm clock: the alarm is the separate mark
 * of a scheduled task still to fire into a conversation (the row's `scheduledLabel`), and one
 * row must never show two alarms that mean different things.
 */
import type { SessionInfo, SessionSource } from "@prismshadow/penguin-server/api";
import { ICONS } from "@prismshadow/penguin-ui";
import { S } from "./strings";

/** The sources a program opens a Session for: a person's, a subagent and a company Session are none of them. */
export type ProgramSource = Extract<SessionSource, "api" | "schedule" | "cli">;

const SOURCE_GLYPHS: Record<ProgramSource, string> = {
  api: ICONS.plug,
  schedule: ICONS.calendar,
  cli: ICONS.terminalPrompt,
};

/** A row's source mark, as `SessionRow` takes it. */
export interface SourceMark {
  sourceGlyph: string;
  sourceLabel: string;
}

/** The program that opened a Session; null for a person's conversation and any other. */
export function programSource(s: Pick<SessionInfo, "source">): ProgramSource | null {
  return isProgramSource(s.source) ? s.source : null;
}

/** A row's squad mark, as `SessionRow` takes it (same dim cluster as the source mark). */
export interface SquadMark {
  squadGlyph: string;
  squadLabel: string;
}

/** The mark of a Session a program opened; null for any other. */
export function backgroundSourceMark(s: SessionInfo): SourceMark | null {
  const source = programSource(s);
  if (source === null) return null;
  return { sourceGlyph: SOURCE_GLYPHS[source], sourceLabel: S.chat.sessionSource[source] };
}

function isProgramSource(source: SessionSource | undefined): source is ProgramSource {
  return source === "api" || source === "schedule" || source === "cli";
}

/**
 * A row's squad mark: the multi-agent work group (`run_subagent` squad arg) plus the
 * short parent id when parentage is known. Drawn wherever the row is filed (not only
 * the Background folder — a squad child can surface in search too); archived rows stay
 * unmarked like every other provenance mark.
 */
export function squadMark(s: SessionInfo): SquadMark | null {
  if (s.archived || !s.squad) return null;
  const parent =
    s.parentSessionId && s.parentSessionId !== s.sessionId
      ? s.parentSessionId.slice(-6)
      : undefined;
  return { squadGlyph: ICONS.users, squadLabel: S.chat.squadSession(s.squad, parent) };
}
