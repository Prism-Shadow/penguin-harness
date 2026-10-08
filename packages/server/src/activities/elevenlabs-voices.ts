/**
 * The ElevenLabs voices an account can speak with, listed for the voice picker as Loom lists
 * them: every page of `GET /v2/voices`, each voice with its name, preview sample and the
 * languages it is verified for. The key is used for that request only; it is never returned,
 * logged or put in an error message.
 */
import {
  ELEVENLABS_DEFAULT_MODEL,
  ELEVENLABS_DEFAULT_VOICE,
  type VoiceOption,
} from "./voice-catalogue.js";

const VOICES_URL = "https://api.elevenlabs.io/v2/voices";
const PAGE_SIZE = 100;
/** A runaway pager stops here: 20 pages is 2000 voices, far beyond any account's library. */
const MAX_PAGES = 20;
const TIMEOUT_MS = 30_000;

/** Why ElevenLabs gave no list. */
export class ElevenLabsVoicesError extends Error {
  constructor(readonly problem: "refused" | "unavailable") {
    super(problem === "refused" ? "ElevenLabs refused the key." : "ElevenLabs did not answer.");
  }
}

interface RawVoice {
  voice_id?: unknown;
  name?: unknown;
  preview_url?: unknown;
  labels?: Record<string, unknown> | null;
  verified_languages?: Array<{ language?: unknown; locale?: unknown }> | null;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** Locales the voice is verified for (`en-US`), else its bare languages (`en`), de-duplicated. */
function languagesOf(voice: RawVoice): string[] {
  const locales = new Set<string>();
  const bare = new Set<string>();
  for (const entry of voice.verified_languages ?? []) {
    const locale = text(entry?.locale);
    if (locale && /^[a-z]{2,3}-[A-Z]{2}$/.test(locale)) locales.add(locale);
    const language = text(entry?.language);
    if (language) bare.add(language.toLowerCase());
  }
  return [...(locales.size ? locales : bare)].sort();
}

/** The voice's labels worth a glance: accent, age, gender, use case. */
function describe(voice: RawVoice): string | undefined {
  const labels = voice.labels ?? {};
  const words = ["accent", "age", "gender", "use_case", "descriptive"]
    .map((name) => text(labels[name])?.replace(/_/g, " "))
    .filter((word): word is string => !!word);
  return words.length ? [...new Set(words)].join(" · ") : undefined;
}

function toOption(voice: RawVoice): VoiceOption | null {
  const id = text(voice.voice_id);
  const name = text(voice.name);
  if (!id || !name || !/^[A-Za-z0-9]{10,40}$/.test(id)) return null;
  const preview = text(voice.preview_url);
  const description = describe(voice);
  return {
    id,
    label: name,
    provider: "ElevenLabs",
    providerId: "elevenlabs",
    model: ELEVENLABS_DEFAULT_MODEL,
    languages: languagesOf(voice),
    previewUrl: preview && /^https:\/\//.test(preview) ? preview : null,
    ...(description ? { description } : {}),
  };
}

/** Every voice the key's account can use, sorted by name. */
export async function listElevenLabsVoices(
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VoiceOption[]> {
  const voices = new Map<string, VoiceOption>();
  let token: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(VOICES_URL);
    url.searchParams.set("page_size", String(PAGE_SIZE));
    if (token) url.searchParams.set("next_page_token", token);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { accept: "application/json", "xi-api-key": key },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new ElevenLabsVoicesError("unavailable");
    }
    if (response.status === 401 || response.status === 403)
      throw new ElevenLabsVoicesError("refused");
    if (!response.ok) throw new ElevenLabsVoicesError("unavailable");
    let body: { voices?: unknown; has_more?: unknown; next_page_token?: unknown };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      throw new ElevenLabsVoicesError("unavailable");
    }
    for (const raw of Array.isArray(body.voices) ? (body.voices as RawVoice[]) : []) {
      const option = toOption(raw ?? {});
      if (option) voices.set(option.id, option);
    }
    token = body.has_more === true ? text(body.next_page_token) : null;
    if (!token) break;
  }
  return [...voices.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}

/**
 * The default entry with the voice it stands for named and playable, followed by every other
 * voice once, as Loom lists them. Without the default voice in the library, the entry stays as
 * it was.
 */
export function withDefaultFirst(
  defaultOption: VoiceOption,
  defaultVoiceId: string,
  voices: readonly VoiceOption[],
): VoiceOption[] {
  const voice = voices.find((option) => option.id === defaultVoiceId);
  const first: VoiceOption = voice
    ? {
        ...voice,
        id: ELEVENLABS_DEFAULT_VOICE,
        label: defaultOption.label,
        voiceName: voice.label,
      }
    : defaultOption;
  return [first, ...voices.filter((option) => option.id !== defaultVoiceId)];
}
