/**
 * What the audio player draws, from the playback state audio-file.tsx keeps: a compact one-row
 * card — a round play/pause button, the file name, the elapsed / total time and the seek bar — or,
 * for a file that cannot be played, the same card shape holding a line that says so.
 *
 * It is drawn from theme tokens: the radius, line and surface of the transcript's other cards
 * (the files card, a tool call's card), the accent for its one action and the danger tone for the
 * failed mark, so it reads as part of the app in every theme and both modes. The width is capped
 * so it does not span a wide chat column, and every part keeps its box from the first render — the
 * clock is a fixed-width monospace readout — so nothing shifts when the file's length arrives.
 */
import type { ReactNode } from "react";
import { GlyphIcon, ICONS, ICON_SIZE, Spinner } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { formatClock } from "./audio-clock";
import { AudioSeek } from "./audio-seek";

/** The card around the player and around the line it becomes: one shape, one height. */
const CARD =
  "flex w-full max-w-md items-center gap-3 rounded-xl border border-line bg-surface px-2.5 py-2";

/** The round slot that leads the card: the play button, or the failed mark in its place. */
const DISC = "flex size-8 shrink-0 items-center justify-center rounded-full";

export interface AudioPlayback {
  playing: boolean;
  /** Asked to play and still waiting for data. */
  waiting: boolean;
  /** Seconds into the file. */
  time: number;
  /** The file's length in seconds; null until its metadata has loaded. */
  duration: number | null;
  /** Seconds received so far: how far a seek can reach. */
  loaded: number;
}

export function AudioCard({
  name,
  playback: { playing, waiting, time, duration, loaded },
  onToggle,
  onSeek,
  children,
}: {
  name: string;
  playback: AudioPlayback;
  onToggle: () => void;
  onSeek: (seconds: number) => void;
  /** The media element the card drives; it draws nothing itself. */
  children: ReactNode;
}) {
  const elapsed = formatClock(time);
  const total = formatClock(duration);
  const label = playing ? S.files.audioPause(name) : S.files.audioPlay(name);
  return (
    <div data-audio-file={playing ? "playing" : "paused"} className={CARD}>
      <button
        type="button"
        aria-label={label}
        data-tooltip={label}
        aria-busy={waiting || undefined}
        onClick={onToggle}
        className={`${DISC} cursor-pointer bg-accent text-accent-fg transition-opacity duration-150 hover:opacity-90`}
      >
        {waiting ? (
          <Spinner size="md" label={S.files.audioLoading(name)} />
        ) : (
          <GlyphIcon d={playing ? ICONS.pause : ICONS.play} size={ICON_SIZE.iconButton} filled />
        )}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-3">
          <span data-tooltip={name} className="min-w-0 flex-1 truncate font-mono text-sm text-fg">
            {name}
          </span>
          {/* Read out by the seek bar's value text; drawn here for the eye only. */}
          <span
            aria-hidden
            className="min-w-[11ch] shrink-0 text-right font-mono text-xs tabular-nums text-fg-subtle"
          >
            {elapsed} / {total}
          </span>
        </div>
        <AudioSeek
          duration={duration}
          time={time}
          loaded={loaded}
          label={S.files.audioSeek(name)}
          valueText={S.files.audioPosition(elapsed, total)}
          onSeek={onSeek}
        />
      </div>
      {children}
    </div>
  );
}

/** The card a file that cannot be played becomes: the failed mark and a line naming the file. */
export function AudioFailed({ name }: { name: string }) {
  return (
    <div data-audio-file="failed" className={CARD}>
      <span className={`${DISC} bg-surface-muted`}>
        <GlyphIcon d={ICONS.xCircle} size={ICON_SIZE.iconButton} className={toneInk.danger} />
      </span>
      <span role="status" className="min-w-0 flex-1 text-sm text-fg-muted [overflow-wrap:anywhere]">
        {S.files.audioUnavailable(name)}
      </span>
    </div>
  );
}
