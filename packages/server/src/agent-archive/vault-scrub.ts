/**
 * The Agent's vault values, taken out of the Trace files an export carries.
 *
 * A command an Agent runs gets the vault in its environment, so its output — and with it the
 * Trace — can hold a value (`env`, `echo $KEY`). On export every occurrence of a value at least
 * `MIN_VALUE_LENGTH` characters long is replaced by `[vault:<KEY>]`, as written and as JSON
 * escapes it inside a Trace line; shorter values match too much ordinary text to replace safely.
 * The scrub streams: a file is passed through in chunks, holding back only the bytes a value
 * could still span.
 */

/** Values shorter than this are left alone: they are too likely to be ordinary text. */
export const MIN_VALUE_LENGTH = 8;

interface Pattern {
  needle: Buffer;
  replacement: Buffer;
}

/** The patterns of one vault, longest first; null when no value is long enough to look for. */
export function vaultPatterns(vault: Readonly<Record<string, string>>): Pattern[] | null {
  const patterns: Pattern[] = [];
  for (const [key, value] of Object.entries(vault)) {
    if (value.length < MIN_VALUE_LENGTH) continue;
    const replacement = Buffer.from(`[vault:${key}]`);
    const forms = new Set([value, JSON.stringify(value).slice(1, -1)]);
    for (const form of forms) patterns.push({ needle: Buffer.from(form), replacement });
  }
  patterns.sort((a, b) => b.needle.length - a.needle.length);
  return patterns.length > 0 ? patterns : null;
}

/** One file's pass through the scrub: `push` each chunk, then `end`; `count` replacements made. */
export class VaultScrub {
  count = 0;
  private tail: Buffer = Buffer.alloc(0);
  private readonly hold: number;

  constructor(private readonly patterns: readonly Pattern[]) {
    this.hold = Math.max(...patterns.map((p) => p.needle.length)) - 1;
  }

  /** What can be emitted of the bytes seen so far; the rest waits for the next chunk. */
  push(chunk: Uint8Array): Buffer {
    return this.scan(Buffer.concat([this.tail, chunk]), false);
  }

  end(): Buffer {
    return this.scan(this.tail, true);
  }

  private scan(buf: Buffer, final: boolean): Buffer {
    // A match starting before `safe` lies wholly in `buf`; one starting later may not have
    // arrived yet.
    const safe = final ? buf.length : buf.length - this.hold;
    const out: Buffer[] = [];
    let from = 0;
    for (;;) {
      let best: { at: number; pattern: Pattern } | null = null;
      for (const pattern of this.patterns) {
        const at = buf.indexOf(pattern.needle, from);
        if (at >= 0 && (best === null || at < best.at)) best = { at, pattern };
      }
      if (best === null || best.at >= safe) break;
      out.push(buf.subarray(from, best.at), best.pattern.replacement);
      this.count += 1;
      from = best.at + best.pattern.needle.length;
    }
    const cut = Math.max(from, safe);
    out.push(buf.subarray(from, cut));
    this.tail = Buffer.from(buf.subarray(cut));
    return Buffer.concat(out);
  }
}
