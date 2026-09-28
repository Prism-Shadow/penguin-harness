/**
 * What an audio asset is (narration, music or a sound effect) and, for music and effects,
 * how the module plays it: looping or once, and how loud. These are the fields the module
 * reads from the asset manifest (server `activities/playback.ts`); narration carries none.
 */
import { useId } from "react";
import type { MediaAsset } from "@prismshadow/penguin-server/api";
import { FieldLabel } from "../../components/ui/field";
import { Select } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { S } from "../../lib/strings";

type Kind = NonNullable<MediaAsset["kind"]>;
export interface Playback {
  kind: Kind;
  channel: string;
  loop: boolean;
  volume: number;
}

/** A kind's playback when first chosen; the server's defaults (`PLAYBACK_DEFAULTS`). */
const DEFAULTS: Record<Kind, Playback> = {
  music: { kind: "music", channel: "music", loop: true, volume: 0.4 },
  sfx: { kind: "sfx", channel: "sfx", loop: false, volume: 1 },
};

export function playbackOf(asset: MediaAsset): Playback | null {
  return asset.kind && asset.channel !== undefined && asset.loop !== undefined
    ? { kind: asset.kind, channel: asset.channel, loop: asset.loop, volume: asset.volume ?? 1 }
    : null;
}

export function AudioPlaybackFields({
  asset,
  disabled,
  onChange,
}: {
  asset: MediaAsset;
  disabled: boolean;
  /** The new playback, or null to make the asset narration again. */
  onChange: (playback: Playback | null) => void;
}) {
  const words = S.activities.audioPlayback;
  const loopId = useId();
  const volumeId = useId();
  const playback = playbackOf(asset);
  return (
    <div className="space-y-2">
      <Select
        size="sm"
        label={words.type}
        value={playback?.kind ?? "speech"}
        disabled={disabled}
        onChange={(event) => {
          const kind = event.target.value;
          if (kind === "music" || kind === "sfx")
            onChange(playback?.kind === kind ? playback : DEFAULTS[kind]);
          else onChange(null);
        }}
      >
        <option value="speech">{words.kinds.speech}</option>
        <option value="music">{words.kinds.music}</option>
        <option value="sfx">{words.kinds.sfx}</option>
      </Select>
      {playback && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-2">
            <FieldLabel htmlFor={loopId} block={false}>
              {words.loop}
            </FieldLabel>
            <Switch
              id={loopId}
              checked={playback.loop}
              disabled={disabled}
              onChange={(loop) => onChange({ ...playback, loop })}
            />
          </div>
          <div className="flex min-w-48 flex-1 items-center gap-2">
            <FieldLabel htmlFor={volumeId} block={false}>
              {words.volume}
            </FieldLabel>
            <input
              id={volumeId}
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={playback.volume}
              disabled={disabled}
              onChange={(event) => onChange({ ...playback, volume: Number(event.target.value) })}
              className="min-w-0 flex-1 accent-brand-600"
            />
            <output htmlFor={volumeId} className="w-10 text-right text-xs tabular-nums">
              {words.percent(Math.round(playback.volume * 100))}
            </output>
          </div>
          <p className="basis-full text-xs text-gray-500">
            {words.hint[playback.kind](playback.channel)}
          </p>
        </div>
      )}
    </div>
  );
}
