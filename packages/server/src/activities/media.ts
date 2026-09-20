import { contentRevision, type ActivityDetail, type ActivityAddress } from "./domain.js";

export interface MediaAsset {
  key: string;
  type: "image" | "audio" | "video" | "animation";
  description: string;
  sourceKey?: string;
  script?: string;
  /** A reference in the WAF media checkout, never a server filesystem path. */
  path?: string;
  generatedAudio?: { runId: string; sha256: string };
  generatedImage?: { runId: string; sha256: string };
  usages: {
    sceneId: string;
    sourceKey: string;
    occurrence: number;
    sceneOccurrenceCount: number;
  }[];
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
              "path",
              "usages",
              "generatedAudio",
              "generatedImage",
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
          Object.keys(generated).some((key) => !["runId", "sha256"].includes(key)) ||
          typeof generated.runId !== "string" ||
          !/^run_[a-f0-9]{32}$/.test(generated.runId) ||
          typeof generated.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(generated.sha256) ||
          asset.path !== `media/generated/${generated.runId}.wav`
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
        ...(asset.path !== undefined ? { path: String(asset.path) } : {}),
        ...(asset.generatedAudio !== undefined
          ? { generatedAudio: asset.generatedAudio as MediaAsset["generatedAudio"] }
          : {}),
        ...(asset.generatedImage !== undefined
          ? { generatedImage: asset.generatedImage as MediaAsset["generatedImage"] }
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

/** Storage provenance belongs to Penguin, not Loom's runtime asset schema. */
export function wafManifest(manifest: AssetManifest): AssetManifest {
  return {
    ...manifest,
    assets: Object.fromEntries(
      Object.entries(manifest.assets).map(([language, assets]) => [
        language,
        assets.map(({ generatedAudio: _audio, generatedImage: _image, ...asset }) => asset),
      ]),
    ),
  };
}
