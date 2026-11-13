/** The public demos' shared pause/play control; the host owns playback and translated labels. */
import { PauseIcon, PlayIcon } from "./site-icons";

export function SitePlaybackButton({
  paused,
  onPausedChange,
  labels,
  className = "",
}: {
  paused: boolean;
  onPausedChange: (paused: boolean) => void;
  labels: { pause: string; play: string };
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={paused}
      onClick={() => onPausedChange(!paused)}
      className={`site-playback-button ${className}`}
    >
      {paused ? <PlayIcon /> : <PauseIcon />}
      <span>{paused ? labels.play : labels.pause}</span>
    </button>
  );
}
