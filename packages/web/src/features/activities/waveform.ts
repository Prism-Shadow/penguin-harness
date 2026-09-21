/**
 * The arithmetic behind the speech waveform, kept away from the DOM and the Web Audio
 * API so it can be tested directly. The drawing itself is geometry rather than an icon,
 * so it sits outside the glyph family, like the app's other charts.
 */

/**
 * One amplitude per column, each the loudest sample in the slice it covers. A peak
 * envelope rather than an average, because an average flattens speech into a grey band
 * and the point of the picture is to show where the words are.
 */
export function waveformPeaks(samples: Float32Array, columns: number): number[] {
  if (columns <= 0 || samples.length === 0) return [];
  const peaks = new Array<number>(columns).fill(0);
  const per = samples.length / columns;
  for (let column = 0; column < columns; column += 1) {
    const start = Math.floor(column * per);
    const end = Math.max(start + 1, Math.min(samples.length, Math.floor((column + 1) * per)));
    let peak = 0;
    for (let index = start; index < end; index += 1) {
      const value = Math.abs(samples[index] ?? 0);
      if (value > peak) peak = value;
    }
    peaks[column] = Math.min(1, peak);
  }
  return peaks;
}

/**
 * Scale the envelope so the loudest column fills the height. Quiet narration is the
 * normal case, and an unscaled picture of it is a flat line that shows nothing.
 */
export function normalizePeaks(peaks: readonly number[]): number[] {
  const loudest = peaks.reduce((high, value) => (value > high ? value : high), 0);
  if (loudest <= 0) return peaks.map(() => 0);
  return peaks.map((value) => value / loudest);
}

/** Where in the clip a click at this offset landed, clamped to the clip. */
export function seekTime(offsetX: number, width: number, duration: number): number {
  if (!(width > 0) || !(duration > 0) || !Number.isFinite(offsetX)) return 0;
  return Math.min(duration, Math.max(0, (offsetX / width) * duration));
}

/** How far through the clip playback is, as a fraction, for the played-so-far fill. */
export function playedFraction(currentTime: number, duration: number): number {
  if (!(duration > 0) || !Number.isFinite(currentTime)) return 0;
  return Math.min(1, Math.max(0, currentTime / duration));
}

/** A clip position as minutes and seconds, for the player's readout. */
export function clipTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
