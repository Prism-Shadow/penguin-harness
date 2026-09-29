import { contentRevision, type ActivityDetail, type ActivityAddress } from "./domain.js";
import {
  SOUND_MAX_DURATION_MS,
  SOUND_MIN_DURATION_MS,
  durationFromScript,
  playbackFromScript,
  readPlayback,
  type AudioKind,
} from "./playback.js";
import type { SpeechProviderId } from "./speech-types.js";
import type { PhonemeSource, PhonemeTiming, WholeWordTiming } from "./book-word-types.js";
import {
  BOOK_WORD_MAX,
  BOOK_WORD_ROLE,
  PHONEMES_MAX,
  cleanPhonemes,
  isBookWord,
} from "./book-words.js";

export interface MediaAsset {
  key: string;
  type: "image" | "audio" | "video" | "animation";
  description: string;
  sourceKey?: string;
  script?: string;
  /**
   * For a narration in a language other than the default: the default-language script this
   * one was translated from. When the default line is rewritten, the translation is stale.
   */
  translatedFrom?: string;
  /**
   * The voice a narration is spoken in the next time it is generated. The bound clip keeps
   * whatever voice it was recorded with, so choosing a voice leaves timings alone.
   */
  voice?: string;
  /**
   * Who speaks a narration the next time it is generated; absent is Gemini. Like the voice,
   * the bound clip keeps whatever provider recorded it.
   */
  speechProvider?: SpeechProviderId;
  /**
   * When each spoken word of a narration's clip starts and ends, which a read-along
   * highlights by, and the clip's length. They describe one recording of one script, so
   * any change to either drops them.
   */
  wordTimings?: { word: string; startMs: number; endMs: number }[];
  durationMs?: number;
  /**
   * Music and sound effects: how the module plays them (see playback.ts). All four or
   * none; narration has none.
   */
  kind?: AudioKind;
  channel?: string;
  loop?: boolean;
  volume?: number;
  /**
   * Music and sound effects: how long a generated clip should be, in whole milliseconds
   * (1 000 to 60 000). Absent lets the provider choose.
   */
  targetDurationMs?: number;
  /**
   * A decodable book's word pronunciation (see book-words.ts): the word as the story shows
   * it, its normalized form, its sounds and where they came from, and whether the author
   * changed it, which keeps it on every later refresh. All only on audio with this role.
   */
  role?: typeof BOOK_WORD_ROLE;
  word?: string;
  normalizedWord?: string;
  phonemes?: string[];
  phonemeSource?: PhonemeSource;
  customized?: boolean;
  /**
   * A word pronunciation whose script the author wrote: it is kept as written rather than
   * made again from the word's sounds and provider (see pronunciation.ts).
   */
  customScript?: boolean;
  /**
   * A word pronunciation's recording, timed: when each sound is said, drawn out, and when the
   * whole word is said at its normal pace. Only from a provider that timed the recording.
   */
  phonemeTimings?: PhonemeTiming[];
  wholeWordTiming?: WholeWordTiming;
  /** A reference in the WAF media checkout, never a server filesystem path. */
  path?: string;
  /**
   * A clip a run made and the author accepted. `format` is absent for every WAV clip (all
   * speech, and every record older than sound generation); a sound run's MP3 says "mp3".
   */
  generatedAudio?: { runId: string; sha256: string; format?: GeneratedAudioFormat };
  generatedImage?: { runId: string; sha256: string };
  /**
   * A scene video a run recorded from a composition and the author accepted (experimental),
   * on a video or animation asset, bound to `media/generated/<runId>.webm`.
   */
  generatedVideo?: { runId: string; sha256: string };
  usages: {
    sceneId: string;
    sourceKey: string;
    occurrence: number;
    sceneOccurrenceCount: number;
  }[];
}
export type GeneratedAudioFormat = "wav" | "mp3";

/** Where an accepted clip is bound: `media/generated/<runId>.<format>`, WAV when unnamed. */
export function generatedAudioPath(generated: { runId: string; format?: GeneratedAudioFormat }) {
  return `media/generated/${generated.runId}.${generated.format ?? "wav"}`;
}

export interface AssetManifest extends ActivityAddress {
  assets: Record<string, MediaAsset[]>;
}
export interface MediaPlan {
  specRevision: string;
  /** Source requirement hashes let rebuilding preserve reviewed language overrides. */
  requirements: Record<string, string>;
  manifest: AssetManifest;
}

