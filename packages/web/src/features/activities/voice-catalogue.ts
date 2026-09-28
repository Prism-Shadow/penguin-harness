/**
 * What the voice picker shows: the voices matching a search and the chosen filters, the
 * filters worth offering, and the voice a set of narrations shares. Pure, so it is tested
 * without a DOM.
 */
import type { MediaAsset, VoiceOption } from "@prismshadow/penguin-server/api";

export interface VoiceFilters {
  query: string;
  provider: string;
  model: string;
  language: string;
}

export const NO_VOICE_FILTERS: VoiceFilters = { query: "", provider: "", model: "", language: "" };

/** Words of a name or id: split at spaces, `_`, `-`, `.` and camelCase humps, lower-cased. */
export function tokens(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_.-]+/)
    .map((word) => word.toLowerCase())
    .filter(Boolean);
}

/** Every word of the query appears in the voice's name or id. An empty query matches all. */
export function matchesVoice(option: VoiceOption, query: string): boolean {
  const wanted = tokens(query);
  if (!wanted.length) return true;
  const haystack = [
    option.label.toLowerCase(),
    option.id.toLowerCase(),
    ...tokens(option.label),
    ...tokens(option.id),
  ].join(" ");
  return wanted.every((word) => haystack.includes(word));
}

/** A voice that lists no languages speaks every language. */
function speaks(option: VoiceOption, language: string): boolean {
  return !language || !option.languages.length || option.languages.includes(language);
}

export function filterVoices(
  options: readonly VoiceOption[],
  filters: VoiceFilters,
): VoiceOption[] {
  return options.filter(
    (option) =>
      (!filters.provider || option.provider === filters.provider) &&
      (!filters.model || option.model === filters.model) &&
      speaks(option, filters.language) &&
      matchesVoice(option, filters.query),
  );
}

export interface VoiceFacets {
  providers: string[];
  models: string[];
  languages: string[];
}

/** Distinct values per filter. A filter is worth showing only with two or more. */
export function facetValues(options: readonly VoiceOption[]): VoiceFacets {
  const distinct = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b));
  return {
    providers: distinct(options.map((option) => option.provider)),
    models: distinct(options.map((option) => option.model)),
    languages: distinct(options.flatMap((option) => option.languages)),
  };
}

export function shownFacet(values: readonly string[]): boolean {
  return values.length >= 2;
}

/** The details line under a voice: provider, model, and its languages when it names any. */
export function voiceDetails(option: VoiceOption): string[] {
  return [
    option.provider,
    option.model,
    ...(option.languages.length ? [option.languages.join(", ")] : []),
  ].filter(Boolean);
}

/** A narration: spoken audio, as opposed to music or a sound effect. */
export function isNarration(asset: MediaAsset): boolean {
  return asset.type === "audio" && !asset.kind;
}

/**
 * The voice the narrations share: that voice when every one names it, "mixed" when they
 * differ (a narration naming none counts as different from one naming a voice), and null
 * when none names a voice or there is no narration. Given the voices Penguin can speak, a
 * saved voice outside them counts as naming none, since generation falls back to the
 * default for it (see voiceFor).
 */
export function mixedVoice(
  assets: readonly MediaAsset[],
  options?: readonly VoiceOption[],
): string | "mixed" | null {
  const speakable = (voice: string | undefined) =>
    voice && (!options || options.some((option) => option.id === voice)) ? voice : null;
  const voices = new Set(assets.filter(isNarration).map((asset) => speakable(asset.voice)));
  if (voices.size > 1) return "mixed";
  const [only] = voices;
  return only ?? null;
}

/** Set one voice on every narration of a group, touching nothing else; how many it set. */
export function applyVoice(assets: MediaAsset[], voice: string): number {
  let count = 0;
  for (const asset of assets)
    if (isNarration(asset)) {
      asset.voice = voice;
      count++;
    }
  return count;
}

/** Options from a bare list of voice names, for a server that sends no catalogue. */
export function optionsFromVoices(voices: readonly string[], model = ""): VoiceOption[] {
  return voices.map((id) => ({
    id,
    label: id,
    provider: "",
    model,
    languages: [],
    previewUrl: null,
  }));
}

/** The voice a narration is generated with: its own when speakable, else the default. */
export function voiceFor(
  asset: Pick<MediaAsset, "voice"> | undefined,
  options: readonly VoiceOption[],
  fallback: string,
): string {
  const saved = asset?.voice;
  return saved && options.some((option) => option.id === saved) ? saved : fallback;
}
