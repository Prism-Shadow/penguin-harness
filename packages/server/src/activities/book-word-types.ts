/**
 * What the App sees of a decodable book's word pronunciations: the words the story shows,
 * each with its sounds, and the tool that fills them. Type-only, so the web can import it.
 *
 * The server words none of it: a source is a code and a status is booleans and a version,
 * for the App to say in its own words.
 */
import type { ActivityDraft } from "./domain.js";

/** Where a word's sounds came from: espeak-ng, a model run the author accepted, or the author. */
export type PhonemeSource = "espeak" | "model" | "author";

/** Whether espeak-ng can be run on this server, and which version answered. */
export interface EspeakStatus {
  available: boolean;
  version: string | null;
}

/** `GET /book-words/setup`. */
export interface BookWordsSetup {
  espeak: EspeakStatus;
}

/**
 * `GET /:activityId/book-words`: the reading mode the book's product records (null when none
 * was recorded, and for anything that is not a book), and espeak-ng's status.
 */
export interface BookWordsState extends BookWordsSetup {
  bookMode: "decodable" | "readAlong" | null;
}

/** `POST /:activityId/book-words/refresh`: the draft, and the words still without sounds. */
export interface BookWordsRefresh {
  draft: ActivityDraft;
  /** Normalized words, in the story's order. */
  missing: string[];
}

/** What a phonemes run is asked for: sounds for these normalized words of one language. */
export interface PhonemesTarget {
  language: string;
  words: string[];
}

/** A phonemes run's candidate: the sounds it proposes, by normalized word. */
export interface PhonemesCandidate {
  language: string;
  phonemes: Record<string, string[]>;
}

/** `GET|PUT /api/admin/activity-phonemes`: where espeak-ng is, and whether it answers. */
export interface PhonemesSettingsResponse {
  /** The program an admin named; null runs `espeak-ng` from PATH. */
  espeakPath: string | null;
  espeak: EspeakStatus;
}

/** When one sound of a word's recording is said, drawn out, in whole milliseconds. */
export interface PhonemeTiming {
  phoneme: string;
  startMs: number;
  endMs: number;
}

/** When a word's recording says the whole word at its normal pace, in whole milliseconds. */
export interface WholeWordTiming {
  startMs: number;
  endMs: number;
}