const safeKey = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value) &&
  !["constructor", "prototype", "__proto__"].includes(value);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a media object.");
  return value as Record<string, unknown>;
}

/** Keep the review contract bounded and reject ambiguous WAF configuration aliases. */
export function validateManifest(value: unknown, address: ActivityAddress): AssetManifest {
  const manifest = object(value);
  if (Object.keys(manifest).some((key) => !["productCode", "refNum", "assets"].includes(key)))
    throw new Error("Unsupported media manifest field.");
  if (manifest.productCode !== address.productCode || manifest.refNum !== address.refNum)
    throw new Error("The media manifest must match this activity's productCode and refNum.");
  const groups = object(manifest.assets);
  if (!Object.keys(groups).length || Object.keys(groups).length > 100)
    throw new Error("The media manifest requires between 1 and 100 language groups.");
  const assets: Record<string, MediaAsset[]> = {};
  let count = 0;
  for (const [language, entries] of Object.entries(groups)) {
    if (!/^[a-z]{2}-[A-Z]{2}$/.test(language) || !Array.isArray(entries))
      throw new Error("Media groups must be language codes such as en-US containing asset arrays.");
    const aliases = new Map<string, string>();
    const keys = new Set<string>();
    assets[language] = entries.map((entry) => {
      const asset = object(entry);
      if (++count > 2000) throw new Error("A media manifest may contain at most 2000 assets.");
      if (
        Object.keys(asset).some(
          (key) =>
            ![
              "key",
              "type",
              "description",
              "sourceKey",
              "script",
              "translatedFrom",
              "voice",
              "speechProvider",
              "wordTimings",
              "durationMs",
              "kind",
              "channel",
              "loop",
              "volume",
              "targetDurationMs",
              "role",
              "word",
              "normalizedWord",
              "phonemes",
              "phonemeSource",
              "customized",
              "customScript",
              "phonemeTimings",
              "wholeWordTiming",
              "path",
              "usages",
              "generatedAudio",
              "generatedImage",
              "generatedVideo",
            ].includes(key),
        )
      )
        throw new Error("Unsupported media asset field.");
      if (!safeKey(asset.key) || keys.has(asset.key))
        throw new Error("Media keys must be safe and unique within each language.");
      keys.add(asset.key);
      if (!["image", "audio", "video", "animation"].includes(String(asset.type)))
        throw new Error("Unsupported media type.");
      if (
        typeof asset.description !== "string" ||
        !asset.description.trim() ||
        asset.description.length > 10000
      )
        throw new Error("Media assets require a description of at most 10000 characters.");
      if (asset.sourceKey !== undefined && !safeKey(asset.sourceKey))
        throw new Error("Invalid media sourceKey.");
      if (
        asset.script !== undefined &&
        (typeof asset.script !== "string" || asset.script.length > 100000 || asset.type !== "audio")
      )
        throw new Error("Only audio assets may contain a script, up to 100000 characters.");
      if (
        asset.translatedFrom !== undefined &&
        (typeof asset.translatedFrom !== "string" ||
          asset.translatedFrom.length > 100000 ||
          asset.type !== "audio")
      )
        throw new Error("Only a narration may record what it was translated from.");
      if (
        asset.voice !== undefined &&
        (typeof asset.voice !== "string" ||
          asset.voice.length < 1 ||
          asset.voice.length > 64 ||
          !/^[A-Za-z0-9 _.-]+$/.test(asset.voice) ||
          asset.type !== "audio" ||
          asset.kind !== undefined)
      )
        throw new Error("Only a narration may name a voice.");
      if (
        asset.speechProvider !== undefined &&
        (!["gemini", "elevenlabs", "kokoro"].includes(String(asset.speechProvider)) ||
          asset.type !== "audio" ||
          asset.kind !== undefined)
      )
        throw new Error("Only a narration names a speech provider: gemini, elevenlabs or kokoro.");
      if (
        asset.wordTimings !== undefined &&
        (asset.type !== "audio" ||
          !Array.isArray(asset.wordTimings) ||
          asset.wordTimings.length > 10000 ||
          asset.wordTimings.some((raw: unknown) => {
            const timing = raw as Record<string, unknown> | null;
            return (
              !timing ||
              typeof timing.word !== "string" ||
              timing.word.length > 200 ||
              !Number.isSafeInteger(timing.startMs) ||
              !Number.isSafeInteger(timing.endMs) ||
              (timing.startMs as number) < 0 ||
              (timing.endMs as number) <= (timing.startMs as number)
            );
          }))
      )
        throw new Error(
          "Word timings belong to a narration: words with ascending start and end times.",
        );
      if (
        asset.durationMs !== undefined &&
        (asset.type !== "audio" ||
          !Number.isSafeInteger(asset.durationMs) ||
          (asset.durationMs as number) < 0)
      )
        throw new Error("A duration belongs to a narration, in whole milliseconds.");
      if (
        asset.targetDurationMs !== undefined &&
        (asset.type !== "audio" ||
          asset.kind === undefined ||
          !Number.isSafeInteger(asset.targetDurationMs) ||
          (asset.targetDurationMs as number) < SOUND_MIN_DURATION_MS ||
          (asset.targetDurationMs as number) > SOUND_MAX_DURATION_MS)
      )
        throw new Error(
          "A requested length belongs to music or a sound effect, from 1000 to 60000 milliseconds.",
        );
      const bookWord = asset.role !== undefined;
      if (
        bookWord &&
        (asset.role !== BOOK_WORD_ROLE ||
          asset.type !== "audio" ||
          asset.kind !== undefined ||
          asset.word === undefined)
      )
        throw new Error('Only an audio word pronunciation has a role, "bookWord", with its word.');
      const wordText = (value: unknown) =>
        typeof value === "string" && value.length >= 1 && value.length <= BOOK_WORD_MAX;
      if (
        (asset.word !== undefined && (!bookWord || !wordText(asset.word))) ||
        (asset.normalizedWord !== undefined && (!bookWord || !wordText(asset.normalizedWord)))
      )
        throw new Error("A word pronunciation's word is 1 to 64 characters.");
      if (
        asset.phonemes !== undefined &&
        (!bookWord ||
          !Array.isArray(asset.phonemes) ||
          (asset.phonemes.length > 0 &&
            JSON.stringify(cleanPhonemes(asset.phonemes)) !== JSON.stringify(asset.phonemes)))
      )
        throw new Error(
          "A word pronunciation's sounds are at most 32, each 1 to 8 characters without stress marks.",
        );
      if (
        asset.phonemeSource !== undefined &&
        (!bookWord || !["espeak", "model", "author"].includes(String(asset.phonemeSource)))
      )
        throw new Error("A word's sounds come from espeak, a model or the author.");
      if (asset.customized !== undefined && (!bookWord || typeof asset.customized !== "boolean"))
        throw new Error("Only a word pronunciation is marked as customized.");
      if (
        asset.customScript !== undefined &&
        (!bookWord || typeof asset.customScript !== "boolean")
      )
        throw new Error("Only a word pronunciation's script is marked as the author's.");
      const span = (value: unknown): value is { startMs: number; endMs: number } => {
        const timing = value as Record<string, unknown> | null;
        return (
          !!timing &&
          typeof timing === "object" &&
          Number.isSafeInteger(timing.startMs) &&
          Number.isSafeInteger(timing.endMs) &&
          (timing.startMs as number) >= 0 &&
          (timing.endMs as number) > (timing.startMs as number)
        );
      };
      if (
        asset.phonemeTimings !== undefined &&
        (!bookWord ||
          !Array.isArray(asset.phonemeTimings) ||
          asset.phonemeTimings.length > PHONEMES_MAX ||
          asset.phonemeTimings.some((timing: unknown) => {
            const phoneme = (timing as { phoneme?: unknown } | null)?.phoneme;
            return (
              !span(timing) ||
              typeof phoneme !== "string" ||
              cleanPhonemes([phoneme])?.[0] !== phoneme
            );
          }))
      )
        throw new Error(
          "A word's sound timings are its sounds, each with a start and a later end.",
        );
      if (asset.wholeWordTiming !== undefined && (!bookWord || !span(asset.wholeWordTiming)))
        throw new Error("A word's whole-word timing has a start and a later end.");
      const playback = readPlayback(asset);
      if (playback === "invalid" || (playback && asset.type !== "audio"))
        throw new Error(
          "Audio playback needs kind (music or sfx), channel, loop, and a volume from 0 to 1, together.",
        );
      if (
        asset.path !== undefined &&
        (typeof asset.path !== "string" ||
          asset.path.length > 1024 ||
          !/^media\/[A-Za-z0-9_./ -]+$/.test(asset.path) ||
          asset.path
            .split("/")
            .some((part) => !part || part === "." || part === ".." || /[. ]$/.test(part)))
      )
        throw new Error("Media paths must be relative media/... paths without traversal or URLs.");
      for (const alias of new Set([
        asset.key,
        ...(asset.sourceKey ? [String(asset.sourceKey)] : []),
      ])) {
        if (aliases.has(alias) && aliases.get(alias) !== asset.key)
          throw new Error("Media sourceKey aliases conflict with another asset.");
        aliases.set(alias, asset.key);
      }
      if (!Array.isArray(asset.usages) || asset.usages.length > 2000)
        throw new Error("Media assets require a usages array.");
      if (asset.generatedAudio !== undefined) {
        const generated = object(asset.generatedAudio);
        if (
          asset.type !== "audio" ||
          Object.keys(generated).some((key) => !["runId", "sha256", "format"].includes(key)) ||
          typeof generated.runId !== "string" ||
          !/^run_[a-f0-9]{32}$/.test(generated.runId) ||
          typeof generated.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(generated.sha256) ||
          (generated.format !== undefined && !["wav", "mp3"].includes(String(generated.format))) ||
          asset.path !==
            generatedAudioPath({
              runId: generated.runId,
              format: generated.format as GeneratedAudioFormat | undefined,
            })
        )
          throw new Error("Invalid generated audio binding.");
      }
      if (asset.generatedImage !== undefined) {
        const generated = object(asset.generatedImage);
        if (
          asset.type !== "image" ||
          Object.keys(generated).some((key) => !["runId", "sha256"].includes(key)) ||
          typeof generated.runId !== "string" ||
          !/^run_[a-f0-9]{32}$/.test(generated.runId) ||
          typeof generated.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(generated.sha256) ||
          asset.path !== `media/generated/${generated.runId}.png`
        )
          throw new Error("Invalid generated image binding.");
      }
      if (asset.generatedVideo !== undefined) {
        const generated = object(asset.generatedVideo);
        if (
          (asset.type !== "video" && asset.type !== "animation") ||
          Object.keys(generated).some((key) => !["runId", "sha256"].includes(key)) ||
          typeof generated.runId !== "string" ||
          !/^run_[a-f0-9]{32}$/.test(generated.runId) ||
          typeof generated.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(generated.sha256) ||
          asset.path !== `media/generated/${generated.runId}.webm`
        )
          throw new Error("Invalid generated video binding.");
      }
      const usages = asset.usages.map((value) => {
        const usage = object(value);
        if (
          typeof usage.sceneId !== "string" ||
          !usage.sceneId ||
          usage.sceneId.length > 128 ||
          !safeKey(usage.sourceKey) ||
          !Number.isSafeInteger(usage.occurrence) ||
          Number(usage.occurrence) < 1 ||
          !Number.isSafeInteger(usage.sceneOccurrenceCount) ||
          Number(usage.sceneOccurrenceCount) < Number(usage.occurrence)
        )
          throw new Error("Invalid media scene usage.");
        return {
          sceneId: usage.sceneId,
          sourceKey: usage.sourceKey,
          occurrence: Number(usage.occurrence),
          sceneOccurrenceCount: Number(usage.sceneOccurrenceCount),
        };
      });
      return {
        key: asset.key,
        type: asset.type as MediaAsset["type"],
        description: asset.description,
        ...(asset.sourceKey !== undefined ? { sourceKey: String(asset.sourceKey) } : {}),
        ...(asset.script !== undefined ? { script: String(asset.script) } : {}),
        ...(asset.translatedFrom !== undefined
          ? { translatedFrom: String(asset.translatedFrom) }
          : {}),
        ...(asset.voice !== undefined ? { voice: String(asset.voice) } : {}),
        ...(asset.speechProvider !== undefined
          ? { speechProvider: asset.speechProvider as SpeechProviderId }
          : {}),
        ...(asset.wordTimings !== undefined
          ? {
              wordTimings: (asset.wordTimings as Record<string, unknown>[]).map((timing) => ({
                word: String(timing.word),
                startMs: Number(timing.startMs),
                endMs: Number(timing.endMs),
              })),
            }
          : {}),
        ...(asset.durationMs !== undefined ? { durationMs: Number(asset.durationMs) } : {}),
        ...(playback ?? {}),
        ...(asset.targetDurationMs !== undefined
          ? { targetDurationMs: Number(asset.targetDurationMs) }
          : {}),
        ...(bookWord ? { role: BOOK_WORD_ROLE } : {}),
        ...(asset.word !== undefined ? { word: String(asset.word) } : {}),
        ...(asset.normalizedWord !== undefined
          ? { normalizedWord: String(asset.normalizedWord) }
          : {}),
        ...(asset.phonemes !== undefined
          ? { phonemes: (asset.phonemes as unknown[]).map(String) }
          : {}),
        ...(asset.phonemeSource !== undefined
          ? { phonemeSource: asset.phonemeSource as PhonemeSource }
          : {}),
        ...(asset.customized !== undefined ? { customized: asset.customized === true } : {}),
        ...(asset.customScript !== undefined ? { customScript: asset.customScript === true } : {}),
        ...(asset.phonemeTimings !== undefined
          ? {
              phonemeTimings: (asset.phonemeTimings as Record<string, unknown>[]).map((timing) => ({
                phoneme: String(timing.phoneme),
                startMs: Number(timing.startMs),
                endMs: Number(timing.endMs),
              })),
            }
          : {}),
        ...(asset.wholeWordTiming !== undefined
          ? {
              wholeWordTiming: {
                startMs: Number((asset.wholeWordTiming as Record<string, unknown>).startMs),
                endMs: Number((asset.wholeWordTiming as Record<string, unknown>).endMs),
              },
            }
          : {}),
        ...(asset.path !== undefined ? { path: String(asset.path) } : {}),
        ...(asset.generatedAudio !== undefined
          ? { generatedAudio: asset.generatedAudio as MediaAsset["generatedAudio"] }
          : {}),
        ...(asset.generatedImage !== undefined
          ? { generatedImage: asset.generatedImage as MediaAsset["generatedImage"] }
          : {}),
        ...(asset.generatedVideo !== undefined
          ? {
              generatedVideo: {
                runId: String((asset.generatedVideo as Record<string, unknown>).runId),
                sha256: String((asset.generatedVideo as Record<string, unknown>).sha256),
              },
            }
          : {}),
        usages,
      };
    });
  }
  if (JSON.stringify(assets).length > 1000000) throw new Error("Media manifest exceeds 1 MB.");
  return { productCode: address.productCode, refNum: address.refNum, assets };
}

