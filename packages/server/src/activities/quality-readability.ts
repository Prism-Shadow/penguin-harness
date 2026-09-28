/**
 * Right reading level: whether the words an activity speaks and shows suit the grade band its
 * specification names (`audience.gradeBand`).
 *
 * It only warns. The limits are rough, developmental ones, waiting for literacy and
 * curriculum to agree them, so every finding is a Note and the check never fails: a long
 * sentence, a long word or a word of many syllables is pointed out, unless it is a sight word
 * a young reader knows or a word the activity sets out to teach (a word quoted in an
 * acceptance criterion). The Flesch-Kincaid grade is reported beside them, for information.
 *
 * English only; without a grade band there is nothing to read against, and it is skipped.
 */
import sightWordsData from "./sight-words.json" with { type: "json" };
import { DEFAULT_LANGUAGE_CODE } from "./languages.js";
import type { AssetManifest } from "./media.js";
import type { QualityFinding, QualityReport, QualitySkipReason } from "./quality-types.js";

/** The highest US grade level each grade band is read at. */
export const GRADE_BAND_MAX: Readonly<Record<string, number>> = {
  prek: 0,
  "pre-k": 0,
  pk: 0,
  k: 1,
  "k-1": 1,
  "k-2": 2,
  "1-2": 2,
  "2-3": 3,
  "3-5": 5,
  "4-5": 5,
  "6-8": 8,
  "9-12": 12,
};

/**
 * A grade band's highest grade: one of the named bands, else the last number in it ("grade
 * 4" is 4). Null when there is none to find.
 */
export function gradeBandMax(band: unknown): number | null {
  if (typeof band !== "string" || !band.trim()) return null;
  const normalized = band.trim().toLowerCase();
  if (normalized in GRADE_BAND_MAX) return GRADE_BAND_MAX[normalized]!;
  const numbers = normalized.match(/\d+/g);
  return numbers ? Number(numbers[numbers.length - 1]) : null;
}

/** How long a sentence or a word may be before it is pointed out. */
export interface ReadabilityLimits {
  sentenceWords: number;
  wordLetters: number;
  wordSyllables: number;
}

/** The limits for a band's highest grade: tight for pre-readers, looser as grades go up. */
export function limitsFor(gradeMax: number): ReadabilityLimits {
  if (gradeMax <= 0) return { sentenceWords: 6, wordLetters: 6, wordSyllables: 2 };
  if (gradeMax <= 1) return { sentenceWords: 8, wordLetters: 7, wordSyllables: 2 };
  if (gradeMax <= 2) return { sentenceWords: 10, wordLetters: 8, wordSyllables: 3 };
  if (gradeMax <= 3) return { sentenceWords: 12, wordLetters: 9, wordSyllables: 3 };
  return {
    sentenceWords: Math.min(20, Math.floor(12 + gradeMax)),
    wordLetters: Math.min(14, Math.floor(9 + gradeMax)),
    wordSyllables: 4,
  };
}

const WORD = /[A-Za-z][A-Za-z'-]*/g;

/** A word as compared: lower case, without a leading or trailing apostrophe or hyphen. */
function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/^['-]+|['-]+$/g, "");
}

/** The words of a text, normalized. */
export function wordsOf(text: string): string[] {
  return (text.match(WORD) ?? []).map(normalizeWord).filter(Boolean);
}

