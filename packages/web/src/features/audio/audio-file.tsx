/**
 * The `audio` file renderer: a linked audio file as a compact player card below the reply
 * paragraph that links it (audio-card.tsx draws it). Underneath is a plain `<audio>` without
 * controls — the browser's own player chrome differs per browser and ignores the theme — and the
 * card follows the element's media events, so the element stays the one source of truth for
 * whether it plays and where it is.
 *
 * `preload="none"` — a transcript can link many files, and nothing is fetched until the reader
 * presses play, so the length reads `-:--` and the seek bar stays off until then. The file comes
 * through the Workspace file URL, which answers the whole file (no Range requests): it plays, and
 * seeks only within what has loaded (a seek is clamped to that extent, and the bar draws it).
 *
 * A file that cannot be played — gone since the reply was written, or in a format this browser
 * does not decode — turns the card into a line saying so once playback has been tried; the link
 * above it still opens the file in the Files panel.
 */
import { useRef, useState, type SyntheticEvent } from "react";

import type { FileRendererProps } from "../../lib/file-renderers";
import { loadedEnd } from "./audio-clock";
import { AudioCard, AudioFailed, type AudioPlayback } from "./audio-card";

const IDLE: AudioPlayback = { playing: false, waiting: false, time: 0, duration: null, loaded: 0 };

export function AudioFile({ url, name }: FileRendererProps) {
  const ref = useRef<HTMLAudioElement>(null);
  const [failed, setFailed] = useState(false);
  const [playback, setPlayback] = useState<AudioPlayback>(IDLE);

  if (failed) return <AudioFailed name={name} />;

  const patch = (next: Partial<AudioPlayback>) => setPlayback((p) => ({ ...p, ...next }));
  // Where the element is, read from it rather than tracked beside it.
  const sync = (e: SyntheticEvent<HTMLAudioElement>, next: Partial<AudioPlayback> = {}) => {
    const el = e.currentTarget;
    patch({
      time: el.currentTime,
      duration: Number.isFinite(el.duration) ? el.duration : null,
      loaded: loadedEnd(el.seekable, el.buffered),
      ...next,
    });
  };

  const toggle = () => {
    const el = ref.current;
    if (el === null) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    patch({ waiting: el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA });
    // A failed load reports through the element's error event; a refused play (a pause racing
    // it) leaves the card paused, which is already what it shows.
    el.play().catch(() => patch({ waiting: false }));
  };

  const seek = (seconds: number) => {
    const el = ref.current;
    if (el === null) return;
    const to = Math.min(seconds, loadedEnd(el.seekable, el.buffered));
    el.currentTime = to;
    patch({ time: to });
  };

  return (
    <AudioCard name={name} playback={playback} onToggle={toggle} onSeek={seek}>
      <audio
        ref={ref}
        preload="none"
        src={url}
        onPlay={() => patch({ playing: true })}
        onPlaying={(e) => sync(e, { waiting: false })}
        onWaiting={() => patch({ waiting: true })}
        onPause={(e) => sync(e, { playing: false, waiting: false })}
        onEnded={(e) => sync(e, { playing: false, waiting: false })}
        onLoadedMetadata={sync}
        onDurationChange={sync}
        onTimeUpdate={sync}
        onProgress={sync}
        onError={() => setFailed(true)}
      />
    </AudioCard>
  );
}
