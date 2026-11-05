/**
 * The Agent's secret vault values, taken out of the Trace files an export carries.
 *
 * A command an Agent runs gets the vault in its environment, so its output — and with it the
 * Trace — can hold a value (`env`, `echo $KEY`). On export each such value is replaced by
 * `[vault:<KEY>]` wherever it occurs inside a JSON string of a Trace record; numbers, keys and
 * the JSON around them are never touched, so every line stays the record it was. A line that does
 * not parse (a running Session's unfinished last line, a damaged one) cannot be broken further,
 * so there the value is replaced as plain text, as written and as JSON escapes it; such lines are
 * counted.
 *
 * Only secrets are looked for: the value of a vault key whose name is a credential's
 * (credential-names.ts), at least `MIN_VALUE_LENGTH` characters long, or a value shaped like a
 * token whatever its key's name (`TOKEN_MIN_LENGTH` characters or more, letters and digits, no
 * spaces, high entropy). A value of digits only (an account number, a port) never is; nor is an
 * ordinary setting such as a host name or a region. A value that is a URL with user info gives
 * up its password, or the user info itself when it has no password, whatever its key is called:
 * inside the URL wherever the URL is written, and on its own too when it is long enough to be
 * told from ordinary text. A Session's identity in its `session_meta`
 * (its id, model and provider) is never rewritten, so the import still recognises it.
 *
 * Files are scrubbed line by line as they stream: only the line being read is held.
 */
import { isCredentialName } from "./credential-names.js";
import { userInfoOf } from "./url-userinfo.js";

/** A credential-named key's value shorter than this is too likely to be ordinary text. */
export const MIN_VALUE_LENGTH = 8;
/** A value at least this long, high in entropy, is a token whatever its key is called. */
const TOKEN_MIN_LENGTH = 16;
const TOKEN_SHAPE = /^[A-Za-z0-9+/=_.~-]+$/;
const MIN_TOKEN_ENTROPY = 3.5;

/** Shannon entropy of a string, in bits per character. */
function entropy(text: string): number {
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

function isTokenShaped(value: string): boolean {
  return (
    value.length >= TOKEN_MIN_LENGTH &&
    TOKEN_SHAPE.test(value) &&
    /[A-Za-z]/.test(value) &&
    /\d/.test(value) &&
    entropy(value) >= MIN_TOKEN_ENTROPY
  );
}

interface Pattern {
  value: string;
  replacement: string;
}

/**
 * The secret of a URL-shaped value: its password, or its user info when it has none, written
 * as the URL holds it (`//user:<secret>@`, `//<secret>@`) and on its own.
 */
function urlSecretPatterns(key: string, value: string): Pattern[] {
  const info = userInfoOf(value);
  if (info === null) return [];
  const from = info.password ?? info.start;
  const secret = value.slice(from, info.end);
  if (secret === "") return [];
  const replacement = `[vault:${key}]`;
  const prefix = value.slice(info.start - 2, from);
  const out = [{ value: `${prefix}${secret}@`, replacement: `${prefix}${replacement}@` }];
  if (secret.length >= MIN_VALUE_LENGTH && !/^\d+$/.test(secret)) {
    out.push({ value: secret, replacement });
  }
  return out;
}

/** The vault's values an export takes out, longest first; null when there is none. */
export function vaultPatterns(vault: Readonly<Record<string, string>>): Pattern[] | null {
  const patterns: Pattern[] = [];
  for (const [key, value] of Object.entries(vault)) {
    patterns.push(...urlSecretPatterns(key, value));
    if (/^\d+$/.test(value)) continue;
    const secret =
      (isCredentialName(key) && value.length >= MIN_VALUE_LENGTH) || isTokenShaped(value);
    if (secret) patterns.push({ value, replacement: `[vault:${key}]` });
  }
  patterns.sort((a, b) => b.value.length - a.value.length);
  return patterns.length > 0 ? patterns : null;
}

/** `text` with every pattern's value replaced, and how many replacements. */
function replaceIn(text: string, patterns: readonly Pattern[]): [string, number] {
  let count = 0;
  let out = text;
  for (const pattern of patterns) {
    if (!out.includes(pattern.value)) continue;
    const parts = out.split(pattern.value);
    count += parts.length - 1;
    out = parts.join(pattern.replacement);
  }
  return [out, count];
}

/** The `session_meta` fields that name the Session; never rewritten. */
const IDENTITY_FIELDS = new Set(["session_id", "model_id", "provider"]);

/** A record with every string value scrubbed, and how many replacements. */
function scrubValue(
  value: unknown,
  patterns: readonly Pattern[],
  skip?: Set<string>,
): [unknown, number] {
  if (typeof value === "string") return replaceIn(value, patterns);
  if (Array.isArray(value)) {
    let total = 0;
    const out = value.map((item) => {
      const [next, count] = scrubValue(item, patterns);
      total += count;
      return next;
    });
    return [out, total];
  }
  if (value !== null && typeof value === "object") {
    let total = 0;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (skip?.has(key)) {
        out[key] = item;
        continue;
      }
      const [next, count] = scrubValue(item, patterns);
      total += count;
      out[key] = next;
    }
    return [out, total];
  }
  return [value, 0];
}