/** Planning is deterministic: the saved spec already owns the scene media requirements. */
export function planMedia(activity: ActivityDetail): MediaPlan {
  const spec = activity.draft.spec;
  if (!spec || activity.draft.status !== "valid")
    throw new Error("Save a valid specification before planning media.");
  const entries = new Map<string, MediaAsset>();
  for (const value of (spec.scenes ?? spec.stages) as Record<string, unknown>[]) {
    const media = (value.media ?? {}) as Record<string, unknown>;
    const audio = (value.audio ?? {}) as Record<string, unknown>;
    for (const [type, list] of [
      ["image", media.images],
      ["video", media.video],
      ["animation", media.animations],
      ["audio", audio.tracks],
    ] as const) {
      for (const item of (list ?? []) as Record<string, unknown>[]) {
        const asset: MediaAsset = {
          key: String(item.key),
          type,
          description: String(item.description),
          ...(type === "audio" && item.script !== undefined ? { script: String(item.script) } : {}),
          ...(type === "audio" && typeof item.script === "string"
            ? (playbackFromScript(item.script) ?? {})
            : {}),
          // A Loom tag's `duration` is the length its music or effect asks for.
          ...(type === "audio" &&
          playbackFromScript(item.script as string | undefined) &&
          durationFromScript(item.script as string | undefined) !== undefined
            ? { targetDurationMs: durationFromScript(item.script as string)! }
            : {}),
          usages: [],
        };
        const existing = entries.get(asset.key);
        if (existing && requirement(existing) !== requirement(asset))
          throw new Error(
            `Asset key ${asset.key} has conflicting requirements. Give different assets different keys in the specification.`,
          );
        const target = existing ?? asset;
        const occurrence = target.usages.filter((usage) => usage.sceneId === value.id).length + 1;
        target.usages.push({
          sceneId: String(value.id),
          sourceKey: asset.key,
          occurrence,
          sceneOccurrenceCount: occurrence,
        });
        for (const usage of target.usages)
          if (usage.sceneId === value.id) usage.sceneOccurrenceCount = occurrence;
        entries.set(asset.key, target);
      }
    }
  }
  // Preserve explicit bindings only when the media requirement is unchanged. A targetPath
  // in a generated spec is a suggestion, not evidence that a real asset exists there.
  const previous = activity.draft.mediaPlan?.manifest.assets ?? {};
  const requirements = Object.fromEntries(
    [...entries.values()].map((asset) => [asset.key, contentRevision(requirement(asset))]),
  );
  const assets: Record<string, MediaAsset[]> = {};
  for (const language of new Set(["en-US", ...Object.keys(previous)])) {
    assets[language] = [...entries.values()].flatMap((asset) => {
      const old = previous[language]?.find((entry) => entry.key === asset.key);
      const unchanged =
        activity.draft.mediaPlan?.requirements[asset.key] === requirements[asset.key];
      if (old && unchanged && old.type === asset.type) return [{ ...old, usages: asset.usages }];
      // Missing or changed translations fall back to the default language, never
      // label freshly copied English scripts as translated speech.
      return language === "en-US" ? [{ ...asset }] : [];
    });
    // A book's word pronunciations are not in the specification; they are planned from its
    // narration (book-words.ts) and survive a re-plan. Usages of scenes the specification no
    // longer has go, and a word left in no scene goes too, unless the author customized it.
    const sceneIds = new Set(
      ((spec.scenes ?? spec.stages) as Record<string, unknown>[]).map((scene) => String(scene.id)),
    );
    const planned = new Set(assets[language]!.map((asset) => asset.key));
    for (const old of previous[language] ?? []) {
      if (!isBookWord(old) || planned.has(old.key)) continue;
      const usages = old.usages.filter((usage) => sceneIds.has(usage.sceneId));
      if (usages.length || old.customized) assets[language]!.push({ ...old, usages });
    }
  }
  return {
    specRevision: contentRevision(spec),
    requirements,
    manifest: validateManifest(
      { productCode: activity.productCode, refNum: activity.refNum, assets },
      activity,
    ),
  };
}

