/**
 * A decodable book's word pronunciations, planned from the story.
 *
 * In a decodable book a child can tap any word the story shows and hear it sounded out, so
 * every distinct word of the story pages' narration gets an audio asset of its own, marked
 * `role: "bookWord"`, listed under each scene that shows it. The words, their normalized
 * form, their keys and their per-scene usages follow Loom's rules, so a book imported from
 * Loom lines its word assets up with the ones planned here.
 *
 * Pure: the service reads the draft, asks this what the manifest should hold, and writes it.
 */
import { createHash } from "node:crypto";
import { interpretBookScenes } from "./book.js";
import type { MediaAsset } from "./media.js";
import type { PhonemeSource } from "./book-word-types.js";

/** The role that marks a word pronunciation among a language group's audio. */
export const BOOK_WORD_ROLE = "bookWord";
/** The longest word, and normalized word, a word asset stores. */
export const BOOK_WORD_MAX = 64;
/** At most this many sounds per word, each at most this many characters. */
export const PHONEMES_MAX = 32;
export const PHONEME_MAX_LENGTH = 8;

/** Stress marks espeak-ng and models add; a sound is the same sound stressed or not. */
const STRESS = /[ˈˌ]/g;

export function isBookWord(asset: Pick<MediaAsset, "role">): boolean {
  return asset.role === BOOK_WORD_ROLE;
}

/**
 * Unicode case folding where it differs from lowercasing for letters a story may use: "ß"
 * and "ẞ" fold to "ss", a final sigma to "σ", a long s to "s". Import compares imported
 * words with planned ones, so both must fold the same way.
 */
function foldCase(text: string): string {
  return text.toLowerCase().replace(/ß/g, "ss").replace(/ς/g, "σ").replace(/ſ/g, "s");
}

/**
 * A word of a story, as a child sees it on the page: a run of letters and digits, which an
 * apostrophe (straight or curly) may join to another run. Punctuation of any other kind,
 * dashes and ellipses included, separates words, so "cat—it" is two words and "Don’t" one.
 */
const BOOK_WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

/** The words a narration script shows, in order; bracketed voice tags are not shown. */
export function bookWordsOf(script: string): string[] {
  return script.replace(/\[[^\]\n]*\]/g, " ").match(BOOK_WORD) ?? [];
}

/**
 * A word as the book compares words: case folded, curly apostrophes made straight, and every
 * character but letters, digits and inner apostrophes dropped. "Cat," and "cat" are one word;
 * "don't" keeps its apostrophe.
 */
export function normalizeWord(word: string): string {
  return Array.from(foldCase(word.normalize("NFKC")).replace(/’/g, "'"))
    .filter((character) => /[\p{L}\p{N}']/u.test(character))
    .join("")
    .replace(/^'+|'+$/g, "");
}

/** Keys a manifest accepts: ASCII, starting with a letter or digit. */
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

function slugOf(text: string): string {
  return Array.from(text)
    .map((character) => (/[\p{L}\p{N}]/u.test(character) ? character : "-"))
    .join("")
    .split("-")
    .filter(Boolean)
    .join("-");
}

/**
 * A word asset's key: `book-word-<slug of at most 48 characters>-<first 10 hex of the word's
 * sha256>`, Loom's rule. A word with letters outside ASCII (Spanish "niño") would give a key
 * the manifest refuses, so its slug has its accents taken off and anything else non-ASCII
 * dropped; the hash still comes from the word itself, so two words never share a key.
 */
export function wordAssetKey(normalized: string): string {
  const digest = createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 10);
  const keyFor = (slug: string) =>
    `book-word-${Array.from(slug).slice(0, 48).join("") || "word"}-${digest}`;
  const loom = keyFor(slugOf(normalized));
  if (SAFE_KEY.test(loom)) return loom;
  const ascii = normalized
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\x00-\x7f]+/g, "-");
  return keyFor(slugOf(ascii));
}

/**
 * Sounds as a word asset stores them, or null when they are not sounds: between 1 and 32,
 * each 1 to 8 characters with no spaces, stress marks removed.
 */
export function cleanPhonemes(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > PHONEMES_MAX) return null;
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") return null;
    const sound = raw.replace(STRESS, "").trim();
    if (!sound || Array.from(sound).length > PHONEME_MAX_LENGTH || /\s/.test(sound)) return null;
    out.push(sound);
  }
  return out;
}

export interface DesiredWord {
  /** The word as the story first shows it ("The"). */
  word: string;
  normalizedWord: string;
  /** The voice of the narration that first shows it, when that narration names one. */
  voice?: string;
  usages: MediaAsset["usages"];
}

