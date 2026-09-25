/**
 * How a decodable book's word is recorded, and how its recording is timed sound by sound.
 *
 * A word pronunciation is said twice in one clip: slowly, drawn out sound by sound, and then
 * at its normal pace. Its script says so in the terms its speech provider understands:
 * ElevenLabs' v3 model takes audio tags and IPA, so it is given the sounds with the first
 * vowel held; Gemini takes no IPA, so it is asked in plain words, as a direction rather than
 * text to read. Both hold the same sound, so recordings made with either provider agree.
 *
 * ElevenLabs times the two spoken "words" of that script: the drawn-out sounds and the word.
 * The drawn-out span is shared evenly between the sounds, and the second span is the whole
 * word, which is what the book's reader highlights by. A recording that comes back without
 * exactly those two timings (every Gemini recording) is timed by nothing, never by a guess.
 *
 * Pure: the service and the book configuration call these with what the draft holds.
 */
import { BOOK_WORD_ROLE, bookWordsOf, isBookWord, normalizeWord } from "./book-words.js";
import type { PhonemeTiming, WholeWordTiming } from "./book-word-types.js";
import type { AssetManifest, MediaAsset } from "./media.js";
import type { WordTiming } from "./word-timings.js";

/** The IPA symbols counted as vowels: the first sound holding one is the one drawn out. */
export const VOWELS: ReadonlySet<string> = new Set(Array.from("aeiouyæɐɑɒɔəɛɜɞɚɝɪʊʌøœɵɘɤɯɶʉʏ"));
/** How long the first vowel is held: three IPA length marks. */
const HELD = "ːːː";
/** The longest script a speech run accepts. */
const SCRIPT_MAX = 5000;

function wordText(word: string, phonemes: readonly string[]): string {
  const text = word.trim();
  if (!text || !phonemes.length)
    throw new Error("A drawn-out pronunciation needs a word and its sounds.");
  return text;
}

function holdFirstVowel(phonemes: readonly string[]): string {
  const held = [...phonemes];
  const index = held.findIndex((sound) =>
    Array.from(sound.toLowerCase()).some((symbol) => VOWELS.has(symbol)),
  );
  if (index >= 0) held[index] = `${held[index]}${HELD}`;
  return held.join("");
}

/**
 * The ElevenLabs script: `[very slowly] [drawn out] "/<sounds, first vowel held>/" [short
 * pause] <word>.` The tags direct the voice and are never said.
 */
export function drawnOutScript(word: string, phonemes: readonly string[]): string {
  const text = wordText(word, phonemes);
  return `[very slowly] [drawn out] "/${holdFirstVowel(phonemes)}/" [short pause] ${text}.`;
}

/** The Gemini script: the same request in plain words, since Gemini reads no IPA. */
export function geminiScript(word: string, phonemes: readonly string[]): string {
  const text = wordText(word, phonemes);
  return `Say the word '${text}' very slowly, stretching each sound: ${phonemes.join(" ")}, then say it normally.`;
}

/**
 * The script a word pronunciation is recorded from, for the provider it names (Gemini when it
 * names none, as for narration), or null when it has no sounds yet.
 */
export function wordScript(
  asset: Pick<MediaAsset, "word" | "normalizedWord" | "phonemes" | "speechProvider">,
): string | null {
  const word = asset.word ?? asset.normalizedWord;
  if (!word?.trim() || !asset.phonemes?.length) return null;
  return asset.speechProvider === "elevenlabs"
    ? drawnOutScript(word, asset.phonemes)
    : geminiScript(word, asset.phonemes);
}

const whole = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/**
 * A drawn-out recording's timings as the reader uses them: the slow span shared evenly
 * between the sounds, and the fluent span as the whole word. Null unless there are sounds and
 * exactly two timings, the second after the first; with `word`, the second must also be it.
 */
