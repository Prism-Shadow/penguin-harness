/**
 * The text a context opens with, as the chat reads it: a compaction's `[context_summary]` (the
 * summary, or the hand-off note the harness writes in its place when there is none), or the
 * Trace hand-over an in-session model switch opens the context with instead (a whole
 * `[model_switch_from]` block naming this Session; a `/model` new conversation's block names its
 * source and stays a Prompt). Nobody typed either, so neither is a bubble: the reducer folds it
 * into the compaction row it follows (stream-model's foldContextOpening), whose hand-over section
 * shows it with its tags stripped.
 */
import {
  dualFormPatterns,
  MARKER_TAGS,
  matchDualForm,
  parseInPlaceModelSwitch,
} from "@prismshadow/amsp/markers";

export interface ContextOpening {
  /** The record's text, raw. */
  text: string;
  /** A model switch's Trace hand-over, rather than a compaction's opening. */
  switched: boolean;
  /** The Trace file the opening names, when it names one. */
  tracePath?: string;
}

/**
 * A line naming a Trace file: both lines the harness writes read `Trace file …: <path>` — the
 * pointer a summary ends with, and the default hand-off note's own line.
 */
const TRACE_LINE = /^Trace file\b[^:\n]*:[ \t]*(\S[^\n]*?)[ \t]*$/gm;

/**
 * The Trace file a `[context_summary]` names: the last line that names one, since a hand-off note
 * quotes the user's messages above its own line. A template that words the line otherwise names
 * none here, and `(not recorded)`, what an empty placeholder reads, is no file.
 */
function namedTracePath(text: string): string | undefined {
  let path: string | undefined;
  for (const line of text.matchAll(TRACE_LINE)) path = line[1];
  return path === undefined || path.startsWith("(") ? undefined : path;
}

/** The opening `text` is, for the Session `sessionId`; null for any other user text. */
export function contextOpeningOf(
  text: string,
  sessionId: string | undefined,
): ContextOpening | null {
  // The old `<context_summary>` prefix is still recognized: old Traces containing it are
  // re-rendered through the same reducer.
  if (text.startsWith("[context_summary]") || text.startsWith("<context_summary>")) {
    const tracePath = namedTracePath(text);
    return { text, switched: false, ...(tracePath !== undefined ? { tracePath } : {}) };
  }
  const origin = parseInPlaceModelSwitch(text, sessionId);
  if (origin === null) return null;
  return {
    text,
    switched: true,
    ...(origin.tracePath !== undefined ? { tracePath: origin.tracePath } : {}),
  };
}

const OPENING_BLOCKS = [MARKER_TAGS.contextSummary, MARKER_TAGS.modelSwitchFrom].map((tag) =>
  dualFormPatterns(tag, "\\n([\\s\\S]*)\\n"),
);

/**
 * A hand-over's note as its section shows it: the block's own lines, its tags stripped as the
 * result section strips the summary's. Anything but one whole block reads as written.
 */
export function handoverNoteText(text: string): string {
  const trimmed = text.trim();
  for (const patterns of OPENING_BLOCKS) {
    const block = matchDualForm(patterns, trimmed);
    if (block !== null && block.index === 0 && block[0].length === trimmed.length) {
      return block[1]!.trim();
    }
  }
  return trimmed;
}
