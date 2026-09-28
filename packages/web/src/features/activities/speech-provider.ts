/**
 * Who speaks a narration, and with which voice: the provider a narration names (Gemini when
 * it names none), the voices that provider offers, the voice a run is asked for, and the word
 * a clip is saying at a moment of playback. Pure, so it is tested without a DOM.
 */
import type {
  MediaAsset,
  SpeechProviderId,
  SpeechProviderStatus,
  VoiceOption,
} from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { isNarration } from "./voice-catalogue";

export const SPEECH_PROVIDERS: readonly SpeechProviderId[] = ["gemini", "elevenlabs"];

/** The id the server gives the Vault's default ElevenLabs voice. */
export const ELEVENLABS_DEFAULT_VOICE = "elevenlabs-default";

/** How the Vault's default ElevenLabs voice is named wherever it is listed. */
export function elevenLabsDefaultLabel(): string {
  return `${S.activities.speechProvider.elevenlabs} · ${S.activities.voicePicker.default}`;
}

/** The server's voice catalogue, with the voices it cannot name worded here. */
export function wordCatalogue(options: readonly VoiceOption[]): VoiceOption[] {
  return options.map((option) =>
    option.id === ELEVENLABS_DEFAULT_VOICE
      ? { ...option, label: elevenLabsDefaultLabel() }
      : option,
  );
}

/** An ElevenLabs voice id as an author may type it; the server checks the same. */
export function isElevenLabsVoiceId(text: string): boolean {
  return /^[A-Za-z0-9]{10,40}$/.test(text);
}

/** The provider a narration is spoken by the next time it is generated. */
export function providerOf(
  asset: Pick<MediaAsset, "speechProvider"> | undefined,
): SpeechProviderId {
  return asset?.speechProvider ?? "gemini";
}

/** Which provider a voice belongs to; an older server's options are all Gemini's. */
function optionProvider(option: VoiceOption): SpeechProviderId {
  return option.providerId ?? "gemini";
}

/**
 * The voices `provider` offers: its catalogue entries, and for ElevenLabs every id a
 * narration of `assets` already names, so a typed voice stays choosable.
 */
export function voicesFor(
  options: readonly VoiceOption[],
  provider: SpeechProviderId,
  assets: readonly MediaAsset[] = [],
): VoiceOption[] {
  const listed = options.filter((option) => optionProvider(option) === provider);
  if (provider !== "elevenlabs") return listed;
  const typed = new Set<string>();
  for (const asset of assets)
    if (
      isNarration(asset) &&
      providerOf(asset) === "elevenlabs" &&
      asset.voice &&
      isElevenLabsVoiceId(asset.voice) &&
      !listed.some((option) => option.id === asset.voice)
    )
      typed.add(asset.voice);
  return [
    ...listed,
    ...[...typed].map((id) => ({
      id,
      label: id,
      provider: "ElevenLabs",
      providerId: "elevenlabs" as const,
      model: "eleven_v3",
      languages: [],
      previewUrl: null,
    })),
  ];
}

/**
 * What a run for one narration asks for: its provider, and its own voice when that provider
 * speaks with it, else `fallback` when it does, else the provider's first voice. An empty
 * voice means the provider has none to offer yet.
 */
export function speechChoice(
  asset: MediaAsset | undefined,
  options: readonly VoiceOption[],
  fallback: string,
): { provider: SpeechProviderId; voice: string } {
  const provider = providerOf(asset);
  const voices = voicesFor(options, provider, asset ? [asset] : []);
  const has = (id: string | undefined) => !!id && voices.some((option) => option.id === id);
  const voice = has(asset?.voice)
    ? asset!.voice!
    : has(fallback)
      ? fallback
      : (voices[0]?.id ?? "");
  return { provider, voice };
}

/** The provider every narration shares, "mixed" when they differ, null with none. */
export function sharedProvider(assets: readonly MediaAsset[]): SpeechProviderId | "mixed" | null {
  const providers = new Set(assets.filter(isNarration).map(providerOf));
  if (providers.size > 1) return "mixed";
  const [only] = providers;
  return only ?? null;
}

/**
 * Set one provider on every narration of a group; a voice the new provider does not speak
 * with is dropped, so the narration takes that provider's default. How many it set.
 */
export function applyProvider(
  assets: MediaAsset[],
  provider: SpeechProviderId,
  options: readonly VoiceOption[],
): number {
  let count = 0;
  for (const asset of assets)
    if (isNarration(asset)) {
      setProvider(asset, provider, options);
      count++;
    }
  return count;
}

/** Set one narration's provider, dropping a voice the provider does not speak with. */
export function setProvider(
  asset: MediaAsset,
  provider: SpeechProviderId,
  options: readonly VoiceOption[],
): void {
  asset.speechProvider = provider;
  const voice = asset.voice;
  const keeps =
    !!voice &&
    (provider === "elevenlabs"
      ? isElevenLabsVoiceId(voice) || voicesFor(options, provider).some((o) => o.id === voice)
      : voicesFor(options, provider).some((option) => option.id === voice));
  if (!keeps) delete asset.voice;
}

/** A provider's status for the chosen agent, or null while it is not known. */
export function providerStatus(
  statuses: readonly SpeechProviderStatus[] | null,
  provider: SpeechProviderId,
): SpeechProviderStatus | null {
  return statuses?.find((status) => status.id === provider) ?? null;
}

/** The word a clip is saying at `ms`, as an index into its timings, or -1 between words. */
export function activeWord(
  timings: readonly { startMs: number; endMs: number }[],
  ms: number,
): number {
  return timings.findIndex((timing) => ms >= timing.startMs && ms < timing.endMs);
}