export function projectPhonemeTimings(
  phonemes: readonly string[] | undefined,
  timings: readonly (Pick<WordTiming, "startMs" | "endMs"> & { word?: string })[] | undefined,
  word?: string,
): { phonemeTimings: PhonemeTiming[]; wholeWordTiming: WholeWordTiming } | null {
  if (!phonemes?.length || timings?.length !== 2) return null;
  const [slow, fluent] = timings as readonly [WordTiming & { word?: string }, WordTiming];
  if (![slow.startMs, slow.endMs, fluent.startMs, fluent.endMs].every(whole)) return null;
  const span = slow.endMs - slow.startMs;
  // Every sound needs at least a millisecond of its own.
  if (span < phonemes.length || fluent.startMs < slow.endMs || fluent.endMs <= fluent.startMs)
    return null;
  if (
    word !== undefined &&
    typeof fluent.word === "string" &&
    normalizeWord(fluent.word) !== normalizeWord(word)
  )
    return null;
  const count = phonemes.length;
  return {
    phonemeTimings: phonemes.map((phoneme, index) => ({
      phoneme,
      startMs: slow.startMs + Math.round((index * span) / count),
      endMs: slow.startMs + Math.round(((index + 1) * span) / count),
    })),
    wholeWordTiming: { startMs: fluent.startMs, endMs: fluent.endMs },
  };
}

/**
 * A recorded word's timings, when the reader can highlight by them: the ones stored when the
 * recording was accepted, if they are for the word's sounds now, else ones projected from the
 * recording's two word timings (a word imported from Loom stores only those). Null for a word
 * without a recording, or whose recording was not timed.
 */
export function recordedWordTimings(
  asset: MediaAsset | undefined,
): { phonemeTimings: PhonemeTiming[]; wholeWordTiming: WholeWordTiming } | null {
  if (!asset?.path || !asset.phonemes?.length) return null;
  const stored = asset.phonemeTimings;
  if (
    stored?.length === asset.phonemes.length &&
    stored.every((timing, index) => timing.phoneme === asset.phonemes![index]) &&
    asset.wholeWordTiming
  )
    return { phonemeTimings: stored, wholeWordTiming: asset.wholeWordTiming };
  return projectPhonemeTimings(asset.phonemes, asset.wordTimings);
}

/** What an accepted clip's timings leave on a word: its sounds' timings, or nothing. */
export function recordingTimingFields(asset: MediaAsset): {
  phonemeTimings?: PhonemeTiming[];
  wholeWordTiming?: WholeWordTiming;
} {
  const projected = projectPhonemeTimings(
    asset.phonemes,
    asset.wordTimings,
    asset.word ?? asset.normalizedWord,
  );
  return projected ?? {};
}

/**
 * Bring each word's script in line with its sounds and provider, unless the author wrote the
 * script (`customScript`) or the word is bound to a recording not generated here (an upload,
 * or a clip imported with the book), whose script is what that clip was made from. A
 * generated clip recorded from a script that has since changed no longer says the word as its
 * script does, so it is unbound, with its timings, and the next **Record words** records it
 * again. A word's sound timings belong to the clip they were measured on: bound to another
 * clip, or to none, the word keeps none. `previous` is the group as it was saved, which tells
 * a changed script or clip from one that was always so.
 */
export function syncWordScripts(
  group: MediaAsset[],
  previous: readonly MediaAsset[] = [],
): MediaAsset[] {
  for (const asset of group) {
    if (!isBookWord(asset)) continue;
    const foreignClip = !!asset.path && !asset.generatedAudio;
    if (!asset.customScript && !foreignClip) {
      const script = wordScript(asset);
      if (script !== null) asset.script = script;
    }
    const before = previous.find((entry) => entry.key === asset.key && isBookWord(entry));
    const sameClip =
      !!before &&
      !!asset.path &&
      before.path === asset.path &&
      before.generatedAudio?.runId === asset.generatedAudio?.runId;
    if (!sameClip) {
      delete asset.phonemeTimings;
      delete asset.wholeWordTiming;
    }
    if (
      before &&
      before.script !== asset.script &&
      asset.generatedAudio &&
      before.generatedAudio?.runId === asset.generatedAudio.runId
    ) {
      delete asset.path;
      delete asset.generatedAudio;
      delete asset.wordTimings;
      delete asset.durationMs;
      delete asset.phonemeTimings;
      delete asset.wholeWordTiming;
    }
  }
  return group;
}

