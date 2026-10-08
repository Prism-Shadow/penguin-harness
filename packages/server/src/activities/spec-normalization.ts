/**
 * Loom's activity specification normalization, read out of `normalization.py`,
 * `generation.py`, `general_scene.py` and `media_contract.py`.
 *
 * An agent writes a specification; this turns what it wrote into the one shape the rest of
 * Penguin reads. Every scene comes out as `{ id, description, role?, media: { images, video,
 * animations }, audio: { tracks } }` and nothing else, so media an agent put anywhere but
 * those four lists is dropped here rather than saved where `planMedia` never looks. The media
 * pass (`generate_media_spec`) is what fills the lists, from the description's tags.
 *
 * One deliberate difference from Loom: a track without a script keeps no script. Loom writes
 * the placeholder "empty"; Penguin reads a missing script as "not written yet" and would
 * otherwise speak the word.
 */

type Json = Record<string, unknown>;

export interface SpecAsset {
  key: string;
  description: string;
  targetPath?: string;
}

export interface SpecTrack extends SpecAsset {
  script?: string;
  interruptible?: boolean;
  voice?: string;
}

export interface SpecScene {
  id: string;
  description: string;
  role?: unknown;
  media: { images: SpecAsset[]; video: SpecAsset[]; animations: SpecAsset[] };
  audio: { tracks: SpecTrack[] };
}

export const GENERAL_SCENE_ID = "general";
export const GENERAL_SCENE_ROLE = "general";

const isObject = (value: unknown): value is Json =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Python's `a or b` for the lists Loom reads: an empty or missing list falls through. */
const firstList = (...values: unknown[]): unknown =>
  values.find((value) => Array.isArray(value) && value.length) ?? values.at(-1);

const text = (value: unknown): string =>
  value === undefined || value === null ? "" : String(value);

/** The scenes of a specification, under either of Loom's names for them. */
export function rawScenes(spec: Json | null | undefined): unknown {
  return firstList(spec?.scenes, spec?.stages);
}

// --- Tags in a description -------------------------------------------------------------

const PRIMARY_SCENE_HEADING = /^\s*Scene\s+(\d+)\s*:/gim;
/** Not global: `exec` on a global pattern leaves a `lastIndex` that `matchAll` then copies. */
const FIRST_SCENE_HEADING = /^\s*Scene\s+(\d+)\s*:/im;
const SCENE_ID_NUMBER = /^scene-(\d+)(?:-|$)/i;
const ASSET_TAG = /<(audio|image|video|animation)\b[^>]*>[\s\S]*?<\/\1>/i;
const SCENE_AUDIO_TAG = /<audio\b[^>]*>[\s\S]*?<\/audio>/gi;
const ASSET_KEY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "for",
  "from",
  "in",
  "of",
  "on",
  "the",
  "to",
  "with",
]);

/** The script before its first `Scene N:` heading, where shared media is declared. */
export function descriptionPreamble(description: string): string {
  const first = FIRST_SCENE_HEADING.exec(description);
  return first ? description.slice(0, first.index) : "";
}

/** Whether the script tags media before its first scene, which makes a general scene. */
export function hasGeneralMediaSection(description: string): boolean {
  return ASSET_TAG.test(descriptionPreamble(description));
}

/**
 * How many scenes the script asks for: one per distinct `Scene N:` heading (subsections
 * such as Scene 8a belong to their scene), plus the general scene. Null without headings.
 */
export function expectedPrimarySceneCount(description: string): number | null {
  const numbers = new Set([...description.matchAll(PRIMARY_SCENE_HEADING)].map((m) => m[1]));
  if (!numbers.size) return null;
  return numbers.size + (hasGeneralMediaSection(description) ? 1 : 0);
}

function slug(value: unknown): string {
  return text(value)
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/^-+|-+$/g, "");
}

function sceneKeySlug(sceneId: unknown): string {
  const match = SCENE_ID_NUMBER.exec(text(sceneId));
  return match ? `scene-${match[1]}` : slug(sceneId) || "scene";
}

export function sceneAssetKeyPrefix(sceneId: unknown, kind: string): string {
  return `${sceneKeySlug(sceneId)}-${kind}`;
}

/** `<scene>-<kind>-<subject>`, the subject being the description's first four content words. */
export function readableAssetKey(sceneId: unknown, kind: string, description: unknown): string {
  const subject = slug(description)
    .split("-")
    .filter((word) => word && !ASSET_KEY_STOP_WORDS.has(word))
    .slice(0, 4)
    .join("-");
  return [sceneAssetKeyPrefix(sceneId, kind), subject || "asset"].filter(Boolean).join("-");
}

