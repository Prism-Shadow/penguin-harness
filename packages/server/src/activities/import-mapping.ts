/**
 * Turning what Loom authored into what Penguin stores.
 *
 * #43 reads a Loom activity and reports what is there. This decides what Penguin would
 * make of it — and, as importantly, what it would have to drop.
 *
 * The dropping is the part that matters. An import that silently loses a ref's display
 * name, or quietly renames a language group it does not recognise, produces an activity
 * that looks imported and is not the one that was authored. Everything this cannot carry
 * is named, so the round-trip trial in this phase compares like with like rather than
 * discovering the gaps by eye.
 */
import { validateActivitySpec } from "./domain.js";
import { DEFAULT_LANGUAGE_CODE, findLanguage } from "./languages.js";
import { normalizeAlignment, type WordTiming } from "./word-timings.js";
import {
  clampSoundDuration,
  durationFromScript,
  importedPlayback,
  type AudioPlayback,
} from "./playback.js";
import { cleanPhonemes, normalizeWord, wordAssetKey, BOOK_WORD_MAX } from "./book-words.js";

/** A Loom product, as the reader found it. */
export interface SourceProduct {
  productCode: string;
  moduleFolder: string;
  title: string | null;
  canonicalRefNum: number | null;
  activityType: "standard" | "book";
  bookMode: "decodable" | "readAlong" | null;
}

/** A Loom ref, as the reader found it. */
export interface SourceRef {
  refNum: number;
  title: string | null;
  displayName: string | null;
  stable: boolean;
  spec: Record<string, unknown> | null;
  manifest: Record<string, unknown> | null;
  description: string;
  languages: string[];
  /** Absent from refs read before implementation features were carried. */
  implementationFeatures?: string[];
}

/** What Penguin would create for the product. */
export interface MappedProduct {
  productCode: string;
  moduleFolder: string;
  canonicalRefNum: number;
  activityType: "standard" | "book";
  bookMode: "decodable" | "readAlong" | null;
}

/** What Penguin would create for one ref. */
export interface MappedActivity {
  refNum: number;
  title: string;
  displayName: string | null;
  stable: boolean;
  description: string;
  spec: Record<string, unknown> | null;
  /** Language groups carried across, in order. */
  languages: string[];
  implementationFeatures: string[];
  /** Loom's bindings, by language: what each asset was bound to and, for narration, said. */
  media: Record<string, CarriedBinding[]>;
}

/** What Loom bound one asset to, as far as Penguin's manifest can keep it. */
export interface CarriedBinding {
  key: string;
  path?: string;
  script?: string;
  wordTimings?: WordTiming[];
  durationMs?: number;
  playback?: AudioPlayback;
  /** Music and sound effects: the length Loom's `duration` asked for, in milliseconds. */
  targetDurationMs?: number;
  /**
   * A decodable book's word pronunciation, which no specification plans: its word, sounds,
   * whether the author made it their own, and the scenes that show it. Its key is re-derived
   * from the word, so it matches the key a refresh would give it.
   */
  bookWord?: {
    word: string;
    normalizedWord: string;
    phonemes?: string[];
    customized: boolean;
    usages: {
      sceneId: string;
      sourceKey: string;
      occurrence: number;
      sceneOccurrenceCount: number;
    }[];
  };
}

/** A path Penguin's manifest accepts: relative, under media/, no traversal. */
const MEDIA_PATH = /^media\/[A-Za-z0-9_./ -]+$/;

/**
 * Authored per-asset facts Loom keeps and Penguin's manifest has no field for. Named when
 * dropped. Loom's own bookkeeping (roles, normalised words, ownership flags) is derived,
 * not authored, and goes unmentioned.
 */
const UNCARRIED: Record<string, string> = {
  voice: "voices",
};

/** Loom's word pronunciation, as Penguin keeps it, or null for anything else. */
function carriedWord(asset: Record<string, unknown>): CarriedBinding["bookWord"] | null {
  if (asset.role !== "bookWord" || asset.type !== "audio" || typeof asset.word !== "string")
    return null;
  const normalizedWord = normalizeWord(
    typeof asset.normalizedWord === "string" ? asset.normalizedWord : asset.word,
  );
  if (!normalizedWord || !asset.word || asset.word.length > BOOK_WORD_MAX) return null;
  if (normalizedWord.length > BOOK_WORD_MAX) return null;
  const usages = (Array.isArray(asset.usages) ? asset.usages : []).flatMap((raw: unknown) => {
    const usage = (raw ?? {}) as Record<string, unknown>;
    return typeof usage.sceneId === "string" &&
      usage.sceneId &&
      typeof usage.sourceKey === "string" &&
      Number.isSafeInteger(usage.occurrence) &&
      Number.isSafeInteger(usage.sceneOccurrenceCount)
      ? [
          {
            sceneId: usage.sceneId,
            sourceKey: usage.sourceKey,
            occurrence: usage.occurrence as number,
            sceneOccurrenceCount: usage.sceneOccurrenceCount as number,
          },
        ]
      : [];
  });
  const phonemes = cleanPhonemes(asset.phonemes);
  return {
    word: asset.word,
    normalizedWord,
    ...(phonemes ? { phonemes } : {}),
    customized: asset.customized === true,
    usages,
  };
}