const usableScript = (script: string | undefined) =>
  !!script?.trim() && script.length <= SCRIPT_MAX;

/** Word pronunciations with sounds, a script and no recording, in every language. */
export function wordRecordingTargets(
  manifest: AssetManifest,
): { language: string; assetKey: string }[] {
  return Object.entries(manifest.assets).flatMap(([language, assets]) =>
    assets
      .filter(
        (asset) =>
          isBookWord(asset) &&
          !!asset.phonemes?.length &&
          !asset.path &&
          usableScript(asset.script),
      )
      .map((asset) => ({ language, assetKey: asset.key })),
  );
}

function unrecorded(
  manifest: AssetManifest,
  sounded: boolean,
): { language: string; assetKey: string }[] {
  return Object.entries(manifest.assets).flatMap(([language, assets]) =>
    assets
      .filter((asset) => isBookWord(asset) && !asset.path && !!asset.phonemes?.length === sounded)
      .map((asset) => ({ language, assetKey: asset.key })),
  );
}

/** Word pronunciations with sounds and no recording, whether or not their script is written. */
export function unrecordedWithSounds(manifest: AssetManifest) {
  return unrecorded(manifest, true);
}

/** Word pronunciations with no recording and no sounds yet, which cannot be recorded. */
export function unrecordedWithoutSounds(manifest: AssetManifest) {
  return unrecorded(manifest, false);
}

/** One word of a story page, as the book's reader receives it. Times are in seconds. */
export interface CompiledWord {
  text: string;
  normalizedWord: string;
  audioKey: string | null;
  phonemes: string[];
  phonemeTimings: { phoneme: string; start: number; end: number }[];
  wholeWordTiming: { start: number; end: number } | null;
}

/**
 * Every word a story page's narration shows, in order, with the word pronunciation of its
 * language: its key (the language group binds the key to the clip's URL), its sounds, and
 * when each is said. A word with no pronunciation, or one not timed, has none of those.
 */
export function compiledWords(script: string, group: readonly MediaAsset[]): CompiledWord[] {
  const byWord = new Map(
    group
      .filter((asset) => asset.type === "audio" && asset.role === BOOK_WORD_ROLE)
      .filter((asset) => !!asset.normalizedWord)
      .map((asset) => [asset.normalizedWord!, asset]),
  );
  return bookWordsOf(script).flatMap((text) => {
    const normalizedWord = normalizeWord(text);
    if (!normalizedWord) return [];
    const asset = byWord.get(normalizedWord);
    const timings = recordedWordTimings(asset);
    return [
      {
        text,
        normalizedWord,
        audioKey: asset?.key ?? null,
        phonemes: [...(asset?.phonemes ?? [])],
        phonemeTimings: (timings?.phonemeTimings ?? []).map((timing) => ({
          phoneme: timing.phoneme,
          start: timing.startMs / 1000,
          end: timing.endMs / 1000,
        })),
        wholeWordTiming: timings
          ? {
              start: timings.wholeWordTiming.startMs / 1000,
              end: timings.wholeWordTiming.endMs / 1000,
            }
          : null,
      },
    ];
  });
}

/** A language group's word pronunciations: how many, how many recorded, how many timed. */
export function wordRecordingCounts(group: readonly MediaAsset[]): {
  total: number;
  recorded: number;
  timed: number;
} {
  const words = group.filter((asset) => isBookWord(asset));
  return {
    total: words.length,
    recorded: words.filter((asset) => !!asset.path).length,
    timed: words.filter((asset) => recordedWordTimings(asset) !== null).length,
  };
}