export function validateMediaCoverage(manifest: AssetManifest, activity: ActivityDetail): void {
  const required = planMedia(activity).manifest.assets["en-US"]!;
  const defaults = manifest.assets["en-US"];
  if (
    !defaults ||
    required.some(
      (entry) => !defaults.some((asset) => asset.key === entry.key && asset.type === entry.type),
    )
  )
    throw new Error(
      "The en-US media group must include every asset key and type required by the specification.",
    );
  const sceneIds = new Set(
    ((activity.draft.spec!.scenes ?? activity.draft.spec!.stages) as { id: string }[]).map(
      (scene) => scene.id,
    ),
  );
  for (const entries of Object.values(manifest.assets))
    for (const asset of entries)
      if (asset.usages.some((usage) => !sceneIds.has(usage.sceneId)))
        throw new Error("Media usage references an unknown scene.");
}

function requirement(asset: MediaAsset): string {
  return JSON.stringify([asset.type, asset.description, asset.script ?? ""]);
}

export function mediaConfiguration(manifest: AssetManifest): Record<string, unknown> {
  const languages: Record<string, Record<string, string>> = {};
  for (const [language, assets] of Object.entries(manifest.assets)) {
    const bindings: Record<string, string> = {};
    for (const asset of assets) {
      if (!asset.path) continue;
      const url = `{{MEDIA}}/${asset.path.slice("media/".length)}`;
      bindings[asset.key] = url;
      if (asset.sourceKey) bindings[asset.sourceKey] = url;
    }
    languages[language] = bindings;
  }
  return { [manifest.productCode]: { telemetry: false, ...languages } };
}

/**
 * Storage provenance belongs to Penguin, not Loom's runtime asset schema; so do a word's
 * authored-script mark and its sound timings, which reach the module through the book
 * configuration instead.
 */
export function wafManifest(manifest: AssetManifest): AssetManifest {
  return {
    ...manifest,
    assets: Object.fromEntries(
      Object.entries(manifest.assets).map(([language, assets]) => [
        language,
        assets.map(
          ({
            generatedAudio: _audio,
            generatedImage: _image,
            generatedVideo: _video,
            phonemeSource: _source,
            customScript: _script,
            phonemeTimings: _sounds,
            wholeWordTiming: _word,
            ...asset
          }) => asset,
        ),
      ]),
    ),
  };
}