/**
 * Loom's bindings for the languages being carried. Loom's older manifests are a flat list,
 * which is the default language's.
 */
export function carriedBindings(
  manifest: Record<string, unknown> | null,
  languages: readonly string[],
): { media: Record<string, CarriedBinding[]>; lost: Record<string, number>; badPaths: number } {
  const media: Record<string, CarriedBinding[]> = {};
  const lost: Record<string, number> = {};
  let badPaths = 0;
  const assets = manifest?.["assets"];
  const groups: Record<string, unknown> = Array.isArray(assets)
    ? { [DEFAULT_LANGUAGE_CODE]: assets }
    : assets && typeof assets === "object"
      ? (assets as Record<string, unknown>)
      : {};
  for (const language of languages) {
    const list = groups[language];
    if (!Array.isArray(list)) continue;
    media[language] = list.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const asset = entry as Record<string, unknown>;
      if (typeof asset.key !== "string" || !asset.key) return [];
      for (const [field, name] of Object.entries(UNCARRIED))
        if (asset[field] !== undefined) lost[name] = (lost[name] ?? 0) + 1;
      // Sounds are IPA, and portable; they are kept on a word pronunciation, where they
      // belong, and named as dropped anywhere else or when they are not sounds.
      const word = carriedWord(asset);
      if (asset.phonemes !== undefined && !word?.phonemes)
        lost["phonemes"] = (lost["phonemes"] ?? 0) + 1;
      const binding: CarriedBinding = word
        ? { key: wordAssetKey(word.normalizedWord), bookWord: word }
        : { key: asset.key };
      if (typeof asset.path === "string" && asset.path) {
        if (MEDIA_PATH.test(asset.path) && !asset.path.split("/").includes(".."))
          binding.path = asset.path;
        else badPaths += 1;
      }
      if (asset.type === "audio" && typeof asset.script === "string") binding.script = asset.script;
      // Timings are kept only when they align with the script they were made for; a
      // read-along driven by timings for other words highlights the wrong ones.
      if (asset.type === "audio" && Array.isArray(asset.wordTimings)) {
        const aligned =
          binding.script !== undefined
            ? normalizeAlignment(binding.script, asset.wordTimings)
            : null;
        if (aligned) binding.wordTimings = aligned;
        else
          lost["word timings that did not match their script"] =
            (lost["word timings that did not match their script"] ?? 0) + 1;
      }
      if (
        asset.type === "audio" &&
        Number.isSafeInteger(asset.durationMs) &&
        (asset.durationMs as number) >= 0
      )
        binding.durationMs = asset.durationMs as number;
      const playback = asset.type === "audio" ? importedPlayback(asset) : null;
      if (playback) binding.playback = playback;
      // Loom asks for a length with its tag's `duration`, in seconds; a manifest entry may
      // carry it as a field too.
      if (playback) {
        const seconds = typeof asset.duration === "number" ? asset.duration : NaN;
        const length =
          Number.isFinite(seconds) && seconds > 0
            ? clampSoundDuration(seconds * 1000)
            : durationFromScript(binding.script);
        if (length !== undefined) binding.targetDurationMs = length;
      }
      return [binding];
    });
  }
  return { media, lost, badPaths };
}

export interface ImportMapping {
  product: MappedProduct;
  activities: MappedActivity[];
  /** What could not be carried, in an author's words. Empty means a clean import. */
  dropped: string[];
  /** What was repaired rather than dropped, so nobody mistakes it for fidelity. */
  repaired: string[];
}

/** A title Penguin can store, since it requires one and Loom does not. */
function titleFor(product: SourceProduct, ref: SourceRef): string {
  return ref.title?.trim() || product.title?.trim() || `${product.productCode}-${ref.refNum}`;
}

/**
 * What Penguin would make of a Loom product and its refs.
 *
 * Two repairs are applied rather than refused, because refusing would make most of the
 * real corpus unimportable, and both are recorded:
 *
 * A product naming a canonical ref that does not exist gets its lowest ref instead — the
 * same repair migration 18 makes for existing Penguin rows, and three real products need
 * it.
 *
 * A product with no title at all takes the ref's, or its address, because Penguin requires
 * one.
 */
