/**
 * The pure model behind a decodable book's word pronunciations: which assets are words, which
 * still need sounds, the newest model proposal and what accepting it would change, and the
 * same sound rule the server enforces, checked while the author types.
 */
import type {
  ActivityRunSummary,
  AssetManifest,
  BookWordsState,
  PhonemesCandidate,
} from "@prismshadow/penguin-server/api";

type MediaAsset = AssetManifest["assets"][string][number];
export type BookMode = "decodable" | "readAlong";

/** The most words one model run is asked for, as the server allows. */
export const PHONEMES_RUN_MAX_WORDS = 200;
/** At most this many sounds per word, each at most this many characters. */
export const PHONEMES_MAX = 32;
export const PHONEME_MAX_LENGTH = 8;

export function isBookWord(asset: Pick<MediaAsset, "role">): boolean {
  return asset.role === "bookWord";
}

/** A language group's word pronunciations, in manifest order. */
export function bookWordAssets(group: readonly MediaAsset[]): MediaAsset[] {
  return group.filter(isBookWord);
}

/** The scene's own media, without the book's words: what narration lists and counts. */
export function withoutBookWords(group: readonly MediaAsset[]): MediaAsset[] {
  return group.filter((asset) => !isBookWord(asset));
}

/** The normalized words of a group that have no sounds yet. */
export function wordsWithoutSounds(group: readonly MediaAsset[]): string[] {
  return bookWordAssets(group)
    .filter((asset) => asset.normalizedWord && !asset.phonemes?.length)
    .map((asset) => asset.normalizedWord!);
}

/**
 * Whether the book is decodable: the reading mode its product records, or, where it records
 * none, the one the author chose on this page. The server decides the same way, and records
 * the author's choice on the first refresh. A book that records none but already has word
 * pronunciations was refreshed as decodable, so it still counts as one after a reload.
 */
export function isDecodable(
  state: Pick<BookWordsState, "bookMode"> | null,
  chosen: BookMode | "",
  hasWords = false,
): boolean {
  if (!state) return false;
  if (state.bookMode) return state.bookMode === "decodable";
  return chosen === "decodable" || hasWords;
}

/** The newest phonemes run for a language, whatever its status. */
export function latestPhonemesRun(
  runs: readonly ActivityRunSummary[],
  language: string,
): ActivityRunSummary | undefined {
  return runs
    .filter((run) => run.kind === "phonemes" && run.phonemes?.language === language)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

/** A phonemes run's candidate, or null when it is not one. */
export function parseProposal(candidate: string | null | undefined): PhonemesCandidate | null {
  if (!candidate) return null;
  try {
    const value = JSON.parse(candidate) as PhonemesCandidate;
    if (
      !value ||
      typeof value.language !== "string" ||
      !value.phonemes ||
      typeof value.phonemes !== "object" ||
      !Object.values(value.phonemes).every(
        (sounds) => Array.isArray(sounds) && sounds.every((sound) => typeof sound === "string"),
      )
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

export interface ProposalRow {
  word: string;
  normalizedWord: string;
  sounds: string[];
  /** Whether accepting would give the word these sounds: only a word still without any. */
  applies: boolean;
}

/** A proposal as the author reads it: each proposed word, in the group's order. */
export function proposalRows(
  proposal: PhonemesCandidate,
  group: readonly MediaAsset[],
): ProposalRow[] {
  return bookWordAssets(group).flatMap((asset) => {
    const sounds = asset.normalizedWord ? proposal.phonemes[asset.normalizedWord] : undefined;
    if (!sounds?.length) return [];
    return [
      {
        word: asset.word ?? asset.normalizedWord!,
        normalizedWord: asset.normalizedWord!,
        sounds,
        applies: !asset.phonemes?.length && !asset.customized,
      },
    ];
  });
}

/** Sounds as they would be saved: trimmed, stress marks removed, empty boxes left out. */
export function cleanSounds(segments: readonly string[]): string[] {
  return segments.map((segment) => segment.replace(/[ˈˌ]/g, "").trim()).filter(Boolean);
}

export type SoundsProblem = "empty" | "tooMany" | "segment";

/** Why these sounds would be refused, or null: the server's rule, before a save. */
export function soundsProblem(segments: readonly string[]): SoundsProblem | null {
  const sounds = cleanSounds(segments);
  if (!sounds.length) return "empty";
  if (sounds.length > PHONEMES_MAX) return "tooMany";
  if (sounds.some((sound) => Array.from(sound).length > PHONEME_MAX_LENGTH || /\s/.test(sound)))
    return "segment";
  return null;
}

/** Whether two lists of sounds say the same. */
export function sameSounds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((sound, index) => sound === right[index]);
}
