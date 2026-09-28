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

/**
 * A WAV file's own sample rate, read from its header, or null for anything else. Decoding
 * resamples to the audio context's rate, so a trim decodes at this one to write back the
 * clip it was given rather than a resampled copy several times the size.
 */
export function wavSampleRate(bytes: Uint8Array): number | null {
  if (bytes.length < 28) return null;
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || tag(12) !== "fmt ") return null;
  const rate = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(24, true);
  return rate >= 3000 && rate <= 384000 ? rate : null;
}

/** The shortest selection worth acting on, in seconds; anything less was a click. */
export const MIN_SELECTION = 0.05;

/** The stretch between two marked moments, in either order, or null when too short. */
export function selectionBetween(
  first: number,
  second: number,
): { start: number; end: number } | null {
  const start = Math.min(first, second);
  const end = Math.max(first, second);
  return end - start >= MIN_SELECTION ? { start, end } : null;
}

/** How long the clip would be with the selection taken out. */
export function remainingLength(duration: number, selection: { start: number; end: number }) {
  return Math.max(0, duration - (selection.end - selection.start));
}

/** The stretch of the clip a drag across the waveform covers, or null for a click. */
export function selectionFromDrag(
  fromX: number,
  toX: number,
  width: number,
  duration: number,
): { start: number; end: number } | null {
  if (width <= 0 || duration <= 0) return null;
  const start = seekTime(Math.min(fromX, toX), width, duration);
  const end = seekTime(Math.max(fromX, toX), width, duration);
  return end - start >= MIN_SELECTION ? { start, end } : null;
}

/** Every channel with the samples between `start` and `end` seconds taken out. */
export function removeRange(
  channels: readonly Float32Array[],
  sampleRate: number,
  start: number,
  end: number,
): Float32Array[] {
  return channels.map((samples) => {
    const from = Math.max(0, Math.min(samples.length, Math.round(start * sampleRate)));
    const to = Math.max(from, Math.min(samples.length, Math.round(end * sampleRate)));
    const out = new Float32Array(samples.length - (to - from));
    out.set(samples.subarray(0, from), 0);
    out.set(samples.subarray(to), from);
    return out;
  });
}

/**
 * The channels as a 16-bit PCM WAV file, which the media upload accepts and every WAF
 * runtime plays. Samples are clamped rather than wrapped, so a loud peak clips instead
 * of turning into a click.
 */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  const count = channels.length;
  const frames = channels[0]?.length ?? 0;
  const dataBytes = frames * count * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1)
      view.setUint8(offset + index, text.charCodeAt(index));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * 2, true);
  view.setUint16(32, count * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1)
    for (const channel of channels) {
      const sample = Math.max(-1, Math.min(1, channel[frame] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  return bytes;
}