/** The sentences of a text: split at `.`, `!` and `?`. */
export function sentencesOf(text: string): string[] {
  return text
    .split(/[.!?]+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * Syllables, counted as groups of vowels (y included), less a silent final e ("make" is one,
 * "table" is two). Never less than one.
 */
export function syllables(word: string): number {
  const letters = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!letters) return 0;
  let count = letters.match(/[aeiouy]+/g)?.length ?? 0;
  if (letters.length > 2 && letters.endsWith("e") && !letters.endsWith("le") && count > 1)
    count -= 1;
  return Math.max(count, 1);
}

/** The Flesch-Kincaid grade of a text, to one decimal; 0 for a text without words. */
export function fleschKincaidGrade(text: string): number {
  const sentences = sentencesOf(text).filter((sentence) => wordsOf(sentence).length);
  const words = wordsOf(text);
  if (!words.length) return 0;
  const syllableTotal = words.reduce((sum, word) => sum + syllables(word), 0);
  const grade =
    0.39 * (words.length / Math.max(sentences.length, 1)) +
    11.8 * (syllableTotal / words.length) -
    15.59;
  return Math.round(grade * 10) / 10;
}

/** The sight words a young reader knows by sight, which are never hard words. */
export const SIGHT_WORDS: ReadonlySet<string> = new Set(
  (sightWordsData as { words: string[] }).words.map(normalizeWord),
);

/**
 * A quoted word or phrase. Double quotes pair as they are; a single quote opens only where no
 * letter comes right before it and closes only where no letter comes right after it, so the
 * apostrophe in "can't" or "child's" is not taken for a quote.
 */
const QUOTED =
  /["“]([A-Za-z][A-Za-z '’-]*)["”]|(?<![A-Za-z])['‘]([A-Za-z](?:[A-Za-z -]*[A-Za-z])?)['’](?![A-Za-z])/g;

/** The words an activity teaches: those quoted in its acceptance criteria. */
export function targetWords(criteria: unknown): Set<string> {
  const words = new Set<string>();
  if (!Array.isArray(criteria)) return words;
  for (const criterion of criteria) {
    if (typeof criterion !== "string") continue;
    for (const match of criterion.matchAll(QUOTED))
      for (const word of wordsOf((match[1] ?? match[2])!)) words.add(word);
  }
  return words;
}

/** A piece of text the learner hears or sees, and the scene it belongs to. */
export interface Passage {
  text: string;
  scene: string | null;
}

export interface ReadabilityOptions {
  gradeMax: number;
  sightWords?: ReadonlySet<string>;
  targetWords?: ReadonlySet<string>;
  limits?: ReadabilityLimits;
}

const SENTENCE_SHOWN = 160;

/**
 * What may be too hard to read at `gradeMax`: each sentence over the word limit, and each
 * word (once) over the letter or syllable limit that is neither a sight word nor a target
 * word. Every finding is a non-blocking Note.
 */
export function readabilityFindings(
  passages: string | readonly Passage[],
  options: ReadabilityOptions,
): QualityFinding[] {
  const list: readonly Passage[] =
    typeof passages === "string" ? [{ text: passages, scene: null }] : passages;
  const limits = options.limits ?? limitsFor(options.gradeMax);
  const sight = options.sightWords ?? SIGHT_WORDS;
  const targets = options.targetWords ?? new Set<string>();
  const findings: QualityFinding[] = [];
  const note = (code: string, detail: string, scene: string | null, count: number, limit: number) =>
    findings.push({
      id: `${code}:${findings.length}`,
      severity: "note",
      blocking: false,
      target: null,
      scene,
      code,
      detail,
      count,
      limit,
    });
  const seenSentences = new Set<string>();
  const seenWords = new Set<string>();
  for (const passage of list) {
    for (const sentence of sentencesOf(passage.text)) {
      const count = wordsOf(sentence).length;
      if (count <= limits.sentenceWords || seenSentences.has(sentence)) continue;
      seenSentences.add(sentence);
      const shown =
        sentence.length > SENTENCE_SHOWN ? `${sentence.slice(0, SENTENCE_SHOWN - 1)}…` : sentence;
      note("sentence_long", shown, passage.scene, count, limits.sentenceWords);
    }
    for (const word of wordsOf(passage.text)) {
      if (seenWords.has(word) || sight.has(word) || targets.has(word)) continue;
      seenWords.add(word);
      const letters = word.replace(/[^a-z]/g, "").length;
      if (letters > limits.wordLetters)
        note("word_long", word, passage.scene, letters, limits.wordLetters);
      const count = syllables(word);
      if (count > limits.wordSyllables)
        note("word_syllables", word, passage.scene, count, limits.wordSyllables);
    }
  }
  return findings;
}

/** Whether a language code is English. */
export function isEnglish(code: string): boolean {
  return code.trim().toLowerCase().startsWith("en");
}

/** The language an activity's words are in: the default one when its manifest has it. */
export function activityLanguage(manifest: AssetManifest | null | undefined): string {
  const languages = Object.keys(manifest?.assets ?? {});
  if (!languages.length || languages.includes(DEFAULT_LANGUAGE_CODE)) return DEFAULT_LANGUAGE_CODE;
  return languages.find(isEnglish) ?? languages[0]!;
}

/**
 * The narration an activity speaks in `language`: the media plan's narration scripts, or,
 * before there is a plan, the scripts in the specification's audio tracks.
 */
export function narrationPassages(
  spec: Record<string, unknown> | null,
  manifest: AssetManifest | null | undefined,
  language: string,
): Passage[] {
  const planned = manifest?.assets[language];
  if (planned) {
    return planned
      .filter((asset) => asset.type === "audio" && !asset.kind && !!asset.script?.trim())
      .map((asset) => ({ text: asset.script!, scene: asset.usages[0]?.sceneId ?? null }));
  }
  const passages: Passage[] = [];
  const scenes = Array.isArray(spec?.scenes) ? (spec!.scenes as unknown[]) : [];
  for (const scene of scenes) {
    if (!scene || typeof scene !== "object") continue;
    const { id, audio } = scene as { id?: unknown; audio?: { tracks?: unknown } };
    const tracks = Array.isArray(audio?.tracks) ? (audio!.tracks as unknown[]) : [];
    for (const track of tracks) {
      const script = (track as { script?: unknown } | null)?.script;
      if (typeof script === "string" && script.trim())
        passages.push({ text: script, scene: typeof id === "string" ? id : null });
    }
  }
  return passages;
}

/** The activity's grade band, as its specification gives it. */
export function gradeBandOf(spec: Record<string, unknown> | null): string | null {
  const audience = spec?.audience;
  const band =
    audience && typeof audience === "object"
      ? (audience as { gradeBand?: unknown }).gradeBand
      : null;
  return typeof band === "string" && band.trim() ? band.trim() : null;
}

/** The readability report for an activity, from what it speaks and what its player showed. */
export function readabilityReport(input: {
  spec: Record<string, unknown> | null;
  language: string;
  passages: readonly Passage[];
  checkedAt: string;
}): QualityReport {
  const band = gradeBandOf(input.spec);
  const skipped = (reason: QualitySkipReason): QualityReport => ({
    check: "readability",
    status: "skipped",
    findings: [],
    checkedAt: input.checkedAt,
    skippedReason: reason,
    ...(band ? { gradeBand: band } : {}),
  });
  if (!band) return skipped("no_grade_band");
  const gradeMax = gradeBandMax(band);
  if (gradeMax === null) return skipped("unknown_grade_band");
  if (!isEnglish(input.language)) return skipped("not_english");
  const passages = input.passages.filter((passage) => passage.text.trim());
  if (!passages.length) return skipped("no_text");
  const findings = readabilityFindings(passages, {
    gradeMax,
    targetWords: targetWords(input.spec?.acceptance_criterias),
  });
  return {
    check: "readability",
    status: findings.length ? "passed_with_warnings" : "passed",
    findings,
    checkedAt: input.checkedAt,
    gradeBand: band,
    readingGrade: fleschKincaidGrade(passages.map((passage) => passage.text).join(". ")),
  };
}