/**
 * Every distinct word the story pages' narration shows, in the order the story first shows
 * them, with a usage per occurrence per scene. A language other than the default reads its
 * own group's narration script; a scene whose narration it has not translated shows none.
 */
export function desiredWords(
  spec: Record<string, unknown>,
  group: readonly MediaAsset[],
  language: string,
  defaultLanguage: string,
): DesiredWord[] {
  const collected = new Map<string, DesiredWord>();
  for (const scene of interpretBookScenes(spec)) {
    const narration = scene.audioCues[0];
    if (scene.role !== "story" || !narration?.key) continue;
    const asset = group.find((entry) => entry.key === narration.key && entry.type === "audio");
    const script = language === defaultLanguage ? narration.script : (asset?.script ?? "");
    const words = bookWordsOf(script)
      .map((word) => ({ word, normalized: normalizeWord(word) }))
      .filter(
        (entry) =>
          entry.normalized &&
          entry.word.length <= BOOK_WORD_MAX &&
          entry.normalized.length <= BOOK_WORD_MAX,
      );
    const counts = new Map<string, number>();
    for (const { normalized } of words) counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    const seen = new Map<string, number>();
    for (const { word, normalized } of words) {
      const occurrence = (seen.get(normalized) ?? 0) + 1;
      seen.set(normalized, occurrence);
      let entry = collected.get(normalized);
      if (!entry) {
        entry = {
          word,
          normalizedWord: normalized,
          ...(asset?.voice ? { voice: asset.voice } : {}),
          usages: [],
        };
        collected.set(normalized, entry);
      }
      entry.usages.push({
        sceneId: scene.id,
        sourceKey: narration.key,
        occurrence,
        sceneOccurrenceCount: counts.get(normalized)!,
      });
    }
  }
  return [...collected.values()];
}

/**
 * A language group with its word assets brought in line with the story. A new word gets an
 * asset; a word still used keeps every field it has, with its usages brought up to date; a
 * word no longer used is dropped, unless the author customized it, in which case it stays
 * with no usages, so it is listed apart rather than claiming scenes it is not in. Every other
 * asset of the group is left exactly as it was.
 */
export function mergeWordAssets(
  group: readonly MediaAsset[],
  desired: readonly DesiredWord[],
): MediaAsset[] {
  const others = group.filter((asset) => !isBookWord(asset));
  const existing = new Map(
    group
      .filter((asset) => isBookWord(asset) && asset.normalizedWord)
      .map((asset) => [asset.normalizedWord!, asset]),
  );
  const wanted = new Set(desired.map((entry) => entry.normalizedWord));
  const words: MediaAsset[] = desired.map((entry) => {
    const current = existing.get(entry.normalizedWord);
    if (current) return { ...structuredClone(current), usages: structuredClone(entry.usages) };
    return {
      key: wordAssetKey(entry.normalizedWord),
      type: "audio",
      role: BOOK_WORD_ROLE,
      description: `Pronunciation of “${entry.word}”.`,
      word: entry.word,
      normalizedWord: entry.normalizedWord,
      ...(entry.voice ? { voice: entry.voice } : {}),
      usages: structuredClone(entry.usages),
    };
  });
  const kept = [...existing.values()]
    .filter((asset) => asset.customized && !wanted.has(asset.normalizedWord!))
    .map((asset) => ({ ...structuredClone(asset), usages: [] }));
  return [...others, ...words, ...kept];
}

/** The normalized words of a group whose word assets have no sounds yet, in group order. */
export function wordsMissingPhonemes(group: readonly MediaAsset[]): string[] {
  return group
    .filter((asset) => isBookWord(asset) && asset.normalizedWord && !asset.phonemes?.length)
    .map((asset) => asset.normalizedWord!);
}

/**
 * Give word assets without sounds the sounds found for them, marked with where they came
 * from. A word that already has sounds, or that the author customized, is left alone.
 * Returns how many words were filled.
 */
export function fillPhonemes(
  group: MediaAsset[],
  found: ReadonlyMap<string, readonly string[] | null>,
  source: Exclude<PhonemeSource, "author">,
): number {
  let filled = 0;
  for (const asset of group) {
    if (!isBookWord(asset) || !asset.normalizedWord || asset.customized) continue;
    if (asset.phonemes?.length) continue;
    const sounds = found.get(asset.normalizedWord);
    if (!sounds?.length) continue;
    asset.phonemes = [...sounds];
    asset.phonemeSource = source;
    filled += 1;
  }
  return filled;
}
