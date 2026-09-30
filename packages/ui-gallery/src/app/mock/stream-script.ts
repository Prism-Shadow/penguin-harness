/**
 * A streamed reply, scripted: cuts a text into the deltas a real model stream delivers, which
 * arrive in bursts rather than one even token at a time. Sizes vary: mostly a token or three,
 * sometimes a burst of several words the network held back. Gaps vary too: mostly tens of
 * milliseconds, now and then a stall of half a second, after which a burst comes. The script is
 * seeded, so one seed always yields the same script: the library's streaming board replays the
 * same rhythm under every theme, and a test can hold it.
 *
 * No DOM and no timers here: the players (the streaming board, the demo store's looping Session)
 * schedule the steps themselves.
 */

export interface StreamChunk {
  /** The delta's text. */
  text: string;
  /** Milliseconds after the previous delta; for the first, after the stream opens. */
  gap: number;
}

/** mulberry32: a small seeded generator, uniform in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Han characters and CJK punctuation, which a model emits a character or two per token. */
const HAN = "\\u2e80-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef\\u3000-\\u303f";

/**
 * A token: one or two Han characters, or a run of anything else up to the next space, either
 * with its trailing whitespace; or a leading run of whitespace. Every character falls in one
 * alternative, so the tokens join back into the text exactly.
 */
const TOKEN = new RegExp(`[${HAN}]{1,2}\\s*|[^\\s${HAN}]+\\s*|\\s+`, "g");

export function streamTokens(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

/** The first delta's wait: the model's time to first token, long enough to see the empty reply. */
export const FIRST_GAP_MS = 420;

/** One delta in twelve waits on a stall; the one after a stall is always a burst. */
const STALL_ODDS = 1 / 12;
/** Besides those, one delta in seven is a burst. */
const BURST_ODDS = 1 / 7;

/** The deltas `text` streams as under `seed`: same seed, same script. */
export function streamScript(text: string, seed = 1): StreamChunk[] {
  const random = seededRandom(seed);
  const between = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const tokens = streamTokens(text);
  const chunks: StreamChunk[] = [];
  let next = 0;
  while (next < tokens.length) {
    const first = chunks.length === 0;
    const stall = !first && random() < STALL_ODDS;
    const burst = stall || random() < BURST_ODDS;
    const size = burst ? between(4, 9) : between(1, 3);
    const gap = first ? FIRST_GAP_MS : stall ? between(320, 720) : between(24, 110);
    chunks.push({ text: tokens.slice(next, next + size).join(""), gap });
    next += size;
  }
  return chunks;
}

/** How long a script takes from the stream's opening to its last delta. */
export function scriptDuration(chunks: readonly StreamChunk[]): number {
  return chunks.reduce((sum, chunk) => sum + chunk.gap, 0);
}
