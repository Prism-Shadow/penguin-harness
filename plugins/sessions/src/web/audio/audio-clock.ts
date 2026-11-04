/** Time arithmetic for the audio player (audio-file.tsx): the clock readout and the seekable extent. */

/** `m:ss`, or `h:mm:ss` from an hour on; `-:--` while the length is not known yet. */
export function formatClock(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "-:--";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** The ranges shape `seekable` and `buffered` share, so a test can pass a plain stand-in. */
export interface TimeRangesLike {
  readonly length: number;
  end(index: number): number;
}

/**
 * How far into the file a seek can land. The Workspace file route answers the whole file and no
 * byte ranges, so the browser can only seek within what it has already received: the furthest end
 * of the seekable and the buffered ranges, whichever the browser reports.
 */
export function loadedEnd(seekable: TimeRangesLike, buffered: TimeRangesLike): number {
  let end = 0;
  for (const ranges of [seekable, buffered]) {
    for (let i = 0; i < ranges.length; i++) end = Math.max(end, ranges.end(i));
  }
  return end;
}
