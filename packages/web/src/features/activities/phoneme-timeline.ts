/**
 * The pure model behind a word pronunciation's sound timeline: each sound of its recording and
 * then the whole word, with when each is said, and which one the player is on. The same rule
 * as the book's configuration: timings stored for the word's current sounds, else the two word
 * timings of a recording (a word imported from Loom) shared out between the sounds.
 */
import type { AssetManifest } from "@prismshadow/penguin-server/api";

type MediaAsset = AssetManifest["assets"][string][number];

export interface TimelineCue {
  /** A sound, or the word itself for the last cue. */
  label: string;
  startMs: number;
  endMs: number;
  whole: boolean;
}

function projected(
  phonemes: readonly string[],
  timings: readonly { startMs: number; endMs: number }[],
): TimelineCue[] | null {
  if (timings.length !== 2) return null;
  const [slow, fluent] = timings as [
    { startMs: number; endMs: number },
    { startMs: number; endMs: number },
  ];
  const span = slow.endMs - slow.startMs;
  if (span < phonemes.length || fluent.startMs < slow.endMs || fluent.endMs <= fluent.startMs)
    return null;
  return phonemes.map((phoneme, index) => ({
    label: phoneme,
    startMs: slow.startMs + Math.round((index * span) / phonemes.length),
    endMs: slow.startMs + Math.round(((index + 1) * span) / phonemes.length),
    whole: false,
  }));
}

/**
 * The cues of a recorded word, sounds first and the whole word last, or null when the word has
 * no recording, no sounds, or a recording that was not timed (every Gemini recording).
 */
export function wordTimeline(asset: MediaAsset): TimelineCue[] | null {
  const phonemes = asset.phonemes ?? [];
  if (!asset.path || !phonemes.length) return null;
  const word = asset.word ?? asset.normalizedWord ?? "";
  const stored = asset.phonemeTimings;
  if (
    stored?.length === phonemes.length &&
    stored.every((timing, index) => timing.phoneme === phonemes[index]) &&
    asset.wholeWordTiming
  )
    return [
      ...stored.map((timing) => ({
        label: timing.phoneme,
        startMs: timing.startMs,
        endMs: timing.endMs,
        whole: false,
      })),
      { label: word, ...asset.wholeWordTiming, whole: true },
    ];
  const sounds = asset.wordTimings ? projected(phonemes, asset.wordTimings) : null;
  if (!sounds) return null;
  const fluent = asset.wordTimings![1]!;
  return [...sounds, { label: word, startMs: fluent.startMs, endMs: fluent.endMs, whole: true }];
}

/** The cue being said at `ms` into the recording, or -1 between and outside them. */
export function activeCue(cues: readonly TimelineCue[], ms: number): number {
  return cues.findIndex((cue) => ms >= cue.startMs && ms < cue.endMs);
}

/** A language group's words: ready to record (sounds, no recording), and recorded untimed. */
export function wordRecordingTally(group: readonly MediaAsset[]): {
  toRecord: number;
  untimed: number;
} {
  const words = group.filter((asset) => asset.role === "bookWord");
  return {
    toRecord: words.filter((asset) => !asset.path && !!asset.phonemes?.length).length,
    untimed: words.filter((asset) => !!asset.path && wordTimeline(asset) === null).length,
  };
}