/** A JSON value with every string inside it scrubbed, and how many replacements. */
export function scrubJson(value: unknown, patterns: readonly Pattern[]): [unknown, number] {
  return scrubValue(value, patterns);
}

/** One line of a Trace file, scrubbed: the line as it goes out and what was done to it. */
export function scrubLine(
  line: string,
  patterns: readonly Pattern[],
): { line: string; replaced: number; unparsed: boolean } {
  if (
    line.trim() === "" ||
    !patterns.some((p) => line.includes(p.value) || line.includes(escaped(p)))
  ) {
    return { line, replaced: 0, unparsed: false };
  }
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    const [out, replaced] = replaceIn(line, asWrittenAndEscaped(patterns));
    return { line: out, replaced, unparsed: true };
  }
  const meta =
    record !== null &&
    typeof record === "object" &&
    (record as { type?: unknown }).type === "session_meta";
  let replaced = 0;
  let next: unknown = record;
  if (meta) {
    const { payload, ...rest } = record as { payload?: unknown };
    const [scrubbedRest, a] = scrubValue(rest, patterns);
    const [scrubbedPayload, b] = scrubValue(payload, patterns, IDENTITY_FIELDS);
    replaced = a + b;
    next = { ...(scrubbedRest as object), payload: scrubbedPayload };
  } else {
    [next, replaced] = scrubValue(record, patterns);
  }
  return replaced > 0
    ? { line: JSON.stringify(next), replaced, unparsed: false }
    : { line, replaced: 0, unparsed: false };
}

/** The pattern as a JSON string carries it (quotes and backslashes escaped). */
function escaped(pattern: Pattern): string {
  return JSON.stringify(pattern.value).slice(1, -1);
}

/** Each pattern as written and, where that differs, as a JSON string escapes it; longest first. */
function asWrittenAndEscaped(patterns: readonly Pattern[]): Pattern[] {
  const out = [...patterns];
  for (const pattern of patterns) {
    const value = escaped(pattern);
    if (value !== pattern.value) out.push({ value, replacement: pattern.replacement });
  }
  return out.sort((a, b) => b.value.length - a.value.length);
}

/** One file's pass through the scrub: `push` each chunk, then `end`; counts what it did. */
export class VaultScrub {
  replaced = 0;
  unparsed = 0;
  private pending: Buffer[] = [];

  constructor(private readonly patterns: readonly Pattern[]) {}

  /** The complete lines of what has arrived, scrubbed; a partial last line waits for more. */
  push(chunk: Uint8Array): Buffer {
    const buf = Buffer.from(chunk);
    const lastNewline = buf.lastIndexOf(0x0a);
    if (lastNewline < 0) {
      this.pending.push(buf);
      return Buffer.alloc(0);
    }
    const text = Buffer.concat([...this.pending, buf.subarray(0, lastNewline + 1)]);
    this.pending = [Buffer.from(buf.subarray(lastNewline + 1))];
    return this.lines(text);
  }

  end(): Buffer {
    const rest = Buffer.concat(this.pending);
    this.pending = [];
    return rest.length > 0 ? this.lines(rest) : rest;
  }

  private lines(text: Buffer): Buffer {
    const out = text
      .toString("utf8")
      .split("\n")
      .map((line) => {
        const result = scrubLine(line, this.patterns);
        this.replaced += result.replaced;
        if (result.unparsed) this.unparsed += 1;
        return result.line;
      });
    return Buffer.from(out.join("\n"));
  }
}
