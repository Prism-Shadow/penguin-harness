/**
 * Word timings for narration, and the audio providers that produce them.
 *
 * Forced alignment looks like an optional extra until you notice what depends on it: a book
 * activity highlights each word as it is spoken, and the highlighting comes from these
 * timings. Drop them and the read-along silently stops reading along — narration plays, no
 * word lights up, and nothing reports a fault.
 *
 * So the rules here are strict on purpose, and they are Loom's, out of
 * `book/alignment.py`: the timings must cover the script's visible words, in order, one
 * per word, non-overlapping and ascending.
 */

export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
}

/**
 * The words a script actually speaks.
 *
 * Punctuation is not spoken, so it is not aligned. Splitting on whitespace and then
 * stripping non-word characters is what Loom does, and it means `"cat,"` and `"cat"` are
 * the same word for alignment purposes.
 *
 * Neither are bracketed audio tags: `[pause]`, `[short pause]`, `[very slowly]` direct the
 * voice and are never said, so a provider's timings skip them. Loom's scripts carry them
 * (its word-pronunciation lines are built with them), and counting one as a word would
 * push every later timing onto the wrong word.
 */
export function visibleWords(script: string): string[] {
  return script
    .replace(/\[[^\]\n]*\]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}'-]+/gu, ""))
    .filter(Boolean);
}

/** Whether a value is a whole, non-negative count of milliseconds. */
function isMilliseconds(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * What is wrong with an alignment, or an empty list.
 *
 * Every problem is collected rather than thrown at the first, because an author looking at
 * a broken read-along wants to know whether one word is off or the whole clip is against
 * the wrong script.
 */
export function alignmentProblems(script: string, timings: readonly unknown[]): string[] {
  const problems: string[] = [];
  const expected = visibleWords(script);
  if (!expected.length) return ["The narration script contains no spoken words to align."];
  if (timings.length !== expected.length) {
    problems.push(
      `The alignment has ${timings.length} ${timings.length === 1 ? "timing" : "timings"} for ${expected.length} spoken ${expected.length === 1 ? "word" : "words"}.`,
    );
  }

  let previousEnd = 0;
  timings.forEach((raw, index) => {
    const at = `Timing ${index + 1}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      problems.push(`${at} is not a timing entry.`);
      return;
    }
    const entry = raw as Record<string, unknown>;
    if (!isMilliseconds(entry["startMs"])) {
      problems.push(`${at} has no whole, non-negative startMs.`);
      return;
    }
    if (!isMilliseconds(entry["endMs"])) {
      problems.push(`${at} has no whole, non-negative endMs.`);
      return;
    }
    const startMs = entry["startMs"];
    const endMs = entry["endMs"];
    if (endMs <= startMs) problems.push(`${at} ends at or before it starts.`);
    // Ascending and non-overlapping: a highlight that starts before the previous word
    // finished highlights two words at once.
    else if (startMs < previousEnd)
      problems.push(
        `${at} starts at ${startMs}ms, before the previous word ended at ${previousEnd}ms.`,
      );
    else previousEnd = endMs;

    const word = entry["word"];
    const wanted = expected[index];
    if (wanted !== undefined && typeof word === "string" && word) {
      const normalized = visibleWords(word)[0] ?? "";
      if (normalized.toLowerCase() !== wanted.toLowerCase())
        problems.push(`${at} says "${word}" where the script says "${wanted}".`);
    }
  });

  return problems;
}

/**
 * The alignment as it should be stored, or null when it cannot be trusted.
 *
 * A timing entry with no word of its own takes the script's, so a provider that returns
 * offsets without text still produces a usable sidecar.
 */
export function normalizeAlignment(
  script: string,
  timings: readonly unknown[],
): WordTiming[] | null {
  if (alignmentProblems(script, timings).length) return null;
  const expected = visibleWords(script);
  return timings.map((raw, index) => {
    const entry = raw as Record<string, unknown>;
    const word =
      typeof entry["word"] === "string" && entry["word"] ? entry["word"] : expected[index]!;
    return { word, startMs: entry["startMs"] as number, endMs: entry["endMs"] as number };
  });
}

/**
 * What a manifest records about a clip.
 *
 * Only what is actually known. A provider with no native timestamps adds nothing rather
 * than an empty array — an empty `wordTimings` reads as "aligned, no words", and a book
 * reader would then report highlighting as available and highlight nothing.
 */
export function timingManifestFields(
  timings: readonly WordTiming[] | null | undefined,
  durationMs: number | null | undefined,
): { wordTimings?: WordTiming[]; durationMs?: number } {
  const fields: { wordTimings?: WordTiming[]; durationMs?: number } = {};
  if (timings && timings.length) fields.wordTimings = [...timings];
  if (isMilliseconds(durationMs)) fields.durationMs = durationMs;
  return fields;
}

/**
 * Whether a clip can drive word highlighting.
 *
 * Asked explicitly so a reader can say "narration without highlighting" rather than
 * playing audio and leaving an author to wonder why nothing lights up.
 */
export function supportsHighlighting(fields: { wordTimings?: readonly WordTiming[] }): boolean {
  return Boolean(fields.wordTimings?.length);
}