// --- Audio tags --------------------------------------------------------------------------

export type AudioCueKind = "speech" | "music" | "sfx";
export interface AudioCue {
  kind: AudioCueKind;
  prompt: string;
  voice: string | null;
}

const AUDIO_TAG = /^\s*<audio\b([^>]*)>([\s\S]*)<\/audio>\s*$/i;
const ATTR = /([a-zA-Z_][\w-]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/g;
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function unescapeHtml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

/**
 * Loom's `parse_audio_script`: an untagged script is speech; a wrapping `<audio>` tag names
 * its kind. Null where Loom raises — an unknown kind, a voice on music or an effect, or a
 * loop, volume or duration that does not parse.
 */
export function parseAudioCue(script: string): AudioCue | null {
  const tag = AUDIO_TAG.exec(script);
  if (!tag) return { kind: "speech", prompt: script.trim(), voice: null };
  const attrs: Record<string, string> = {};
  for (const [, name, raw] of tag[1]!.matchAll(ATTR)) {
    const quoted = raw!.length >= 2 && raw![0] === raw!.at(-1) && `"'`.includes(raw![0]!);
    attrs[name!.toLowerCase()] = quoted ? raw!.slice(1, -1) : raw!;
  }
  const kind = (attrs.kind ?? "speech").trim().toLowerCase() || "speech";
  if (kind !== "speech" && kind !== "music" && kind !== "sfx") return null;
  const voice = attrs.voice?.trim() || null;
  if (voice !== null && kind !== "speech") return null;
  if (
    attrs.loop !== undefined &&
    !["true", "1", "yes", "on", "false", "0", "no", "off"].includes(attrs.loop.trim().toLowerCase())
  )
    return null;
  if (attrs.volume !== undefined) {
    const volume = Number(attrs.volume.trim());
    if (attrs.volume.trim() === "" || !Number.isFinite(volume) || volume < 0 || volume > 1)
      return null;
  }
  if (kind !== "speech" && attrs.duration !== undefined) {
    const seconds = /^\s*(\d+(?:\.\d*)?|\.\d+)\s*s?\s*$/i.exec(attrs.duration);
    if (!seconds || Number(seconds[1]) <= 0) return null;
  }
  return { kind, prompt: unescapeHtml(tag[2]!).trim(), voice };
}

/** Every well-formed `<audio>` tag in a description, parsed, with the tag as written. */
export function audioCuesInDescription(description: string): { cue: AudioCue; tag: string }[] {
  const cues: { cue: AudioCue; tag: string }[] = [];
  for (const match of description.matchAll(SCENE_AUDIO_TAG)) {
    const tag = match[0].trim();
    const cue = parseAudioCue(tag);
    if (cue) cues.push({ cue, tag });
  }
  return cues;
}

// --- Scenes ------------------------------------------------------------------------------

/** Loom's rule: a scene whose role is general, or which has no role and the id "general". */
export function isGeneralSpecScene(scene: unknown): boolean {
  if (!isObject(scene)) return false;
  const role = text(scene.role).trim().toLowerCase();
  if (role === GENERAL_SCENE_ROLE) return true;
  return !role && text(scene.id).trim().toLowerCase() === GENERAL_SCENE_ID;
}

/** A target path that names a file; Loom writes "empty" for one that does not. */
function meaningfulTargetPath(value: unknown): string {
  const path = text(value).trim();
  return !path || path.toLowerCase() === "empty" ? "" : path;
}

function voiceSelection(value: unknown): string | undefined {
  const voice = text(value).trim();
  if (!voice) return undefined;
  return ["auto", "default"].includes(voice.toLowerCase()) ? voice.toLowerCase() : voice;
}

function normalizeAssets(assets: unknown, sceneId: string, kind: string): SpecAsset[] {
  if (!Array.isArray(assets)) return [];
  const normalized: SpecAsset[] = [];
  for (const raw of assets) {
    if (typeof raw === "string") {
      const description = raw.trim();
      if (description)
        normalized.push({ key: readableAssetKey(sceneId, kind, description), description });
      continue;
    }
    if (!isObject(raw)) continue;
    const description =
      text(raw.description).trim() ||
      `${kind[0]!.toUpperCase()}${kind.slice(1)} for scene ${sceneId}.`;
    const asset: SpecAsset = {
      key: text(raw.key) || readableAssetKey(sceneId, kind, description),
      description,
    };
    const targetPath = meaningfulTargetPath(raw.targetPath);
    if (targetPath) asset.targetPath = targetPath;
    normalized.push(asset);
  }
  return normalized;
}

function normalizeTracks(tracks: unknown, sceneId: string): SpecTrack[] {
  if (!Array.isArray(tracks)) return [];
  const normalized: SpecTrack[] = [];
  for (const raw of tracks) {
    if (typeof raw === "string") {
      const description = raw.trim();
      if (description)
        normalized.push({ key: readableAssetKey(sceneId, "audio", description), description });
      continue;
    }
    if (!isObject(raw)) continue;
    const description = text(raw.description).trim() || `Audio for scene ${sceneId}.`;
    const track: SpecTrack = {
      key: text(raw.key) || readableAssetKey(sceneId, "audio", description),
      description,
    };
    const script = text(raw.script).trim();
    if (script && script !== "empty") track.script = script;
    if ("interruptible" in raw) track.interruptible = !!raw.interruptible;
    const targetPath = meaningfulTargetPath(raw.targetPath);
    if (targetPath) track.targetPath = targetPath;
    const voice = voiceSelection(raw.voice);
    if (voice) track.voice = voice;
    normalized.push(track);
  }
  return normalized;
}

/**
 * Every scene in the canonical shape, general scenes first. Media outside `media` and
 * `audio` — a flat `videos` or `tracks` list, say — is not carried.
 */
export function normalizeScenes(scenes: unknown): SpecScene[] {
  if (!Array.isArray(scenes)) return [];
  const normalized: SpecScene[] = [];
  scenes.forEach((raw, index) => {
    if (!isObject(raw)) return;
    const id = text(raw.id) || `scene-${index + 1}`;
    const media = isObject(raw.media) ? raw.media : {};
    const audio = isObject(raw.audio) ? raw.audio : {};
    const scene: SpecScene = {
      id,
      description: text(raw.description),
      media: {
        images: normalizeAssets(media.images, id, "image"),
        video: normalizeAssets(media.video, id, "video"),
        animations: normalizeAssets(media.animations, id, "animation"),
      },
      audio: { tracks: normalizeTracks(audio.tracks, id) },
    };
    if ("role" in raw) scene.role = raw.role;
    if (isGeneralSpecScene(scene)) {
      scene.id = GENERAL_SCENE_ID;
      scene.role = GENERAL_SCENE_ROLE;
    }
    normalized.push(scene);
  });
  const general = normalized.filter(isGeneralSpecScene);
  return general.length
    ? [...general, ...normalized.filter((scene) => !isGeneralSpecScene(scene))]
    : normalized;
}

export function normalizedSceneIds(spec: Json | null | undefined): string[] {
  return normalizeScenes(rawScenes(spec)).map((scene) => scene.id);
}

/** Whether any scene already lists media, which makes the media pass preserve its keys. */
export function specHasMediaEntries(spec: Json | null | undefined): boolean {
  const scenes = rawScenes(spec);
  if (!Array.isArray(scenes)) return false;
  return scenes.some((scene) => {
    if (!isObject(scene)) return false;
    const media = scene.media;
    if (
      isObject(media) &&
      (["images", "video", "animations"] as const).some(
        (kind) => Array.isArray(media[kind]) && (media[kind] as unknown[]).length,
      )
    )
      return true;
    const audio = scene.audio;
    return isObject(audio) && Array.isArray(audio.tracks) && audio.tracks.length > 0;
  });
}

function sceneLists(scene: SpecScene): [string, SpecAsset[]][] {
  return [
    ["image", scene.media.images],
    ["video", scene.media.video],
    ["animation", scene.media.animations],
    ["audio", scene.audio.tracks],
  ];
}

function uniqueKey(candidate: string, used: Set<string>): string {
  const base = candidate || "asset";
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

/** A newly planned asset gets a readable, globally unique key in its scene's prefix. */
export function normalizeNewAssetKeys(scenes: SpecScene[]): void {
  const used = new Set<string>();
  for (const scene of scenes)
    for (const [kind, entries] of sceneLists(scene))
      for (const entry of entries) {
        let key = entry.key.trim();
        if (!key.startsWith(`${sceneAssetKeyPrefix(scene.id, kind)}-`))
          key = readableAssetKey(scene.id, kind, entry.description);
        entry.key = uniqueKey(key, used);
        used.add(entry.key);
      }
}

/** A speech tag's `voice` copied onto the track it became. */
export function applyAuthoredAudioVoices(scenes: SpecScene[]): void {
  for (const scene of scenes) {
    const tracks = scene.audio.tracks;
    const available = new Set(tracks.map((_, index) => index));
    audioCuesInDescription(scene.description).forEach(({ cue }, cueIndex) => {
      let match: number | undefined = [...available]
        .sort((a, b) => a - b)
        .find((index) => {
          const parsed = parseAudioCue(tracks[index]!.script ?? "");
          return parsed && parsed.kind === cue.kind && parsed.prompt === cue.prompt;
        });
      if (match === undefined && available.has(cueIndex)) match = cueIndex;
      if (match === undefined) return;
      available.delete(match);
      if (cue.voice !== null) tracks[match]!.voice = cue.voice;
    });
  }
}

/** Music and effect tags the media pass left out become tracks of their own, script verbatim. */
export function backfillMediaAudioTracks(scenes: SpecScene[]): void {
  const used = new Set(scenes.flatMap((scene) => scene.audio.tracks.map((track) => track.key)));
  for (const scene of scenes) {
    const authored = audioCuesInDescription(scene.description).filter(
      ({ cue }) => cue.kind === "music" || cue.kind === "sfx",
    );
    if (!authored.length) continue;
    const existing = new Set<string>();
    for (const track of scene.audio.tracks) {
      const parsed = parseAudioCue(track.script ?? "");
      if (parsed && parsed.kind !== "speech") existing.add(`${parsed.kind}\0${parsed.prompt}`);
    }
    for (const { cue, tag } of authored) {
      const id = `${cue.kind}\0${cue.prompt}`;
      if (existing.has(id)) continue;
      let index = 1;
      while (used.has(`${scene.id}-${cue.kind}-${index}`)) index += 1;
      const key = `${scene.id}-${cue.kind}-${index}`;
      used.add(key);
      existing.add(id);
      scene.audio.tracks.push({
        key,
        description: `${cue.kind} cue: ${cue.prompt.slice(0, 60)}`.trim(),
        script: tag,
      });
    }
  }
}

function preserveExistingMetadata(generated: SpecTrack, existing: SpecTrack): void {
  const targetPath = meaningfulTargetPath(existing.targetPath);
  if (targetPath) generated.targetPath = targetPath;
  if (!("voice" in generated)) {
    const voice = voiceSelection(existing.voice);
    if (voice !== undefined) generated.voice = voice;
  }
}

function matchExisting(generated: SpecTrack, available: SpecTrack[]): SpecTrack | undefined {
  for (const field of ["targetPath", "script", "description"] as const) {
    const value = text(generated[field]).trim();
    if (!value || value === "empty") continue;
    const matches = available.filter((asset) => text(asset[field]).trim() === value);
    if (matches.length === 1) return matches[0];
  }
  return undefined;
}

/**
 * Loom's `reconcile_asset_keys`: a regenerated list keeps the keys the old one had. An entry
 * keeps its key when the old list has it; otherwise it takes the key of the old entry with
 * the same path, script or description, else (when there are enough old entries left) the
 * next old entry's, else a unique key of its own.
 */
export function reconcileAssetKeys(existing: SpecTrack[], generated: SpecTrack[]): SpecTrack[] {
  if (!generated.length) return [];
  const existingByKey = new Map<string, SpecTrack>();
  for (const asset of existing) if (asset.key.trim()) existingByKey.set(asset.key.trim(), asset);
  const reserved = new Set(
    generated.map((asset) => asset.key.trim()).filter((key) => existingByKey.has(key)),
  );
  const available = existing.filter((asset) => !reserved.has(asset.key.trim()));
  const reconciled: SpecTrack[] = [];
  const used = new Set<string>();
  const deferred: number[] = [];
  generated.forEach((raw, index) => {
    const asset = { ...raw };
    const key = asset.key.trim();
    if (key && existingByKey.has(key) && !used.has(key)) {
      asset.key = key;
      preserveExistingMetadata(asset, existingByKey.get(key)!);
      reconciled.push(asset);
      used.add(key);
      return;
    }
    deferred.push(index);
    reconciled.push(asset);
  });
  const positional = deferred.length <= available.length;
  for (const index of deferred) {
    const asset = reconciled[index]!;
    let match = matchExisting(asset, available);
    if (!match && positional && available.length) match = available[0];
    if (match) {
      const key = match.key.trim();
      if (key && !used.has(key)) {
        asset.key = key;
        preserveExistingMetadata(asset, match);
        used.add(key);
        available.splice(available.indexOf(match), 1);
        continue;
      }
    }
    asset.key = uniqueKey(asset.key.trim(), used);
    used.add(asset.key);
  }
  return reconciled;
}

function mergeSceneKeys(existing: SpecScene, generated: SpecScene): SpecScene {
  return {
    ...generated,
    id: existing.id,
    media: {
      images: reconcileAssetKeys(existing.media.images, generated.media.images),
      video: reconcileAssetKeys(existing.media.video, generated.media.video),
      animations: reconcileAssetKeys(existing.media.animations, generated.media.animations),
    },
    audio: { tracks: reconcileAssetKeys(existing.audio.tracks, generated.audio.tracks) },
  };
}

// --- Top level ---------------------------------------------------------------------------

function normalizeCriteria(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const criterion = entry.trim();
    if (criterion) seen.add(criterion);
  }
  return [...seen];
}

const isSectionHeading = (line: string) =>
  /^#{1,6}\s+/.test(line) || /^[A-Za-z][A-Za-z0-9 /&()'-]{0,80}:$/.test(line);

/** The lines under an "Acceptance Criteria" heading, with list markers taken off. */
export function extractAcceptanceCriteria(description: string): string[] {
  const lines = description.replace(/\r\n?/g, "\n").split("\n");
  const header = lines.findIndex((raw) => {
    const heading = raw
      .trim()
      .replace(/^#{1,6}\s*/, "")
      .trim()
      .replace(/:$/, "")
      .trim();
    return !!heading && heading.toLowerCase() === "acceptance criteria";
  });
  if (header < 0) return [];
  const criteria: string[] = [];
  for (const raw of lines.slice(header + 1)) {
    const stripped = raw.trim();
    if (!stripped) continue;
    if (isSectionHeading(stripped)) break;
    const criterion = stripped
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .replace(/^\[[ xX]]\s+/, "")
      .trim();
    if (criterion) criteria.push(criterion);
  }
  return normalizeCriteria(criteria);
}

function normalizeRuntime(generated: unknown, fallback: unknown, description: string): Json {
  const runtime: Json = isObject(fallback) ? { ...fallback } : {};
  if (isObject(generated)) Object.assign(runtime, generated);
  if (/['"]?usesAssessment['"]?\s*(?::|=)\s*true\b/i.test(description))
    runtime.usesAssessment = true;
  return runtime;
}

/** The fields Loom rebuilds; whatever else the specification carries is kept as it was. */
function withoutRebuilt(spec: Json): Json {
  const {
    scenes: _scenes,
    stages: _stages,
    runtime: _runtime,
    activityDescription: _description,
    acceptance_criterias: _criteria,
    ...rest
  } = spec;
  return rest;
}

/** A first specification, as `generate_activity_spec` saves it. */
export function normalizeActivitySpec(generated: Json, description: string): Json {
  const scenes = normalizeScenes(rawScenes(generated));
  applyAuthoredAudioVoices(scenes);
  normalizeNewAssetKeys(scenes);
  const generatedCriteria = normalizeCriteria(generated.acceptance_criterias);
  return {
    ...withoutRebuilt(generated),
    runtime: normalizeRuntime(generated.runtime, {}, description),
    activityDescription: text(generated.activityDescription) || description.trim(),
    acceptance_criterias: generatedCriteria.length
      ? generatedCriteria
      : extractAcceptanceCriteria(description),
    scenes,
  };
}

/** A specification regenerated over an existing one: scenes it kept keep their asset keys. */
export function normalizeActivitySpecUpdate(
  existing: Json,
  generated: Json,
  description: string,
): Json {
  const existingById = new Map(
    normalizeScenes(rawScenes(existing)).map((scene) => [scene.id, scene]),
  );
  const scenes = normalizeScenes(rawScenes(generated)).map((scene) =>
    existingById.has(scene.id) ? mergeSceneKeys(existingById.get(scene.id)!, scene) : scene,
  );
  applyAuthoredAudioVoices(scenes);
  const extracted = extractAcceptanceCriteria(description);
  return {
    ...withoutRebuilt(generated),
    runtime: normalizeRuntime(generated.runtime, existing.runtime, description),
    activityDescription: text(generated.activityDescription) || description.trim(),
    acceptance_criterias: extracted.length
      ? extracted
      : normalizeCriteria(generated.acceptance_criterias),
    scenes,
  };
}

/** Why a media pass's scenes are not the ones it was given, or null when they are. */
export function mediaSpecSceneMismatch(expected: string[], actual: string[]): string | null {
  const sorted = (ids: string[]) => [...ids].sort().join("\0");
  if (sorted(expected) === sorted(actual)) return null;
  return (
    "Media enrichment must return exactly the activity spec scene ids and no others. " +
    `Expected ${expected.length} scenes ${JSON.stringify(expected)}, ` +
    `but got ${actual.length} scenes ${JSON.stringify(actual)}.`
  );
}

/**
 * The media pass's output merged onto the specification it was given: the given scenes in
 * their order, each with the media the pass listed and the keys it already had; music and
 * effect tags the pass missed added back. Throws when the pass changed the scene set.
 */
export function normalizeMediaSpec(existing: Json, generated: Json): Json {
  const generatedScenes = normalizeScenes(rawScenes(generated));
  const existingScenes = normalizeScenes(rawScenes(existing));
  const mismatch = mediaSpecSceneMismatch(
    existingScenes.map((scene) => scene.id),
    generatedScenes.map((scene) => scene.id),
  );
  if (mismatch) throw new Error(mismatch);
  const generatedById = new Map(generatedScenes.map((scene) => [scene.id, scene]));
  const scenes = existingScenes.length
    ? existingScenes.map((scene) => mergeSceneKeys(scene, generatedById.get(scene.id)!))
    : existingScenes;
  backfillMediaAudioTracks(scenes);
  applyAuthoredAudioVoices(scenes);
  if (!specHasMediaEntries(existing)) normalizeNewAssetKeys(scenes);
  const generatedCriteria = normalizeCriteria(generated.acceptance_criterias);
  return {
    ...withoutRebuilt(existing),
    runtime: isObject(generated.runtime) ? generated.runtime : existing.runtime,
    activityDescription: text(generated.activityDescription) || text(existing.activityDescription),
    acceptance_criterias: generatedCriteria.length
      ? generatedCriteria
      : normalizeCriteria(existing.acceptance_criterias),
    scenes,
  };
}

// --- Media contract ----------------------------------------------------------------------

const VALID_MEDIA_ELEMENT =
  /<\s*(audio|video|image|animation)\b[^>]*?\/\s*>|<\s*(audio|video|image|animation)\b[^>]*?>[\s\S]*?<\/\s*\2\s*>/gi;

/**
 * Loom's `validate_activity_media_contract` as the media pass runs it: every tag in a scene's
 * description has an asset of its kind, and no asset key is listed twice. Each problem is
 * `scene:line:column: message`, sorted; empty when the specification keeps the contract.
 */
export function mediaContractIssues(spec: Json): string[] {
  const issues: { sceneId: string; message: string }[] = [];
  const keyScenes = new Map<string, string>();
  for (const scene of normalizeScenes(rawScenes(spec))) {
    const counts: Record<string, number> = { audio: 0, video: 0, image: 0, animation: 0 };
    for (const match of scene.description.matchAll(VALID_MEDIA_ELEMENT))
      counts[(match[1] ?? match[2])!.toLowerCase()]! += 1;
    const listed: Record<string, SpecAsset[]> = {
      animation: scene.media.animations,
      audio: scene.audio.tracks,
      image: scene.media.images,
      video: scene.media.video,
    };
    for (const [kind, count] of Object.entries(counts)) {
      const assets = listed[kind]!.length;
      if (assets < count)
        issues.push({
          sceneId: scene.id,
          message: `description contains ${count} <${kind}> element(s), but the scene defines ${assets} ${kind} asset(s)`,
        });
    }
    for (const assets of Object.values(listed))
      for (const asset of assets) {
        if (!asset.key) continue;
        const previous = keyScenes.get(asset.key);
        if (previous === undefined) keyScenes.set(asset.key, scene.id);
        else
          issues.push({
            sceneId: scene.id,
            message: `asset key "${asset.key}" is already defined in scene "${previous}"`,
          });
      }
  }
  return issues
    .sort((a, b) =>
      a.sceneId === b.sceneId ? a.message.localeCompare(b.message) : a.sceneId < b.sceneId ? -1 : 1,
    )
    .map((issue) => `${issue.sceneId}:1:1: ${issue.message}`);
}