export function mapImport(product: SourceProduct, refs: readonly SourceRef[]): ImportMapping {
  const dropped: string[] = [];
  const repaired: string[] = [];

  const numbers = refs.map((ref) => ref.refNum).sort((a, b) => a - b);
  let canonical = product.canonicalRefNum;
  if (canonical === null || !numbers.includes(canonical)) {
    const fallback = numbers[0] ?? 0;
    repaired.push(
      canonical === null
        ? `The product named no canonical ref; ref ${fallback} was taken as canonical.`
        : `The product named ref ${canonical} as canonical, which does not exist; ref ${fallback} was taken instead.`,
    );
    canonical = fallback;
  }

  const activities: MappedActivity[] = [];
  for (const ref of refs) {
    const languages: string[] = [];
    for (const code of ref.languages) {
      if (findLanguage(code)) languages.push(code);
      else
        dropped.push(
          `Ref ${ref.refNum} has a "${code}" language group, which this product does not support; its assets were not carried.`,
        );
    }
    if (!languages.includes(DEFAULT_LANGUAGE_CODE) && ref.manifest)
      dropped.push(
        `Ref ${ref.refNum} has no ${DEFAULT_LANGUAGE_CODE} group, so there is nothing to translate from.`,
      );
    // Checked here rather than on the way in, so a specification Penguin will not accept
    // is a reported loss instead of a ref that gets created and then cannot be finished.
    // A half-written ref is worse than a missing one: it looks imported and does nothing.
    let spec = ref.spec;
    if (!spec) dropped.push(`Ref ${ref.refNum} has no specification to import.`);
    else {
      // The folder in a specification is a redundant copy of where the product actually
      // lives, and five real refs carry an old misspelling of it. Losing a whole activity
      // over a stale copy of a fact the directory already states would be absurd, so it is
      // corrected from disk and the correction is recorded.
      const declared = spec["moduleFolder"];
      if (typeof declared === "string" && declared !== product.moduleFolder) {
        spec = { ...spec, moduleFolder: product.moduleFolder };
        repaired.push(
          `Ref ${ref.refNum} named module folder "${declared}", but the product is in "${product.moduleFolder}"; the folder on disk was used.`,
        );
      }
      try {
        validateActivitySpec(spec);
      } catch (error) {
        dropped.push(
          `Ref ${ref.refNum} has a specification Penguin will not accept, so it was not carried: ${(error as Error).message}`,
        );
        spec = null;
      }
    }
    if (!ref.manifest) dropped.push(`Ref ${ref.refNum} has no asset manifest to import.`);
    const carried = carriedBindings(ref.manifest, languages);
    const lostNames = Object.entries(carried.lost).map(([name, count]) => `${name} (${count})`);
    if (lostNames.length)
      dropped.push(
        `Ref ${ref.refNum}: Loom's per-asset ${lostNames.join(", ")} were not carried; Penguin's media plan has no field for them.`,
      );
    if (carried.badPaths)
      dropped.push(
        `Ref ${ref.refNum}: ${carried.badPaths} media ${carried.badPaths === 1 ? "path was" : "paths were"} not under media/ and ${carried.badPaths === 1 ? "was" : "were"} not carried.`,
      );
    if (!ref.description.trim())
      dropped.push(`Ref ${ref.refNum} has no description, so nothing records what it is for.`);

    const title = titleFor(product, ref);
    if (!ref.title?.trim() && !product.title?.trim())
      repaired.push(`Ref ${ref.refNum} had no title; "${title}" was used.`);

    activities.push({
      refNum: ref.refNum,
      title,
      displayName: ref.displayName,
      stable: ref.stable,
      description: ref.description,
      spec,
      languages,
      implementationFeatures: ref.implementationFeatures ?? [],
      media: carried.media,
    });
  }

  return {
    product: {
      productCode: product.productCode,
      moduleFolder: product.moduleFolder,
      canonicalRefNum: canonical,
      activityType: product.activityType,
      // Reported rather than invented: a book with no reading mode cannot be assembled,
      // and guessing one produces the wrong kind of book.
      bookMode: product.bookMode,
    },
    activities: activities.sort((a, b) => a.refNum - b.refNum),
    dropped,
    repaired,
  };
}

/** Whether this import would produce an activity faithful to what Loom held. */
export function importIsFaithful(mapping: ImportMapping): boolean {
  return mapping.dropped.length === 0;
}

/**
 * Whether a book product can actually be assembled after import.
 *
 * Asked separately because it is not a fidelity question: a book with no reading mode
 * imports perfectly and then cannot be built, and an author should learn that at import
 * rather than at assembly.
 */
export function assemblyBlockers(mapping: ImportMapping): string[] {
  if (mapping.product.activityType !== "book") return [];
  if (mapping.product.bookMode) return [];
  return [
    `${mapping.product.productCode} is a book with no reading mode recorded; choose decodable or read-along before assembling it.`,
  ];
}

/** One line about what an import would do. */
export function describeImport(mapping: ImportMapping): string {
  const count = mapping.activities.length;
  const parts = [
    `Importing ${mapping.product.productCode} with ${count} ${count === 1 ? "ref" : "refs"}, ref ${mapping.product.canonicalRefNum} canonical.`,
  ];
  if (mapping.repaired.length)
    parts.push(
      `${mapping.repaired.length} ${mapping.repaired.length === 1 ? "thing was" : "things were"} repaired: ${mapping.repaired.join(" ")}`,
    );
  if (mapping.dropped.length)
    parts.push(
      `${mapping.dropped.length} ${mapping.dropped.length === 1 ? "thing" : "things"} could not be carried: ${mapping.dropped.join(" ")}`,
    );
  else parts.push("Nothing was dropped.");
  return parts.join(" ");
}
