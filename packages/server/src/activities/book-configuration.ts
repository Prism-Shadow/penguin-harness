import type { ActivityDetail } from "./domain.js";
import {
  mediaConfiguration,
  validateManifest,
  type AssetManifest,
  type MediaAsset,
} from "./media.js";
import { interpretBookScenes, validateBookSpec, type BookScene } from "./book.js";

const DEFAULT_LANGUAGE = "en-US";
const READING_DELAY = {
  secondsPerWord: 0.5,
  minimumSeconds: 3,
  maximumSeconds: 10,
};

export type BookMode = "readAlong" | "decodable";

/** Compile the approved book draft into the native WAF product configuration. */
export function compileBookConfiguration(
  activity: ActivityDetail,
  mode: BookMode,
  manifest: AssetManifest,
): Record<string, unknown> {
  if (mode !== "readAlong" && mode !== "decodable")
    throw new Error("Book configuration mode must be readAlong or decodable.");
  manifest = validateManifest(manifest, activity);
  if (!manifest.assets[DEFAULT_LANGUAGE])
    throw new Error("Book configuration requires an en-US media group.");
  if (
    Object.values(manifest.assets)
      .flat()
      .some((asset) => asset.key === "scenes" || asset.sourceKey === "scenes")
  )
    throw new Error("Book media keys cannot use the reserved scenes configuration key.");
  const spec = activity.draft.spec;
  if (!spec) throw new Error("Book configuration requires a saved activity specification.");
  validateBookSpec(spec);
  const scenes = interpretBookScenes(spec);
  const index = new ManifestIndex(manifest);
  if (mode === "decodable") requireFinalStoryNarration(scenes, index);

  const layered = mediaConfiguration(manifest);
  const product = asObject(layered[activity.productCode]);
  const intro = index.asset("video", "book-intro-video", DEFAULT_LANGUAGE);
  product.book = {
    mode,
    readingDelay: { ...READING_DELAY },
    ...(intro?.path
      ? {
          introVideoKey: "book-intro-video",
          introVideoUrl: `{{MEDIA}}/${intro.path.slice("media/".length)}`,
        }
      : {}),
  };
  const languages = new Set([DEFAULT_LANGUAGE, ...Object.keys(manifest.assets)]);
  const defaultScenes = compileScenes(scenes, index, DEFAULT_LANGUAGE);
  const defaultMedia = { ...asObject(product[DEFAULT_LANGUAGE]) };
  delete defaultMedia.scenes;
  for (const language of languages) {
    const complete = language === DEFAULT_LANGUAGE || hasCompleteNarration(scenes, index, language);
    const compiled = complete ? compileScenes(scenes, index, language) : clone(defaultScenes);
    product[language] = {
      ...defaultMedia,
      ...(complete ? asObject(product[language]) : {}),
      scenes: compiled,
    };
  }
  layered[activity.productCode] = product;
  return layered;
}

class ManifestIndex {
  private readonly byLanguage: Record<string, MediaAsset[]>;

  constructor(manifest: AssetManifest) {
    this.byLanguage = manifest.assets;
  }

  asset(
    type: MediaAsset["type"],
    key: string,
    language: string,
    allowDefault = false,
  ): MediaAsset | undefined {
    if (!key) return undefined;
    const entries = this.byLanguage[language] ?? [];
    const exact = entries.find((entry) => entry.type === type && entry.key === key);
    const alias = entries.find((entry) => entry.type === type && entry.sourceKey === key);
    if (exact || alias) return exact ?? alias;
    if (allowDefault && language !== DEFAULT_LANGUAGE)
      return this.asset(type, key, DEFAULT_LANGUAGE, false);
    return undefined;
  }
}

function compileScenes(scenes: BookScene[], index: ManifestIndex, language: string) {
  return scenes.map((scene) => {
    const imageAsset = index.asset("image", scene.image.key, language, true);
    const audioCues = scene.audioCues.map((cue) => {
      const asset = index.asset("audio", cue.key, language, language === DEFAULT_LANGUAGE);
      return { key: cue.key, script: textFromAsset(asset?.script, cue.script) };
    });
    const narrationCue = audioCues[0] ?? null;
    if (scene.role === "story" && narrationCue && !/[\p{L}\p{N}]/u.test(narrationCue.script))
      throw new Error(
        `Book story page "${scene.id}" narration in ${language} must contain visible words.`,
      );
    return {
      id: scene.id,
      description: scene.description,
      role: scene.role,
      pageNumber: scene.pageNumber,
      media: {
        image: {
          key: scene.image.key,
          alt: textFromAsset(imageAsset?.description, scene.image.description),
        },
        audioCues,
        narration: narrationCue ? { ...narrationCue, timings: [], words: [] } : null,
      },
    };
  });
}

function hasCompleteNarration(
  scenes: BookScene[],
  index: ManifestIndex,
  language: string,
): boolean {
  const keys = scenes.flatMap((scene) => scene.audioCues.map((cue) => cue.key)).filter(Boolean);
  return (
    keys.length > 0 &&
    keys.every((key) => {
      const asset = index.asset("audio", key, language);
      return Boolean(asset?.path?.trim() && asset.script?.trim());
    })
  );
}

function requireFinalStoryNarration(scenes: BookScene[], index: ManifestIndex): void {
  const finalStory = [...scenes].reverse().find((scene) => scene.role === "story");
  const key = finalStory?.audioCues[0]?.key;
  const asset = key ? index.asset("audio", key, DEFAULT_LANGUAGE) : undefined;
  if (!key || !asset?.path?.trim() || !asset.script?.trim())
    throw new Error("Decodable book configuration requires final story narration in en-US.");
}

function textFromAsset(value: string | undefined, fallback: string): string {
  return value?.trim() ? value.trim() : fallback;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
