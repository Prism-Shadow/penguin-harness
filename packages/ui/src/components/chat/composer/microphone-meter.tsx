/**
 * The recording readout a composer shows while it dictates: the elapsed time, then a meter of
 * the recent input levels, one bar per reading (`useMicrophoneLevels` supplies them).
 *
 * The meter is a `role="meter"` named by the caller, its value the latest reading, and its value
 * text the words a reader would otherwise infer from the bars ("Quiet", "Sound detected"). Under
 * reduced motion those words replace the bars. Where no level can be read (the browser opened no
 * analyser, its audio context is suspended) the readout says the recording is running instead,
 * since a flat meter would read as a dead microphone.
 *
 * It sits in a composer toolbar, so it is one line at the toolbar's height and never wraps; the
 * bars take the success ink, the time the muted one in tabular figures so it does not jitter. Like
 * the toolbar's pills it sizes by the card's container width: below `@sm` the time is dropped and
 * the bars narrow, so on a phone the readout still fits beside the cancel control.
 */
import type { MicrophoneLevels } from "./microphone-levels";

export interface MicrophoneMeterLabels {
  /** The meter's accessible name ("Microphone level"). */
  level: string;
  /** The value text while the latest reading is silence. */
  quiet: string;
  /** The value text while it is not. */
  sound: string;
  /** Shown instead of the meter when no level can be read ("Recording"). */
  recording: string;
}

const VIEW_W = 90;
const VIEW_H = 28;

export function MicrophoneMeter({
  levels,
  seconds,
  available,
  reduceMotion,
  labels,
}: MicrophoneLevels & { labels: MicrophoneMeterLabels }) {
  const current = levels.at(-1) ?? 0;
  const pitch = VIEW_W / Math.max(levels.length, 1);
  return (
    <span className="inline-flex h-8 min-w-0 items-center gap-1.5 px-1">
      <span aria-hidden className="hidden shrink-0 text-xs tabular-nums text-fg-muted @sm:inline">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
      </span>
      {available ? (
        <span
          role="meter"
          aria-label={labels.level}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={current}
          aria-valuetext={current > 0 ? labels.sound : labels.quiet}
          className={`flex h-5 min-w-0 items-center text-tone-success-fg ${reduceMotion ? "w-auto" : "w-10 @sm:w-14"}`}
        >
          {reduceMotion ? (
            <span className="truncate text-xs text-fg-muted">
              {current > 0 ? labels.sound : labels.quiet}
            </span>
          ) : (
            <svg
              aria-hidden
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              className="block h-5 w-full"
              fill="currentColor"
            >
              {levels.map((value, index) => {
                const height = 3 + (value / 100) * (VIEW_H - 5);
                return (
                  <rect
                    key={index}
                    x={pitch * index + (pitch - 3) / 2}
                    y={(VIEW_H - height) / 2}
                    width={3}
                    height={height}
                    rx={1.5}
                  />
                );
              })}
            </svg>
          )}
        </span>
      ) : (
        <span className="truncate text-xs text-fg-muted">{labels.recording}</span>
      )}
    </span>
  );
}
