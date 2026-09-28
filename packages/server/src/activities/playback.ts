/**
 * How a module plays an audio asset that is not narration: background music or a sound
 * effect, with the channel it plays on, whether it loops, and how loud it is.
 *
 * The contract is Loom's, unchanged, because the modules and the `waf-audio-patterns`
 * skill already read it: an audio entry in `asset_manifest.json` that carries `kind`
 * ("music" or "sfx") also carries `channel`, `loop` and `volume` (0 to 1), and the module
 * treats those as the source of truth rather than guessing. Narration carries none of them.
 * The four travel together, so a module never meets half a setting.
 */
export type AudioKind = "music" | "sfx";

export const AUDIO_KINDS: readonly AudioKind[] = ["music", "sfx"];

export interface AudioPlayback {
  kind: AudioKind;
  channel: string;
  loop: boolean;
  volume: number;
}

/** What a kind plays like when nothing says otherwise: music loops, quietly, under the rest. */
export const PLAYBACK_DEFAULTS: Record<AudioKind, AudioPlayback> = {
  music: { kind: "music", channel: "music", loop: true, volume: 0.4 },
  sfx: { kind: "sfx", channel: "sfx", loop: false, volume: 1 },
};

const CHANNEL = /^[a-z][a-z0-9_-]{0,31}$/;
export const PLAYBACK_FIELDS = ["kind", "channel", "loop", "volume"] as const;

/**
 * An asset's playback, null for narration, or "invalid" when the fields are present but
 * are not all four, well formed.
 */
export function readPlayback(asset: Record<string, unknown>): AudioPlayback | null | "invalid" {
  const present = PLAYBACK_FIELDS.filter((field) => asset[field] !== undefined);
  if (!present.length) return null;
  if (present.length !== PLAYBACK_FIELDS.length) return "invalid";
  const { kind, channel, loop, volume } = asset;
  if (
    !AUDIO_KINDS.includes(kind as AudioKind) ||
    typeof channel !== "string" ||
    !CHANNEL.test(channel) ||
    typeof loop !== "boolean" ||
    typeof volume !== "number" ||
    !Number.isFinite(volume) ||
    volume < 0 ||
    volume > 1
  )
    return "invalid";
  return { kind: kind as AudioKind, channel, loop, volume };
}

/**
 * Loom's playback for an imported asset, with its defaults filling what an older manifest
 * left out; null when it names no kind Penguin knows.
 */
export function importedPlayback(asset: Record<string, unknown>): AudioPlayback | null {
  if (!AUDIO_KINDS.includes(asset.kind as AudioKind)) return null;
  const defaults = PLAYBACK_DEFAULTS[asset.kind as AudioKind];
  const volume = asset.volume;
  return {
    kind: defaults.kind,
    channel:
      typeof asset.channel === "string" && CHANNEL.test(asset.channel)
        ? asset.channel
        : defaults.channel,
    loop: typeof asset.loop === "boolean" ? asset.loop : defaults.loop,
    volume:
      typeof volume === "number" && Number.isFinite(volume) && volume >= 0 && volume <= 1
        ? volume
        : defaults.volume,
  };
}

const TAG = /^\s*<audio\b([^>]*)>[\s\S]*<\/audio>\s*$/i;
const ATTR = /([a-zA-Z_][\w-]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/g;

/**
 * The playback a track's script asks for, the way Loom's scripts do: a script wrapped in
 * `<audio kind="music" loop="true" volume="0.3">…</audio>` is music, not narration. An
 * untagged or speech script asks for nothing; an attribute that does not parse keeps the
 * kind's default rather than failing the plan.
 */
export function playbackFromScript(script: string | undefined): AudioPlayback | null {
  const tag = script ? TAG.exec(script) : null;
  if (!tag) return null;
  const attrs: Record<string, string> = {};
  for (const [, name, raw] of tag[1]!.matchAll(ATTR))
    attrs[name!.toLowerCase()] = raw!.replace(/^["']|["']$/g, "");
  const kind = attrs.kind?.trim().toLowerCase();
  if (!AUDIO_KINDS.includes(kind as AudioKind)) return null;
  const flag = attrs.loop?.trim().toLowerCase();
  const volume = attrs.volume === undefined ? NaN : Number(attrs.volume);
  return importedPlayback({
    kind,
    channel: attrs.channel?.trim(),
    loop: ["true", "1", "yes", "on"].includes(flag ?? "")
      ? true
      : ["false", "0", "no", "off"].includes(flag ?? "")
        ? false
        : undefined,
    volume: Number.isFinite(volume) ? volume : undefined,
  });
}

const BODY = /^\s*<audio\b[^>]*>([\s\S]*)<\/audio>\s*$/i;

/** The shortest and longest sound an author may ask for, in milliseconds. */
export const SOUND_MIN_DURATION_MS = 1000;
export const SOUND_MAX_DURATION_MS = 60000;

/**
 * What a music or sound-effect script asks a provider for: the words inside a wrapping
 * `<audio …>` tag, or the whole script when it has none.
 */
export function soundPromptOf(script: string | undefined): string {
  if (!script) return "";
  const tag = BODY.exec(script);
  return (tag ? tag[1]! : script).trim();
}

/** A requested length clamped to what a provider accepts, in whole milliseconds. */
export function clampSoundDuration(ms: number): number {
  return Math.min(SOUND_MAX_DURATION_MS, Math.max(SOUND_MIN_DURATION_MS, Math.round(ms)));
}

/**
 * The length a Loom script's tag asks for (`duration="8"` or `"8s"`, in seconds), clamped to
 * 1–60 s; undefined when the script has no tag, no duration, or one that does not parse.
 */
export function durationFromScript(script: string | undefined): number | undefined {
  const tag = script ? TAG.exec(script) : null;
  if (!tag) return undefined;
  for (const [, name, raw] of tag[1]!.matchAll(ATTR)) {
    if (name!.toLowerCase() !== "duration") continue;
    const value = /^\s*(\d+(?:\.\d*)?|\.\d+)\s*s?\s*$/i.exec(raw!.replace(/^["']|["']$/g, ""));
    const seconds = value ? Number(value[1]) : NaN;
    return Number.isFinite(seconds) && seconds > 0 ? clampSoundDuration(seconds * 1000) : undefined;
  }
  return undefined;
}
